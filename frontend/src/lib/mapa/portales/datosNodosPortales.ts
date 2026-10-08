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
import { toast, esDivisionUbicacion, filasInternasDe, columnasDeFilaInterna } from '../../mapaJerarquico';
import type { UbicacionPlano } from '../../mapaJerarquico';
import type { ItemGeometria } from '../../sectoresMinimapa';
import type { NodoPortal } from './estadoPortales';

/** Contenedor del padrón, normalizado para la cascada. */
export interface ContenedorDto {
  id: string;
  nombre: string;
  tipo: string;
  es_inmueble: boolean;
  espacio_unico: boolean;
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

function normalizarContenedor(c: Record<string, unknown>): ContenedorDto {
  const config = Array.isArray(c.grid_filas_config) ? (c.grid_filas_config as unknown[]) : null;
  return {
    id: String(c.id),
    nombre: String(c.nombre || 'Contenedor'),
    tipo: String(c.tipo || '').toUpperCase(),
    es_inmueble: Boolean(c.es_inmueble),
    // 🧱 Disyuntor de estructura: bloque monolítico declarado en la base.
    espacio_unico: Boolean(c.espacio_unico),
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
  };
}

/** Invalida la caché (se llama al recibir `estok:espacios-cambiados`). */
export function invalidarCachePortales(): void {
  cacheUbicaciones = null;
  cacheContenedores = null;
  cacheObjetos = null;
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
// CONSULTAS DE JERARQUÍA (sobre la caché, cero N+1)
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
  const rooms = todas.filter((u) => !esDivisionUbicacion(u));
  if (!plantaId) return rooms;
  return rooms.filter((r) => r.parent_ubicacion === plantaId);
}

/** Contenedores RAÍZ de una habitación (los espacios/muebles del cuarto). */
export async function contenedoresRaizDeUbicacion(ubicacionId: string): Promise<ContenedorDto[]> {
  const conts = await cargarContenedores();
  return conts.filter((c) => c.ubicacion === ubicacionId && !c.parent_contenedor);
}

/** Hijos DIRECTOS de un contenedor a cualquier profundidad. */
export async function contenedoresHijosDe(padreId: string): Promise<ContenedorDto[]> {
  const conts = await cargarContenedores();
  return conts.filter((c) => c.parent_contenedor === padreId);
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
    conDivisiones: espaciosInternos.length > 0,
    filas,
    columnasPorFila,
    hijos: geometriaDe(espaciosInternos),
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
    conDivisiones: c.subcontenedores_count > 0,
    filas: c.grid_filas,
    columnasPorFila: columnasPorFilaDeContenedor(c),
    hijos: [],
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
  const rooms = todas.filter(
    (u) => !esDivisionUbicacion(u) && (!plantaId || u.parent_ubicacion === plantaId),
  );
  const conts = await cargarContenedores();
  const espaciosPorRoom = new Map<string, ContenedorDto[]>();
  for (const c of conts) {
    if (c.parent_contenedor || !c.ubicacion) continue;
    const lista = espaciosPorRoom.get(c.ubicacion) ?? [];
    lista.push(c);
    espaciosPorRoom.set(c.ubicacion, lista);
  }
  return { plant, rooms, espaciosPorRoom };
}



// -----------------------------------------------------------------------------
// PERSISTENCIA DEL DISYUNTOR «ESPACIO ÚNICO»
// -----------------------------------------------------------------------------

/**
 * Persiste el flag `espacio_unico` del nodo activo (Contenedor o Ubicación) con
 * PUT multi-tenant parcial: el backend acepta el payload de un solo campo y la
 * UI re-transiciona en caliente (bloque monolítico ⇄ grilla de divisiones).
 */
export async function guardarEspacioUnico(
  id: string,
  valor: boolean,
  recurso: 'contenedores' | 'ubicaciones' = 'contenedores',
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/${recurso}/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ espacio_unico: valor }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) return true;
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo guardar «Espacio Único».'));
    return false;
  } catch {
    toast('❌ Error de conexión al guardar «Espacio Único».');
    return false;
  }
}

