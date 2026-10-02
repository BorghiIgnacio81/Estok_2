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
// Cara visual del replanteo geográfico del listado: texto con flechas + tooltip
// «Mostrar en minimapas» + panel desplegable con la fila de minimapas.
import { rutaGeograficaWidgetHtml } from './rutaGeograficaWidget';

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
 * Datos mínimos que necesita la ruta para ubicar geográficamente CUALQUIER
 * entidad del inventario (una caja del listado o un objeto suelto de la
 * pestaña Decisiones): el ambiente y el contenedor que lo contienen.
 * `NodoCaja` lo satisface estructuralmente, así que los llamados existentes no
 * cambian; la pestaña Decisiones pasa únicamente estos dos campos.
 */
export interface UbicacionDeRuta {
  ubicacion: string | null;
  parent_contenedor: string | null;
}

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
 * CONTENEDORES RAÍZ REALES de una habitación (muebles móviles/inmuebles y cajas
 * encastradas en su lienzo, sin padre): los sectores del plano proporcional
 * «Espacio/Mueble». Incluye CUALQUIER taxonomía (MUEBLE_MOVIL, MUEBLE_INMUEBLE,
 * CONJUNTO o CAJA): el minimapa debe poder abrir el interior de «PC Setup» o de
 * «Zona Indoor», no solo de un mueble móvil.
 */
function mueblesDeHabitacion(ubicacionId: string): ContenedorRuta[] {
  return [...contenedoresPorId.values()].filter(
    (c) => !c.parent_contenedor && c.ubicacion === ubicacionId,
  );
}

/**
 * HERMANOS de un contenedor: si vive dentro de otro, son los sub-contenedores de
 * su padre (divisiones/cajas internas del mueble); si es raíz, los contenedores
 * de su habitación. Nunca se inventa un universo: sin hermanos, el propio
 * contenedor es el único sector.
 */
function hermanosDeContenedor(c: ContenedorRuta): ContenedorRuta[] {
  if (c.parent_contenedor) {
    const hermanos = [...contenedoresPorId.values()].filter(
      (x) => x.parent_contenedor === c.parent_contenedor,
    );
    return hermanos.length ? hermanos : [c];
  }
  const raices = c.ubicacion ? mueblesDeHabitacion(c.ubicacion) : [];
  return raices.length ? raices : [c];
}

function nombreDePlanta(fila: number, division?: UbicacionPlano): string {
  if (division) return division.nombre;
  if (fila === 1) return ETIQUETAS_PISO[PISO_PRIMERO];
  if (fila === 2) return ETIQUETAS_PISO[PISO_BAJA];
  return `Planta ${fila}`;
}

/**
 * Nodos BASE de orientación: el MAPA 1 es SIEMPRE la silueta de la casita con
 * la planta activa en NARANJA (#f97316) y el MAPA 2 —si hay ambiente real— es
 * el plano PROPORCIONAL de los ambientes de esa división (ui_left/ui_top/
 * ui_width/ui_height persistidos en PostgreSQL) con la habitación que la
 * contiene como sector activo.
 */
function nodosPlantaYAmbiente(ubicacionId: string | null): NodoRuta[] {
  const totalPlantas = Math.max(1, Math.round(Number(estokCfg?.grid_filas) || 3));
  const habitacion = ubicacionId ? ubicacionesPorId.get(ubicacionId) : undefined;
  const division = habitacion?.parent_ubicacion
    ? ubicacionesPorId.get(habitacion.parent_ubicacion)
    : undefined;
  const plantaFila = division?.parent_grid_row ?? habitacion?.parent_grid_row ?? 1;

  const nodos: NodoRuta[] = [
    {
      tipo: 'planta',
      nombre: nombreDePlanta(plantaFila, division),
      filaActiva: plantaFila,
      totalPlantas,
    },
  ];

  if (habitacion) {
    nodos.push({
      id: habitacion.id,
      tipo: 'habitacion',
      nombre: habitacion.nombre,
      sectores: sectoresDeItems(hermanasDeHabitacion(habitacion), habitacion.id),
    });
  }
  return nodos;
}

/**
 * Nodo de la cadena para CUALQUIER contenedor (mueble, conjunto, división o
 * caja): plano PROPORCIONAL de sus hermanos REALES con el contenedor dado
 * pintado en NARANJA por identidad. Permite descender nivel a nivel
 * (Habitación → Mueble → División/Caja) sin bloquearse en ningún tipo.
 */
function nodoContenedor(contenedor: ContenedorRuta): NodoRuta {
  const hermanos = hermanosDeContenedor(contenedor);
  return {
    id: contenedor.id,
    // El primer nivel tras la habitación es un «mueble/espacio»; los anidados
    // son «divisiones/cajas» (mismo icono y misma lectura en la cascada).
    tipo: contenedor.parent_contenedor ? 'caja' : 'mueble',
    nombre: contenedor.nombre,
    sectores: sectoresDeItems(hermanos, contenedor.id),
  };
}
/**
 * Cadena de contenedores RAÍZ → HOJA que aloja a una entidad del inventario
 * (mueble → caja → estante). Sube por `parent_contenedor` con guarda de ciclos:
 * el TEXTO jerárquico y la fila de minimapas leen EXACTAMENTE la misma cadena.
 */
function cadenaContenedores(idInicial: string | null | undefined): ContenedorRuta[] {
  const cadena: ContenedorRuta[] = [];
  const visitados = new Set<string>();
  let actual = idInicial ? contenedoresPorId.get(String(idInicial)) : undefined;
  while (actual && !visitados.has(actual.id)) {
    visitados.add(actual.id);
    cadena.unshift(actual);
    actual = actual.parent_contenedor ? contenedoresPorId.get(actual.parent_contenedor) : undefined;
  }
  return cadena;
}

/** Entidad ubicable del inventario: su ambiente y el contenedor más profundo. */
export interface EntidadUbicable {
  /** ID de la Ubicación (habitación/ambiente) donde reside. */
  ubicacion: string | null;
  /** ID del contenedor MÁS PROFUNDO que la aloja (`null` = raíz del ambiente). */
  contenedor?: string | null;
}

/** Ruta geográfica resuelta de una entidad del inventario. */
export interface RutaGeografica {
  /** Cadena jerárquica con flechas: Piso -> Habitación -> Mueble -> Caja. */
  texto: string;
  /** Fila de minimapas analíticos de esa misma cadena. */
  minimapas: string;
  /** ¿La entidad tiene ruta real que mostrar? (sin ambiente no hay ruta). */
  hayRuta: boolean;
}

/**
 * RUTA GEOGRÁFICA de una entidad: resuelve el ambiente real (por el propio
 * contenedor cuando el payload no lo trae) y la cadena completa de contenedores
 * raíz → hoja, para imprimirla como TEXTO con flechas y para dibujar la fila de
 * minimapas analíticos unificados (casita + plano proporcional + subcontenedor
 * en NARANJA #f97316). Sin ambiente ni contenedores devuelve `hayRuta: false`:
 * la tarjeta muestra entonces su estado «sin ubicación», nunca un plano falso.
 */
export function resolverRutaGeografica(entidad: EntidadUbicable): RutaGeografica {
  const cadena = cadenaContenedores(entidad.contenedor);
  const ubicacionId = entidad.ubicacion || cadena.map((c) => c.ubicacion).find(Boolean) || null;
  const habitacion = ubicacionId ? ubicacionesPorId.get(ubicacionId) : undefined;
  const division = habitacion?.parent_ubicacion
    ? ubicacionesPorId.get(habitacion.parent_ubicacion)
    : undefined;
  const plantaFila = division?.parent_grid_row ?? habitacion?.parent_grid_row ?? 1;

  const partes: string[] = [nombreDePlanta(plantaFila, division)];
  if (habitacion) partes.push(habitacion.nombre);
  cadena.forEach((contenedor) => partes.push(contenedor.nombre));
  const texto = partes.filter((parte) => String(parte || '').trim() !== '').join(' -> ');

  const ambienteId = habitacion ? habitacion.id : null;
  const nodos = nodosPlantaYAmbiente(ambienteId);
  // REGLA UNIFICADA: la cascada desciende TODOS los niveles reales de la cadena
  // (Planta → Habitación → Espacio/Mueble → División/Caja), un minimapa por
  // contenedor, resaltando en NARANJA el hijo respectivo. Ningún tipo bloquea.
  cadena.forEach((contenedor) => nodos.push(nodoContenedor(contenedor)));

  return {
    texto,
    // Con un solo nodo (la casita) no hay fila que desplegar: el widget degrada
    // a una etiqueta de texto simple.
    minimapas: nodos.length > 1 ? renderMinimapasAnidados(nodos, { todosActivos: true }) : '',
    hayRuta: Boolean(habitacion) || cadena.length > 0,
  };
}

/**
 * WIDGET de la tarjeta del listado: texto de ruta con flechas que despliega, al
 * hacer clic, la fila de minimapas analíticos. Devuelve '' cuando la entidad no
 * tiene ruta real (la tarjeta conserva su estado «sin ubicación»).
 */
export function rutaGeograficaCardHtml(entidad: EntidadUbicable & { id?: string | null }): string {
  const ruta = resolverRutaGeografica(entidad);
  if (!ruta.hayRuta) return '';
  return rutaGeograficaWidgetHtml({
    texto: ruta.texto,
    minimapas: ruta.minimapas,
    clave: String(entidad.id ?? entidad.contenedor ?? ''),
  });
}

/**
 * HTML de la fila horizontal con la ruta geográfica de una CAJA: casita (planta
 * activa naranja) → plano PROPORCIONAL de los ambientes REALES (la habitación
 * que la contiene en naranja) → plano PROPORCIONAL de los muebles REALES de esa
 * habitación (el mueble que la contiene en naranja). Lo consumen las tarjetas de
 * Decisión; la Sección 1 del listado usa `rutaGeograficaCardHtml` (texto con
 * despliegue por clic).
 */
export function rutaMinimapasHtml(nodo: UbicacionDeRuta): string {
  const nodos = nodosPlantaYAmbiente(nodo.ubicacion);
  // Descenso COMPLETO de la cadena de la caja (mueble → división → caja), con el
  // hijo respectivo en NARANJA en cada mapa. Ningún tipo queda bloqueado.
  cadenaContenedores(nodo.parent_contenedor).forEach((contenedor) =>
    nodos.push(nodoContenedor(contenedor)),
  );
  // `todosActivos`: los mapas conservan su resalte naranja (la ruta se lee de un
  // vistazo, sin nodos atenuados por ser "procedencia").
  return renderMinimapasAnidados(nodos, { todosActivos: true });
}




