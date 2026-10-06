// =============================================================================
// MAPA ESTOK - NÚCLEO DE DATOS (tipos, constantes y acceso a la API)
// -----------------------------------------------------------------------------
// Capa base del mapa jerárquico: expone las constantes de piso, las interfaces
// EstokConfig / UbicacionPlano, las utilidades compartidas (escapeHtml, toast) y
// las funciones de acceso a datos (fetchUbicacionesPlano y los filtros de
// deduplicación de grupos fusionados, guardarEstokGrid, guardarUbicacion,
// crearDivisionUbicacion, eliminarUbicacion, fetchEstokConfig).
//
// Aislamiento multi-tenant: toda lectura/escritura usa getAuthHeaders()
// (header X-Estok-Id) contra los endpoints validados por el backend.
// =============================================================================

import { getAuthHeaders, getEstokActivoId, API_BASE_URL, normalizarUrlApi } from '../../services/auth';

// =============================================================================
// CONSTANTES
// =============================================================================

export const PISO_PRIMERO = 'PRIMER_PISO';
export const PISO_BAJA = 'PLANTA_BAJA';

export const ETIQUETAS_PISO: Record<string, string> = {
  [PISO_PRIMERO]: '1er piso',
  [PISO_BAJA]: 'Planta baja',
};


// =============================================================================
// TIPOS
// =============================================================================

export interface EstokConfig {
  id: string;
  nombre: string;
  tipo_layout: string;
  /** Cantidad de plantas (pisos) del inmueble: >1 = Modo Casa, 1 = Planta Única. */
  cantidad_pisos: number;
  grid_filas: number;
  grid_columnas: number;
}

export interface UbicacionPlano {
  id: string;
  nombre: string;
  piso?: string;
  /** Pared donde se colocó la puerta arrastrable (TOP | BOTTOM | LEFT | RIGHT). */
  posicion_puerta?: string | null;
  /** División padre del Mapa Estok donde se encastra esta habitación. */
  parent_ubicacion?: string | null;
  parent_ubicacion_nombre?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  grid_colspan?: number | null;
  grid_rowspan?: number | null;
  /** Sub-grilla interna de la división: filas internas / columnas / asimétrica. */
  grid_filas?: number | null;
  grid_columnas?: number | null;
  grid_filas_config?: number[] | null;
  largo?: string | number | null;
  ancho?: string | number | null;
  alto?: string | number | null;
  foto?: string | null;
  /** Medidas visuales de la tarjeta en el lienzo interactivo (resizing en vivo). */
  ui_width?: string | null;
  ui_height?: string | null;
  /** Coordenadas elásticas del rectángulo libre (Modo Planta Única). */
  ui_left?: string | null;
  ui_top?: string | null;
  /** ID relacional del grupo de fusión (espacios en "L"): mismo valor = mismo espacio. */
  fusion_grupo?: string | null;
  contenedores_count?: number;
  objetos_count?: number;
  sububicaciones_count?: number;
}

// =============================================================================
// HELPERS
// =============================================================================

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function entero(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

export function toast(mensaje: string): void {
  let cont = document.getElementById('mapaJerarquicoToast');
  if (!cont) {
    cont = document.createElement('div');
    cont.id = 'mapaJerarquicoToast';
    cont.className = 'fixed bottom-6 right-6 z-[100] space-y-2 max-w-sm';
    document.body.appendChild(cont);
  }
  const el = document.createElement('div');
  el.className = 'bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg border border-gray-700';
  el.textContent = mensaje;
  cont.appendChild(el);
  setTimeout(() => {
    el.classList.add('opacity-0', 'transition-opacity', 'duration-300');
    setTimeout(() => el.remove(), 350);
  }, 2600);
}

// =============================================================================
// API (aislada por Estok activo)
// =============================================================================

export async function fetchEstokConfig(): Promise<EstokConfig | null> {
  const estokId = getEstokActivoId();
  if (!estokId) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/estoks/${estokId}/`, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    return {
      id: data.id,
      nombre: data.nombre || 'Mi Inventario',
      tipo_layout: data.tipo_layout || 'VISTA_PLANTA_UNICA',
      cantidad_pisos: entero(data.cantidad_pisos, data.tipo_layout === 'CASA_2_PISOS' ? 2 : 1),
      grid_filas: entero(data.grid_filas, 3),
      grid_columnas: entero(data.grid_columnas, 3),
    };
  } catch {
    return null;
  }
}

async function fetchTodos(url: string): Promise<any[]> {
  const todos: any[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('Sesión expirada');
    }
    if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
    const data = await res.json();
    todos.push(...(data.results || data));
    nextUrl = normalizarUrlApi(data.next);
  }
  return todos;
}

export async function fetchUbicacionesPlano(deduplicarGrupos = false): Promise<UbicacionPlano[]> {
  try {
    // Los selectores/desplegables pasan `true`: el backend colapsa cada espacio
    // fusionado en «L» (mismo `fusion_grupo`) a UNA sola fila. El lienzo 2D usa
    // el default y recibe TODOS los tiles (necesarios para la silueta continua).
    const filtroGrupos = deduplicarGrupos ? '&deduplicar_grupos=1' : '';
    const data = await fetchTodos(`${API_BASE_URL}/ubicaciones/?page_size=1000${filtroGrupos}`);
    return data.map((u) => ({
      id: u.id,
      nombre: u.nombre,
      piso: u.piso || PISO_BAJA,
      posicion_puerta: u.posicion_puerta ?? null,
      parent_ubicacion: u.parent_ubicacion ?? null,
      parent_ubicacion_nombre: u.parent_ubicacion_nombre ?? null,
      parent_grid_row: u.parent_grid_row ?? null,
      parent_grid_col: u.parent_grid_col ?? null,
      grid_colspan: entero(u.grid_colspan, 1),
      grid_rowspan: entero(u.grid_rowspan, 1),
      grid_filas: u.grid_filas != null ? entero(u.grid_filas, 3) : null,
      grid_columnas: u.grid_columnas != null ? entero(u.grid_columnas, 3) : null,
      grid_filas_config: Array.isArray(u.grid_filas_config) ? u.grid_filas_config : null,
      ui_width: typeof u.ui_width === 'string' ? u.ui_width : null,
      ui_height: typeof u.ui_height === 'string' ? u.ui_height : null,
      ui_left: typeof u.ui_left === 'string' ? u.ui_left : null,
      ui_top: typeof u.ui_top === 'string' ? u.ui_top : null,
      fusion_grupo: u.fusion_grupo ?? null,
      contenedores_count: u.contenedores_count || 0,
      objetos_count: u.objetos_count || 0,
    }));
  } catch {
    return [];
  }
}

export async function guardarEstokGrid(filas: number, columnas: number): Promise<boolean> {
  const estokId = getEstokActivoId();
  if (!estokId) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/estoks/${estokId}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ grid_filas: filas, grid_columnas: columnas }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (!res.ok) {
      toast('⚠️ Solo el admin del Estok puede cambiar la grilla del macro-Estok.');
      return false;
    }
    return true;
  } catch {
    toast('❌ Error de conexión al guardar la grilla.');
    return false;
  }
}

export async function guardarUbicacion(id: string, data: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/ubicaciones/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Una Ubicación es DIVISIÓN del Mapa Estok si está posicionada en el
 * macro-plano (parent_grid_row) y NO está encastrada dentro de otra división
 * (sin parent_ubicacion). Cubre el modelo legacy (fila sin columna) y el del
 * wizard (celda fila × columna). Las habitaciones reales siempre tienen
 * parent_ubicacion.
 */
export function esDivisionUbicacion(u: UbicacionPlano): boolean {
  return Boolean(u.parent_grid_row && !u.parent_ubicacion);
}

/** Crea una división de fila (POST /api/ubicaciones/) con nombre, fila y sub-grilla. */
export async function crearDivisionUbicacion(
  nombre: string,
  fila: number,
  columnas: number,
): Promise<UbicacionPlano | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/ubicaciones/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre,
        piso: fila === 1 ? PISO_PRIMERO : PISO_BAJA,
        parent_grid_row: fila,
        parent_grid_col: null,
        grid_colspan: Math.max(1, columnas),
        grid_rowspan: 1,
        // Sub-grilla matricial inicial de la división: filas × columnas.
        grid_filas: 3,
        grid_columnas: Math.max(1, columnas),
        grid_filas_config: null,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    return {
      id: data.id,
      nombre: data.nombre,
      piso: data.piso || PISO_BAJA,
      parent_ubicacion: data.parent_ubicacion ?? null,
      parent_ubicacion_nombre: data.parent_ubicacion_nombre ?? null,
      parent_grid_row: data.parent_grid_row ?? fila,
      parent_grid_col: data.parent_grid_col ?? null,
      grid_colspan: entero(data.grid_colspan, 1),
      grid_rowspan: entero(data.grid_rowspan, 1),
      grid_filas: entero(data.grid_filas, 3),
      grid_columnas: entero(data.grid_columnas, Math.max(1, columnas)),
      grid_filas_config: Array.isArray(data.grid_filas_config) ? data.grid_filas_config : null,
      contenedores_count: 0,
      objetos_count: 0,
      sububicaciones_count: 0,
    };
  } catch {
    return null;
  }
}

/** Elimina una Ubicación (habitación o división) vía DELETE /api/ubicaciones/{id}/. */
export async function eliminarUbicacion(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/ubicaciones/${id}/`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}
