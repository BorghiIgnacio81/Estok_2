// =============================================================================
// RUTA GEOGRÁFICA DE UNA CAJA · RED DE MINIMAPAS EN CADENA (Piso → Habitación → Mueble)
// -----------------------------------------------------------------------------
// Construye, para cada CAJA (Contenedor Pequeño) del Estok activo, la cadena de
// minimapas ULTRA-MINI (4× más chica) que permite localizarla geográficamente
// SIN depender del mueble que la contiene:
//
//   MAPA 1 (Piso)       → silueta de la casita con techo A DOS AGUAS; la planta
//                         activa se pinta en NARANJA (#f97316).
//   MAPA 2 (Habitación) → rectángulo PLANO con la grilla asimétrica de la
//                         división/planta; la habitación se pinta en NARANJA.
//   MAPA 3 (Mueble)     → SOLO si la caja reside dentro de un ropero/archivador:
//                         la grilla interna del mueble con la celda/estante
//                         exacto en NARANJA (coordenadas parent_grid_row/col).
//
// La lógica de dibujado NO se duplica: se delega al motor ya existente
//   - mapaJerarquico.ts      → grillas asimétricas + minimapas de la casita.
//   - minimapasAnidados.ts   → fila horizontal compacta con la cadena de nodos.
//   - minimapa.ts            → CSS base + SVG de la casita / rectángulo puro.
//
// Auth centralizada: getAuthHeaders() vive ÚNICAMENTE en src/services/auth. Este
// módulo jamás define su propia versión.
//
// FUENTE DE DATOS (endpoints existentes del Estok activo, multi-tenant X-Estok-Id):
//   GET /api/ubicaciones/?page_size=1000    jerarquía división (planta) ↔ habitación
//   GET /api/contenedores/?page_size=1000   TODAS las cajas, incluidas las anidadas
//   GET /api/estoks/{id}/                   grilla del macro-plano (total de plantas)
//   GET /api/objetos/?page_size=1000&...    objetos DIRECTOS de cada caja (con filtros)
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

/** Filtros activos del listado (mismos query params del árbol jerárquico). */
export interface FiltrosRuta {
  decision?: string;
  categoria?: string;
  publicado_ml?: string;
  search?: string;
}

/** Contenedor crudo normalizado (incluye los anidados dentro de muebles). */
interface ContenedorRuta {
  id: string;
  nombre: string;
  ubicacion: string | null;
  parent_contenedor: string | null;
  parent_grid_row: number | null;
  parent_grid_col: number | null;
  grid_filas: number;
  grid_columnas: number;
  grid_filas_config: number[] | null;
  es_inmueble: boolean;
  subcontenedores_count: number;
  material: string | null;
}

/**
 * Nodo de CAJA listo para la tarjeta del listado. Conserva los metadatos del
 * contenedor (padre, coordenadas y grilla) para poder resolver la cadena de
 * minimapas sin volver a consultar la API.
 */
export interface NodoCaja {
  [clave: string]: any;
  tipo: 'contenedor';
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
const objetosPorContenedor = new Map<string, any[]>();
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

/** Contador no negativo (sub-contenedores / objetos). */
function contador(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
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

/**
 * Detecta el registro ESPEJO que el backend crea al dar de alta un mueble/caja
 * raíz mudable (Contenedor + Objeto homónimo sin casillero). Se excluye del
 * desglose interior para no autoduplicar la caja como objeto de sí misma.
 */
function esRegistroEspejo(objeto: any, contenedor: ContenedorRuta): boolean {
  if (contenedor.es_inmueble || contenedor.parent_contenedor !== null) return false;
  if (objeto.parent_grid_row != null || objeto.parent_grid_col != null) return false;
  return String(objeto.nombre || '') === contenedor.nombre;
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
          ubicacion: c.ubicacion != null ? String(c.ubicacion) : null,
          parent_contenedor: c.parent_contenedor != null ? String(c.parent_contenedor) : null,
          parent_grid_row: enteroONull(c.parent_grid_row),
          parent_grid_col: enteroONull(c.parent_grid_col),
          grid_filas: enteroPositivo(c.grid_filas, 1),
          grid_columnas: enteroPositivo(c.grid_columnas, 1),
          grid_filas_config: Array.isArray(c.grid_filas_config)
            ? c.grid_filas_config.map((x: unknown) => enteroPositivo(x, 1))
            : null,
          es_inmueble: Boolean(c.es_inmueble),
          subcontenedores_count: contador(c.subcontenedores_count),
          material: c.material ? String(c.material) : null,
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

/**
 * Carga (o recarga) los objetos DIRECTOS de cada caja aplicando los filtros
 * activos del listado. El agrupamiento es por `contenedor` primario, por lo que
 * cada caja expone exclusivamente sus propias viñetas internas.
 */
export async function cargarObjetosRutaCaja(filtros: FiltrosRuta = {}): Promise<void> {
  await cargarContextoRutaCaja();

  const params = new URLSearchParams();
  params.set('page_size', '1000');
  if (filtros.decision) params.set('decision', filtros.decision);
  if (filtros.categoria) params.set('categoria', filtros.categoria);
  if (filtros.publicado_ml) params.set('publicado_ml', filtros.publicado_ml);
  if (filtros.search) params.set('search', filtros.search);

  objetosPorContenedor.clear();
  let raw: any[] = [];
  try {
    raw = await fetchTodos(`${API_BASE_URL}/objetos/?${params.toString()}`);
  } catch {
    raw = [];
  }

  for (const o of raw) {
    if (o.deleted_at) continue;
    const contenedorId = o.contenedor != null ? String(o.contenedor) : null;
    if (!contenedorId) continue;
    const contenedor = contenedoresPorId.get(contenedorId);
    if (!contenedor) continue;
    if (esRegistroEspejo(o, contenedor)) continue;
    const lista = objetosPorContenedor.get(contenedorId) || [];
    lista.push(o);
    objetosPorContenedor.set(contenedorId, lista);
  }
}

// =============================================================================
// CAJAS DEL ESTOK (Contenedores Pequeños, anidados o raíz)
// =============================================================================

/**
 * Devuelve TODAS las Cajas (Contenedores Pequeños) del Estok activo, de forma
 * directa e independiente de su mueble padre: se incluyen tanto las raíz como
 * las que viven dentro de un ropero/archivador.
 *
 * Caja = Contenedor sin sub-contenedores internos y sin carácter de mueble
 * inmueble fijo. Con `soloConContenido` activo (hay filtros) se descartan las
 * cajas sin objetos que coincidan, reflejando el mismo criterio del árbol.
 */
export function cajasDelEstok(opts: { soloConContenido?: boolean } = {}): NodoCaja[] {
  const cajas: NodoCaja[] = [];
  for (const c of contenedoresPorId.values()) {
    if (c.es_inmueble) continue;
    if (c.subcontenedores_count > 0) continue;
    const objetos = objetosPorContenedor.get(c.id) || [];
    if (opts.soloConContenido && objetos.length === 0) continue;
    cajas.push({
      tipo: 'contenedor',
      id: c.id,
      nombre: c.nombre,
      contenido: objetos.map((o) => ({ ...o, tipo: 'objeto' })),
      es_inmueble: false,
      material: c.material,
      subcontenedores_count: 0,
      objetos_count: objetos.length,
      ubicacion: c.ubicacion,
      parent_contenedor: c.parent_contenedor,
      parent_grid_row: c.parent_grid_row,
      parent_grid_col: c.parent_grid_col,
      grid_filas: c.grid_filas,
      grid_columnas: c.grid_columnas,
      grid_filas_config: c.grid_filas_config,
    });
  }

  cajas.sort((a, b) => {
    const ua = a.ubicacion ? ubicacionesPorId.get(a.ubicacion)?.nombre || '' : '';
    const ub = b.ubicacion ? ubicacionesPorId.get(b.ubicacion)?.nombre || '' : '';
    return ua.localeCompare(ub, 'es') || a.nombre.localeCompare(b.nombre, 'es');
  });
  return cajas;
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
  if (mueble) {
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

  // `todosActivos`: los TRES mapas conservan su resalte naranja (la ruta se lee
  // de un vistazo, sin nodos atenuados por ser "procedencia").
  return renderMinimapasAnidados(nodos, { todosActivos: true });
}




