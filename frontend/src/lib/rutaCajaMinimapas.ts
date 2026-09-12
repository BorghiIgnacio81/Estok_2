// =============================================================================
// RUTA GEOGRÁFICA DE UNA CAJA · RED DE MINIMAPAS EN CADENA (Piso → Habitación → Mueble)
// -----------------------------------------------------------------------------
// Construye, para cada CAJA (Contenedor con `tipo='CAJA'`) del Estok activo, la
// cadena de minimapas ULTRA-MINI (4× más chica) que permite localizarla
// geográficamente SIN depender del mueble que la contiene:
//
//   MAPA 1 (Piso)       → silueta de la casita con techo A DOS AGUAS; la planta
//                         activa se pinta en NARANJA (#f97316).
//   MAPA 2 (Habitación) → rectángulo PLANO con la grilla asimétrica de la
//                         división/planta; la habitación se pinta en NARANJA.
//   MAPA 3 (Mueble)     → SOLO si la caja reside dentro de un ropero/archivador
//                         (`parent_contenedor` con `tipo='MUEBLE'`): la grilla
//                         interna del mueble con la celda/estante exacto en
//                         NARANJA (coordenadas parent_grid_row/col).
//
// FUENTE DE CAJAS: el listado NO clasifica en el cliente. La SECCIÓN 1 de la
// pantalla se alimenta del payload del endpoint unificado con el filtro ORM
// estricto `tipo='CAJA'` (ver listadoJerarquicoObjetos.ts). Este módulo sólo
// aporta el CONTEXTO geográfico (ubicaciones + contenedores + grilla del
// macro-Estok) y el dibujado de la cadena de minimapas.
//
// La lógica de dibujado NO se duplica: se delega al motor ya existente
//   - mapaJerarquico.ts      → grillas asimétricas + minimapas de la casita.
//   - minimapasAnidados.ts   → fila horizontal compacta con la cadena de nodos.
//   - minimapa.ts            → CSS base + SVG de la casita / rectángulo puro.
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
  filasInternasDe,
  columnasDeFilaInterna,
  ETIQUETAS_PISO,
  PISO_PRIMERO,
  PISO_BAJA,
} from './mapaJerarquico';
import type { UbicacionPlano, EstokConfig } from './mapaJerarquico';
import { renderMinimapasAnidados } from './minimapasAnidados';
import type { NodoRuta } from './minimapasAnidados';

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
  parent_grid_row: number | null;
  parent_grid_col: number | null;
  grid_filas: number;
  grid_columnas: number;
  grid_filas_config: number[] | null;
}

/**
 * Nodo de CAJA listo para la tarjeta del listado. Conserva los metadatos del
 * contenedor (padre, coordenadas y grilla) para poder resolver la cadena de
 * minimapas sin volver a consultar la API.
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
  grid_filas: number;
  grid_columnas: number;
  grid_filas_config: number[] | null;
}

// =============================================================================
// ESTADO DEL CONTEXTO (se carga una sola vez por documento)
// =============================================================================

const ubicacionesPorId = new Map<string, UbicacionPlano>();
const contenedoresPorId = new Map<string, ContenedorRuta>();
let estokCfg: EstokConfig | null = null;
let contextoListo = false;
let contextoPromise: Promise<void> | null = null;

// =============================================================================
// HELPERS
// =============================================================================

/** Entero o null: descarta NaN/'' sin inventar coordenadas fantasma. */
function enteroONull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/** Entero positivo con valor por defecto (para grillas). */
function enteroPositivo(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
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
      const [ubicaciones, contenedores, estokData] = await Promise.all([
        fetchUbicacionesPlano(),
        fetchTodos(`${API_BASE_URL}/contenedores/?page_size=1000`),
        fetchEstokConfig(),
      ]);

      ubicacionesPorId.clear();
      for (const u of ubicaciones) ubicacionesPorId.set(u.id, u);

      contenedoresPorId.clear();
      for (const c of contenedores) {
        const id = String(c.id);
        contenedoresPorId.set(id, {
          id,
          nombre: String(c.nombre || 'Contenedor'),
          tipo: String(c.tipo || 'CAJA').toUpperCase(),
          ubicacion: c.ubicacion != null ? String(c.ubicacion) : null,
          parent_contenedor: c.parent_contenedor != null ? String(c.parent_contenedor) : null,
          parent_grid_row: enteroONull(c.parent_grid_row),
          parent_grid_col: enteroONull(c.parent_grid_col),
          grid_filas: enteroPositivo(c.grid_filas, 1),
          grid_columnas: enteroPositivo(c.grid_columnas, 1),
          grid_filas_config: Array.isArray(c.grid_filas_config)
            ? c.grid_filas_config.map((x: unknown) => enteroPositivo(x, 1))
            : null,
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

/** Columnas por fila (grilla asimétrica) de una división/planta. */
function columnasPorFilaDeUbicacion(u: UbicacionPlano): number[] {
  const filas = filasInternasDe(u);
  const cols: number[] = [];
  for (let i = 1; i <= filas; i++) cols.push(columnasDeFilaInterna(u, i));
  return cols;
}

/** Columnas por fila (grilla asimétrica) de la grilla interna de un mueble. */
function columnasPorFilaDeContenedor(c: ContenedorRuta): number[] {
  const filas = Math.max(1, Math.floor(Number(c.grid_filas) || 1));
  const cfg = c.grid_filas_config && c.grid_filas_config.length >= filas ? c.grid_filas_config : null;
  const cols: number[] = [];
  for (let i = 1; i <= filas; i++) {
    const porConfig = cfg ? Math.floor(Number(cfg[i - 1])) : NaN;
    const valor = Number.isFinite(porConfig) && porConfig > 0 ? porConfig : c.grid_columnas;
    cols.push(Math.max(1, Math.min(12, valor)));
  }
  return cols;
}

function nombreDePlanta(fila: number, division?: UbicacionPlano): string {
  if (division) return division.nombre;
  if (fila === 1) return ETIQUETAS_PISO[PISO_PRIMERO];
  if (fila === 2) return ETIQUETAS_PISO[PISO_BAJA];
  return `Planta ${fila}`;
}

/**
 * HTML de la fila horizontal compacta con la ruta geográfica completa de una
 * caja: casita (planta activa naranja) → habitación (grilla asimétrica, celda
 * naranja) → mueble (grilla interna, celda exacta naranja, solo si aplica).
 */
export function rutaMinimapasHtml(nodo: NodoCaja): string {
  const totalPlantas = Math.max(1, Math.round(Number(estokCfg?.grid_filas) || 3));
  const habitacion = nodo.ubicacion ? ubicacionesPorId.get(nodo.ubicacion) : undefined;
  const division = habitacion && habitacion.parent_ubicacion
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
    // MAPA 2 (Habitación): rectángulo PLANO de la planta/división con su grilla
    // asimétrica; la habitación activa se pinta en naranja. Sin división padre
    // (modelo legacy) se dibuja la grilla propia de la habitación, sin celda.
    const base = division ?? habitacion;
    nodos.push({
      tipo: 'habitacion',
      nombre: habitacion.nombre,
      filas: filasInternasDe(base),
      columnasPorFila: columnasPorFilaDeUbicacion(base),
      celdaFila: division ? habitacion.parent_grid_row ?? null : null,
      celdaCol: division ? habitacion.parent_grid_col ?? null : null,
    });
  }

  const mueble = nodo.parent_contenedor ? contenedoresPorId.get(nodo.parent_contenedor) : undefined;
  if (mueble && mueble.tipo === 'MUEBLE') {
    // MAPA 3 (Mueble): grilla interna del ropero/archivador con la celda/estante
    // exacto en naranja (coordenadas parent_grid_row/col persistidas).
    nodos.push({
      tipo: 'mueble',
      nombre: mueble.nombre,
      filas: Math.max(1, Math.floor(Number(mueble.grid_filas) || 1)),
      columnasPorFila: columnasPorFilaDeContenedor(mueble),
      celdaFila: nodo.parent_grid_row,
      celdaCol: nodo.parent_grid_col,
    });
  }

  // `todosActivos`: los mapas conservan su resalte naranja (la ruta se lee de un
  // vistazo, sin nodos atenuados por ser "procedencia").
  return renderMinimapasAnidados(nodos, { todosActivos: true });
}




