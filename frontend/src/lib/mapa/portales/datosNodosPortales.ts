// =============================================================================
// CAPA DE DATOS DE LOS PORTALES RECURSIVOS (jerarquía real por `parent_id`)
// -----------------------------------------------------------------------------
// ÚNICA puerta de red del motor de portales. Cachea en memoria el padrón del
// Estok activo (Ubicaciones, Contenedores y Objetos) para resolver el interior
// de CUALQUIER nodo —a cualquier profundidad— sin cadenas de N+1.
//
// Auth centralizada: getAuthHeaders()/API_BASE_URL/normalizarUrlApi SIEMPRE
// desde src/services/auth. Este módulo NUNCA define headers propios.
//
// El backend expone:
//   GET /api/ubicaciones/?page_size=1000     → plantas + habitaciones (parent_ubicacion)
//   GET /api/contenedores/?page_size=1000    → árbol completo (parent_contenedor)
//   GET /api/objetos/?page_size=1000         → objetos con contenedor/ubicacion
// =============================================================================

import { getAuthHeaders, API_BASE_URL, normalizarUrlApi } from '../../../services/auth';
import { esDivisionUbicacion, filasInternasDe, columnasDeFilaInterna } from '../../mapaJerarquico';
import type { UbicacionPlano } from '../../mapaJerarquico';
import type { ItemGeometria } from '../../sectoresMinimapa';
import type { NodoPortal } from './estadoPortales';
// CONTADOR CANÓNICO de espacios por habitación (raíces + fusión colapsada):
// el mismo número que dibuja el lienzo derecho.
import { indexarEspaciosVisiblesPorUbicacion } from '../espaciosVisibles';
// Espacios VIRTUALES (limbo «En Tránsito»): nunca son habitaciones navegables.
import { esEspacioVirtual, filtrarEspaciosDePlano } from '../../ubicacionesVirtuales';

/** Contenedor del padrón, normalizado para la cascada. */
export interface ContenedorDto {
  id: string;
  nombre: string;
  tipo: string;
  es_inmueble: boolean;
  espacio_unico: boolean;
  /** 🎒 Declaración de movilidad: `true` = bulto movible; `false` = arquitectura. */
  declarado_movible: boolean;
  parent_contenedor: string | null;
  parent_grid_row: number | null;
  parent_grid_col: number | null;
  ubicacion: string | null;
  subcontenedores_count: number;
  objetos_count: number;
  grid_filas: number;
  grid_filas_config: number[] | null;
  grid_columnas: number;
  ui_left: string | null;
  ui_top: string | null;
  ui_width: string | null;
  ui_height: string | null;
  fusion_grupo: string | null;
  /**
   * Campos físicos/config del contenedor que «Duplicar» replica para que la
   * copia sea EXACTA (opcionales: sólo los consume el duplicador).
   */
  descripcion?: string | null;
  largo?: string | null;
  ancho?: string | null;
  alto?: string | null;
  material?: string | null;
  tipo_madera?: string | null;
}

/** Objeto del padrón, normalizado para la cascada (grilla directa y tránsito). */
export interface ObjetoDto {
  id: string;
  nombre: string;
  contenedor: string | null;
  ubicacion: string | null;
  parent_grid_row: number | null;
  parent_grid_col: number | null;
  en_transito_interno: boolean;
  tipo: string;
  foto: string | null;
  /** Categoría visible del objeto: define su ícono canónico (lib/iconoObjeto.ts). */
  categoria_nombre: string | null;
  /** Categoría normalizada por el backend («muebles y estructuras moviles»). */
  categoria_slug: string | null;
}

/** Interior resuelto de un nodo: hijos jerárquicos + objetos reales directos. */
export interface InteriorNodo {
  /** Hijos directos (estantes, cajones, cajas) ya proyectados como nodos. */
  piezas: NodoPortal[];
  /** Objetos que cuelgan DIRECTAMENTE del nodo (sin estante fino). */
  objetos: ObjetoDto[];
  /** Geometría real de los hijos (alimenta el minimapa del panel derecho). */
  geometriaHijos: ItemGeometria[];
  /** Grilla elástica del nodo (filas internas asimétricas). */
  filas: number;
  columnasPorFila: number[];
}

// -----------------------------------------------------------------------------
// HELPERS BASE
// -----------------------------------------------------------------------------

/** GET paginado completo con Auth centralizada (JWT + X-Estok-Id). */
export async function fetchTodosPortales(url: string): Promise<Record<string, unknown>[]> {
  const todos: Record<string, unknown>[] = [];
  let siguiente: string | null = url;
  while (siguiente) {
    const res = await fetch(siguiente, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return todos;
    }
    if (!res.ok) return todos;
    const data = await res.json();
    todos.push(...(data.results || data));
    siguiente = normalizarUrlApi(data.next);
  }
  return todos;
}

/**
 * Igual que `fetchTodosPortales` pero informa si TODAS las páginas respondieron
 * OK. Lo usa el pedido ESTRICTO de sub-espacios para distinguir «el espacio no
 * tiene hijos» (lista vacía legítima) de «el endpoint no está disponible»
 * (recurso desplegado en otro orden) y caer al padrón ya cacheado.
 */
async function fetchTodosPortalesConEstado(
  url: string,
): Promise<{ items: Record<string, unknown>[]; ok: boolean }> {
  const items: Record<string, unknown>[] = [];
  let siguiente: string | null = url;
  while (siguiente) {
    const res = await fetch(siguiente, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return { items, ok: false };
    }
    if (!res.ok) return { items, ok: false };
    const data = await res.json();
    items.push(...(data.results || data));
    siguiente = normalizarUrlApi(data.next);
  }
  return { items, ok: true };
}

function texto(v: unknown): string | null {
  return v == null ? null : String(v);
}

function entero(v: unknown, porDefecto = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : porDefecto;
}

function enteroONull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

// -----------------------------------------------------------------------------
// CACHÉ DEL PADRÓN DEL ESTOK ACTIVO
// -----------------------------------------------------------------------------

let cacheUbicaciones: UbicacionPlano[] | null = null;
let cacheContenedores: ContenedorDto[] | null = null;
let cacheObjetos: ObjetoDto[] | null = null;
/**
 * SUB-ESPACIOS DIRECTOS ya pedidos a la API con filtrado estricto, indexados por
 * el UUID del espacio padre. Evita repetir el GET en cada repintado del nivel.
 */
const cacheHijosPorEspacio = new Map<string, ContenedorDto[]>();

function normalizarContenedor(c: Record<string, unknown>): ContenedorDto {
  const config = Array.isArray(c.grid_filas_config) ? (c.grid_filas_config as unknown[]) : null;
  return {
    id: String(c.id),
    nombre: String(c.nombre || 'Contenedor'),
    tipo: String(c.tipo || '').toUpperCase(),
    es_inmueble: Boolean(c.es_inmueble),
    // 🧱 Disyuntor de estructura: bloque monolítico declarado en la base.
    espacio_unico: Boolean(c.espacio_unico),
    // 🎒 Disyuntor de movilidad (Lote 25 · default False = arquitectura).
    declarado_movible: Boolean(c.declarado_movible),
    parent_contenedor: texto(c.parent_contenedor),
    parent_grid_row: enteroONull(c.parent_grid_row),
    parent_grid_col: enteroONull(c.parent_grid_col),
    ubicacion: texto(c.ubicacion),
    subcontenedores_count: entero(c.subcontenedores_count),
    objetos_count: entero(c.objetos_count),
    grid_filas: Math.max(1, entero(c.grid_filas, 1)),
    grid_filas_config: config ? config.map((v) => entero(v, 1)) : null,
    grid_columnas: Math.max(1, entero(c.grid_columnas, 1)),
    ui_left: texto(c.ui_left),
    ui_top: texto(c.ui_top),
    ui_width: texto(c.ui_width),
    ui_height: texto(c.ui_height),
    fusion_grupo: texto(c.fusion_grupo),
    descripcion: texto(c.descripcion),
    largo: texto(c.largo),
    ancho: texto(c.ancho),
    alto: texto(c.alto),
    material: texto(c.material),
    tipo_madera: texto(c.tipo_madera),
  };
}

function normalizarObjeto(o: Record<string, unknown>): ObjetoDto {
  return {
    id: String(o.id),
    nombre: String(o.nombre || 'Objeto'),
    contenedor: texto(o.contenedor),
    ubicacion: texto(o.ubicacion),
    parent_grid_row: enteroONull(o.parent_grid_row),
    parent_grid_col: enteroONull(o.parent_grid_col),
    en_transito_interno: Boolean(o.en_transito_interno),
    tipo: String(o.tipo || '').toUpperCase(),
    foto: texto(o.foto),
    // CATEGORÍA: el ícono del objeto se resuelve con ella («Muebles» →
    // /mueble.webp · resto → /fluffy-objeto.webp). La API expone ambos campos.
    categoria_nombre: texto(o.categoria_nombre),
    categoria_slug: texto(o.categoria_slug),
  };
}

/** Invalida la caché (se llama al recibir `estok:espacios-cambiados`). */
export function invalidarCachePortales(): void {
  cacheUbicaciones = null;
  cacheContenedores = null;
  cacheObjetos = null;
  cacheHijosPorEspacio.clear();
}

/** Padrón de Ubicaciones del Estok activo (plantas + habitaciones). */
export async function cargarUbicaciones(): Promise<UbicacionPlano[]> {
  if (cacheUbicaciones) return cacheUbicaciones;
  const data = await fetchTodosPortales(`${API_BASE_URL}/ubicaciones/?page_size=1000`);
  cacheUbicaciones = data as unknown as UbicacionPlano[];
  return cacheUbicaciones;
}

/** Árbol completo de Contenedores del Estok activo. */
export async function cargarContenedores(): Promise<ContenedorDto[]> {
  if (cacheContenedores) return cacheContenedores;
  const data = await fetchTodosPortales(`${API_BASE_URL}/contenedores/?page_size=1000`);
  cacheContenedores = data.map(normalizarContenedor);
  return cacheContenedores;
}

/** Padrón de Objetos activos del Estok activo (excluye soft-delete). */
export async function cargarObjetos(): Promise<ObjetoDto[]> {
  if (cacheObjetos) return cacheObjetos;
  const data = await fetchTodosPortales(`${API_BASE_URL}/objetos/?page_size=1000`);
  cacheObjetos = data.filter((o) => !o.deleted_at).map(normalizarObjeto);
  return cacheObjetos;
}

// -----------------------------------------------------------------------------
// CONSULTAS DE JERARQUÍA
// (caché del padrón del Estok + sub-espacios directos por API estricta)
// -----------------------------------------------------------------------------

/** Divisiones (plantas) del Estok activo, ordenadas por su fila del macro-plano. */
export async function cargarPlantas(): Promise<UbicacionPlano[]> {
  const todas = await cargarUbicaciones();
  return todas
    .filter(esDivisionUbicacion)
    .sort((a, b) => (a.parent_grid_row || 1) - (b.parent_grid_row || 1));
}

/** Habitaciones encastradas en una división (planta) por su relación padre. */
export async function cargarHabitacionesDePlanta(plantaId: string | null): Promise<UbicacionPlano[]> {
  const todas = await cargarUbicaciones();
  // El limbo «En Tránsito»/«Zona de Mudanza» es un espacio VIRTUAL de sistema:
  // se excluye de la cascada de portales y de sus minimapas.
  const rooms = todas.filter((u) => !esDivisionUbicacion(u) && !esEspacioVirtual(u));
  if (!plantaId) return rooms;
  return rooms.filter((r) => r.parent_ubicacion === plantaId);
}

/** Contenedores RAÍZ de una habitación (los espacios/muebles del cuarto). */
export async function contenedoresRaizDeUbicacion(ubicacionId: string): Promise<ContenedorDto[]> {
  const conts = await cargarContenedores();
  return conts.filter((c) => c.ubicacion === ubicacionId && !c.parent_contenedor);
}

/**
 * SUB-ESPACIOS DIRECTOS de un espacio, pedidos a la API con FILTRADO ESTRICTO.
 *
 *   GET /api/espacios/?espacio_padre_id=<UUID del espacio activo>
 *
 * Contrato hermético: la respuesta es EXCLUSIVAMENTE la de los contenedores
 * cuyo `parent_contenedor_id` coincide con el UUID pedido. Si el espacio todavía
 * no tiene sub-espacios, la lista viene vacía y así se devuelve: NO existe
 * fallback, mock ni «hijo por defecto» (jamás aparece un mueble de otro espacio).
 *
 * Se re-valida la relación en el cliente (`parent_contenedor === id`) para que
 * ningún cambio de contrato del backend pueda colar un hijo ajeno.
 */
export async function cargarSubespaciosDeEspacio(espacioId: string): Promise<ContenedorDto[]> {
  const id = String(espacioId ?? '').trim();
  if (!id) return [];
  const cacheados = cacheHijosPorEspacio.get(id);
  if (cacheados) return cacheados;
  const { items, ok } = await fetchTodosPortalesConEstado(
    `${API_BASE_URL}/espacios/?espacio_padre_id=${encodeURIComponent(id)}&page_size=1000`,
  );
  // ENDPOINT NO DISPONIBLE (despliegue desfasado): se usa el padrón completo ya
  // cacheado con la MISMA comparación exacta por UUID. Nunca un hijo por defecto.
  const base = ok ? items : ((await cargarContenedores()) as unknown as Record<string, unknown>[]);
  const hijos = base
    .map(normalizarContenedor)
    .filter((c) => c.parent_contenedor === id);
  cacheHijosPorEspacio.set(id, hijos);
  return hijos;
}

/** Hijos DIRECTOS de un contenedor a cualquier profundidad (filtro estricto). */
export async function contenedoresHijosDe(padreId: string): Promise<ContenedorDto[]> {
  return cargarSubespaciosDeEspacio(padreId);
}

/** Objetos colgados DIRECTAMENTE de un contenedor (sin estante fino). */
export async function objetosDeContenedor(contenedorId: string): Promise<ObjetoDto[]> {
  const objetos = await cargarObjetos();
  return objetos.filter((o) => o.contenedor === contenedorId);
}

/** Objetos de una habitación que NO viven dentro de ningún contenedor. */
export async function objetosSueltosDeUbicacion(ubicacionId: string): Promise<ObjetoDto[]> {
  const objetos = await cargarObjetos();
  return objetos.filter((o) => o.ubicacion === ubicacionId && !o.contenedor);
}

/** Geometría real (ui_*) de una lista de piezas, para los minimapas anidados. */
export function geometriaDe(
  items: (ItemGeometria | ContenedorDto | UbicacionPlano)[],
): ItemGeometria[] {
  return items.map((i) => {
    const g = i as ItemGeometria;
    return {
      id: String(i.id),
      nombre: String(i.nombre ?? ''),
      ui_left: g.ui_left ?? null,
      ui_top: g.ui_top ?? null,
      ui_width: g.ui_width ?? null,
      ui_height: g.ui_height ?? null,
      fusion_grupo: g.fusion_grupo ?? null,
    };
  });
}

/** Columnas por fila de un contenedor (grilla asimétrica persistida). */
export function columnasPorFilaDeContenedor(c: ContenedorDto): number[] {
  const cols: number[] = [];
  for (let i = 1; i <= c.grid_filas; i++) {
    const configurada = c.grid_filas_config?.[i - 1];
    cols.push(configurada && configurada > 0 ? configurada : c.grid_columnas);
  }
  return cols;
}

/** Nodo de cascada para una HABITACIÓN (Ubicación no-división). */
export function nodoDesdeHabitacion(
  room: UbicacionPlano,
  espaciosInternos: ContenedorDto[] = [],
): NodoPortal {
  const filas = filasInternasDe(room);
  const columnasPorFila: number[] = [];
  for (let i = 1; i <= filas; i++) columnasPorFila.push(columnasDeFilaInterna(room, i));
  return {
    tipo: 'habitacion',
    id: String(room.id),
    nombre: String(room.nombre ?? 'Habitación'),
    espacioUnico: Boolean(room.espacio_unico),
    // La Ubicación (habitación/planta) NO tiene `declarado_movible` en el backend:
    // el disyuntor de movilidad nunca se ofrece fuera de un Contenedor.
    declaradoMovible: false,
    conDivisiones: espaciosInternos.length > 0,
    filas,
    columnasPorFila,
    hijos: geometriaDe(espaciosInternos),
    // Dueño del perímetro ámbar: la medida general vive en la Ubicación real.
    ui_width: room.ui_width ?? null,
    ui_height: room.ui_height ?? null,
    celda: null,
  };
}

/** Nodo de cascada para un CONTENEDOR (estante, cajón, mueble o caja). */
export function nodoDesdeContenedor(
  c: ContenedorDto,
  celda: NodoPortal['celda'] = null,
): NodoPortal {
  return {
    tipo: 'contenedor',
    id: c.id,
    nombre: c.nombre,
    espacioUnico: c.espacio_unico,
    declaradoMovible: c.declarado_movible,
    // TAXONOMÍA FÍSICA: la consume la detección del nivel terminal (una CAJA es
    // contenido del espacio, no una división arquitectónica).
    tipoFisico: c.tipo,
    // Naturaleza física: un mueble inmueble fijo NO puede irse al limbo.
    esInmueble: c.es_inmueble,
    conDivisiones: c.subcontenedores_count > 0,
    // Contadores del padrón: badge de la tarjeta + ficha del Panel Izquierdo.
    objetosCount: c.objetos_count,
    subcontenedoresCount: c.subcontenedores_count,
    filas: c.grid_filas,
    columnasPorFila: columnasPorFilaDeContenedor(c),
    hijos: [],
    // Dueño del perímetro ámbar: la medida general vive en el Contenedor real.
    ui_width: c.ui_width,
    ui_height: c.ui_height,
    celda: celda ?? { fila: c.parent_grid_row, col: c.parent_grid_col },
  };
}

/**
 * Resuelve el interior de CUALQUIER nodo de la cascada: hijos jerárquicos
 * directos + objetos reales que cuelgan de él, más su grilla elástica.
 */
export async function cargarInteriorDeNodo(nodo: NodoPortal): Promise<InteriorNodo> {
  const hijos =
    nodo.tipo === 'habitacion'
      ? await contenedoresRaizDeUbicacion(nodo.id)
      : await contenedoresHijosDe(nodo.id);
  const objetos =
    nodo.tipo === 'habitacion'
      ? await objetosSueltosDeUbicacion(nodo.id)
      : await objetosDeContenedor(nodo.id);
  return {
    piezas: hijos.map((c) => nodoDesdeContenedor(c)),
    objetos,
    geometriaHijos: geometriaDe(hijos),
    filas: nodo.filas,
    columnasPorFila: nodo.columnasPorFila,
  };
}

/** Datos del nivel raíz: habitaciones de la planta + sus espacios internos. */
export async function datosDeNivelPlanta(plantaId: string | null): Promise<{
  plant: UbicacionPlano | null;
  rooms: UbicacionPlano[];
  espaciosPorRoom: Map<string, ContenedorDto[]>;
}> {
  const todas = await cargarUbicaciones();
  const plant = plantaId
    ? todas.find((u) => String(u.id) === plantaId && esDivisionUbicacion(u)) ?? null
    : null;
  const rooms = filtrarEspaciosDePlano(
    todas.filter(
      (u) => !esDivisionUbicacion(u) && (!plantaId || u.parent_ubicacion === plantaId),
    ),
  );
  const conts = await cargarContenedores();
  // CONTADOR = BLOQUES VISIBLES del lienzo: raíces + fusión colapsada.
  const espaciosPorRoom = indexarEspaciosVisiblesPorUbicacion(conts);
  return { plant, rooms, espaciosPorRoom };
}

// NOTA: la persistencia de los disyuntores `espacio_unico` y `declarado_movible`
// vive en ./disyuntoresPersistencia.ts (mismo contrato de PUT parcial), para no
// engordar este módulo de datos por encima del límite de mantenibilidad.


