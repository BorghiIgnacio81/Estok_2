// =============================================================================
// RUTA GEOGRÁFICA DE UNA CAJA · MINI-GUÍA ANALÍTICA (Piso → Habitación → Mueble)
// -----------------------------------------------------------------------------
// Construye, para cada CAJA (Contenedor con `tipo='CAJA'`) del Estok activo, la
// cadena de minimapas asimétricos proporcionales que permite localizarla
// geográficamente SIN depender del mueble que la contiene:
//
//   MAPA 1 (Piso)       → silueta de la casita con techo A DOS AGUAS; la planta
//                         activa se pinta en NARANJA (#f97316).
//   MAPA 2 (Habitación) → plano PROPORCIONAL de los ambientes REALES de la
//                         división: cada habitación conserva su silueta exacta
//                         (ui_left/ui_top/ui_width/ui_height persistidos en
//                         PostgreSQL) y la que contiene la caja va en NARANJA.
//   MAPA 3 (Mueble)     → SOLO si la caja reside dentro de un ropero/archivador
//                         (`parent_contenedor` con `tipo='MUEBLE'`): plano
//                         proporcional de los muebles REALES de la habitación,
//                         con el mueble que la contiene en NARANJA.
//
// FUENTE DE CAJAS: el listado NO clasifica en el cliente. La SECCIÓN 1 de la
// pantalla se alimenta del payload del endpoint unificado con el filtro ORM
// estricto `tipo='CAJA'` (ver listadoJerarquicoObjetos.ts). Este módulo sólo
// aporta el CONTEXTO geográfico (ubicaciones + contenedores del Estok activo)
// y arma los nodos de la ruta.
//
// La lógica de dibujado NO se duplica: se delega al motor ya existente
//   - minimapasAnidados.ts   → MISMO render que la mini-guía analítica superior
//                              de Almacenamiento y que el componente global
//                              components/MinimapaRuta.astro (siluetas
//                              asimétricas + sector activo naranja).
//   - sectoresMinimapa.ts    → geometría real (ui_*) → sectores proporcionales.
//   - minimapa.ts            → SVG de la casita a dos aguas / sectores / grilla.
//
// Auth centralizada: getAuthHeaders() vive ÚNICAMENTE en src/services/auth. Este
// módulo jamás define su propia versión.
//
// CONTEXTO (endpoints existentes del Estok activo, multi-tenant X-Estok-Id):
//   GET /api/ubicaciones/?page_size=1000    jerarquía división (planta) ↔ habitación
//   GET /api/contenedores/?page_size=1000   TODOS los contenedores (padre mueble)
//   GET /api/estoks/{id}/                   grilla del macro-plano (total de plantas)
// =============================================================================

import { getAuthHeaders, API_BASE_URL, normalizarUrlApi } from '../services/auth';
import {
  fetchUbicacionesPlano,
  fetchEstokConfig,
  ETIQUETAS_PISO,
  PISO_PRIMERO,
  PISO_BAJA,
} from './mapaJerarquico';
import type { UbicacionPlano, EstokConfig } from './mapaJerarquico';
import { renderMinimapasAnidados } from './minimapasAnidados';
import type { NodoRuta } from './minimapasAnidados';
import { sectoresDeItems } from './sectoresMinimapa';

// =============================================================================
// TIPOS
// =============================================================================

/** Contenedor crudo normalizado (incluye los anidados dentro de muebles). */
interface ContenedorRuta {
  id: string;
  nombre: string;
  /** Taxonomía estricta del contenedor: MUEBLE | CAJA | ESTANTE. */
  tipo: string;
  ubicacion: string | null;
  parent_contenedor: string | null;
  /** Geometría REAL del mueble en % del lienzo (proporciones del minimapa). */
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
}

/**
 * Nodo de CAJA listo para la tarjeta del listado. Conserva los metadatos del
 * contenedor (padre y coordenadas) que consumen las acciones operativas de la
 * tarjeta y la resolución de la cadena de minimapas, sin volver a consultar la API.
 */
export interface NodoCaja {
  [clave: string]: any;
  tipo: 'contenedor';
  tipo_contenedor: 'CAJA';
  id: string;
  nombre: string;
  contenido: any[];
  es_inmueble: boolean;
  material: string | null;
  subcontenedores_count: number;
  objetos_count: number;
  ubicacion: string | null;
  parent_contenedor: string | null;
  parent_grid_row: number | null;
  parent_grid_col: number | null;
  /** Geometría REAL del mueble que la contiene (proporciones del minimapa). */
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
}

// =============================================================================
// ESTADO DEL CONTEXTO (se carga una sola vez por documento)
// =============================================================================

const ubicacionesPorId = new Map<string, UbicacionPlano>();
/** Todas las ubicaciones del Estok activo (para resolver los ambientes hermanos). */
let ubicaciones: UbicacionPlano[] = [];
const contenedoresPorId = new Map<string, ContenedorRuta>();
let estokCfg: EstokConfig | null = null;
let contextoListo = false;
let contextoPromise: Promise<void> | null = null;

// =============================================================================
// HELPERS
// =============================================================================

/** Texto CSS (%, px) o null: descarta valores vacíos sin inventar geometría. */
function cssONull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** Paginación robusta reutilizando la auth centralizada del proyecto. */
async function fetchTodos(url: string): Promise<any[]> {
  const todos: any[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return todos;
    }
    if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
    const data = await res.json();
    todos.push(...(data.results || data));
    nextUrl = normalizarUrlApi(data.next);
  }
  return todos;
}

// =============================================================================
// CARGA DE CONTEXTO (ubicaciones + contenedores + config del Estok)
// =============================================================================

/**
 * Carga (una sola vez) el plano de ubicaciones, TODOS los contenedores del Estok
 * activo (incluidas las cajas anidadas dentro de muebles) y la grilla del
 * macro-plano. Es idempotente: si el contexto ya está cargado no repite consultas.
 */
export function cargarContextoRutaCaja(): Promise<void> {
  if (contextoListo) return Promise.resolve();
  if (contextoPromise) return contextoPromise;
  contextoPromise = (async () => {
    try {
      const [ubicacionesData, contenedores, estokData] = await Promise.all([
        fetchUbicacionesPlano(),
        fetchTodos(`${API_BASE_URL}/contenedores/?page_size=1000`),
        fetchEstokConfig(),
      ]);

      ubicaciones = ubicacionesData;
      ubicacionesPorId.clear();
      for (const u of ubicacionesData) ubicacionesPorId.set(u.id, u);

      contenedoresPorId.clear();
      for (const c of contenedores) {
        const id = String(c.id);
        contenedoresPorId.set(id, {
          id,
          nombre: String(c.nombre || 'Contenedor'),
          tipo: String(c.tipo || 'CAJA').toUpperCase(),
          ubicacion: c.ubicacion != null ? String(c.ubicacion) : null,
          parent_contenedor: c.parent_contenedor != null ? String(c.parent_contenedor) : null,
          // Geometría REAL del mueble (proporciones asimétricas del minimapa).
          ui_left: cssONull(c.ui_left),
          ui_top: cssONull(c.ui_top),
          ui_width: cssONull(c.ui_width),
          ui_height: cssONull(c.ui_height),
        });
      }

      estokCfg = estokData;
      contextoListo = true;
    } finally {
      contextoPromise = null;
    }
  })();
  return contextoPromise;
}

// =============================================================================
// CADENA DE MINIMAPAS (Piso → Habitación → Mueble)
// =============================================================================

/**
 * Ambientes HERMANOS de una habitación (los que comparten su misma división de
 * planta): son los sectores REALES que dibuja el plano proporcional. Sin
 * división padre (modelo legacy) la propia habitación es el único sector.
 */
function hermanasDeHabitacion(room: UbicacionPlano): UbicacionPlano[] {
  const padre = room.parent_ubicacion ?? null;
  if (!padre) return [room];
  const hermanas = ubicaciones.filter((u) => (u.parent_ubicacion ?? null) === padre);
  return hermanas.length ? hermanas : [room];
}

/**
 * Muebles REALES de una habitación (contenedores `tipo='MUEBLE'` de nivel raíz
 * de esa ubicación): los sectores del plano proporcional del mueble.
 */
function mueblesDeHabitacion(ubicacionId: string): ContenedorRuta[] {
  return [...contenedoresPorId.values()].filter(
    (c) => c.tipo === 'MUEBLE' && !c.parent_contenedor && c.ubicacion === ubicacionId,
  );
}

function nombreDePlanta(fila: number, division?: UbicacionPlano): string {
  if (division) return division.nombre;
  if (fila === 1) return ETIQUETAS_PISO[PISO_PRIMERO];
  if (fila === 2) return ETIQUETAS_PISO[PISO_BAJA];
  return `Planta ${fila}`;
}

/**
 * HTML de la fila horizontal compacta con la ruta geográfica completa de una
 * caja: casita (planta activa naranja) → plano PROPORCIONAL de los ambientes
 * REALES (la habitación que la contiene en naranja) → plano PROPORCIONAL de los
 * muebles REALES de esa habitación (el mueble que la contiene en naranja).
 *
 * Se delega en renderMinimapasAnidados(): el MISMO motor que alimenta el
 * componente global components/MinimapaRuta.astro y la mini-guía analítica
 * superior de Almacenamiento, así las dos pantallas se ven idénticas.
 */
export function rutaMinimapasHtml(nodo: NodoCaja): string {
  const totalPlantas = Math.max(1, Math.round(Number(estokCfg?.grid_filas) || 3));
  const habitacion = nodo.ubicacion ? ubicacionesPorId.get(nodo.ubicacion) : undefined;
  const division = habitacion?.parent_ubicacion
    ? ubicacionesPorId.get(habitacion.parent_ubicacion)
    : undefined;
  const plantaFila = division?.parent_grid_row ?? habitacion?.parent_grid_row ?? 1;

  // MAPA 1 (Piso): silueta de la casita con techo a dos aguas; planta activa naranja.
  const nodos: NodoRuta[] = [
    {
      tipo: 'planta',
      nombre: nombreDePlanta(plantaFila, division),
      filaActiva: plantaFila,
      totalPlantas,
    },
  ];

  if (habitacion) {
    // MAPA 2 (Habitación): plano proporcional de los ambientes REALES de la
    // división (ui_left/ui_top/ui_width/ui_height persistidos en PostgreSQL).
    // La habitación que contiene la caja es el sector activo en naranja.
    nodos.push({
      id: habitacion.id,
      tipo: 'habitacion',
      nombre: habitacion.nombre,
      sectores: sectoresDeItems(hermanasDeHabitacion(habitacion), habitacion.id),
    });
  }

  const mueble = nodo.parent_contenedor ? contenedoresPorId.get(nodo.parent_contenedor) : undefined;
  if (mueble && mueble.tipo === 'MUEBLE') {
    // MAPA 3 (Mueble): plano proporcional de los muebles REALES de la habitación,
    // con el mueble que contiene la caja pintado en NARANJA (ubicación síncrona).
    const hermanos = nodo.ubicacion ? mueblesDeHabitacion(nodo.ubicacion) : [];
    const sectores = hermanos.some((c) => c.id === mueble.id) ? hermanos : [mueble];
    nodos.push({
      id: mueble.id,
      tipo: 'mueble',
      nombre: mueble.nombre,
      sectores: sectoresDeItems(sectores, mueble.id),
    });
  }

  // `todosActivos`: los mapas conservan su resalte naranja (la ruta se lee de un
  // vistazo, sin nodos atenuados por ser "procedencia").
  return renderMinimapasAnidados(nodos, { todosActivos: true });
}




