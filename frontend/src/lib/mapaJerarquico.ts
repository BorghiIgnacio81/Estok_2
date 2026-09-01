// =============================================================================
// MAPA ESTOK - filas como divisiones, minimapas jerárquicos y selectores naranjas
// -----------------------------------------------------------------------------
// Implementa el sistema visual del bosquejo:
//   1. Mapa Estok: cada FILA es una división nombrada persistida como
//      Ubicacion con parent_grid_row = N y parent_grid_col = null. Al
//      incrementar Filas se exige el nombre y se POSTea la nueva división.
//   2. Habitaciones (Nivel 2): se arrastran sobre CUALQUIER fila y quedan
//      ancladas a esa división con sus coordenadas (PUT /api/ubicaciones/{id}/).
//   3. Minimapas: la ficha técnica de contenedor pinta en NARANJA (#f97316)
//      el cuadrante exacto de su Ubicación.
//
// Aislamiento multi-tenant: todas las lecturas/escrituras usan
// getAuthHeaders() (header X-Estok-Id) y endpoints validados por el backend.
// =============================================================================

import { getAuthHeaders, getEstokActivoId, API_BASE_URL } from '../services/auth';
import { minimapaHtml, COLOR_NARANJA } from './minimapa';

// =============================================================================
// CONSTANTES
// =============================================================================

export const PISO_PRIMERO = 'PRIMER_PISO';
export const PISO_BAJA = 'PLANTA_BAJA';

export const ETIQUETAS_PISO: Record<string, string> = {
  [PISO_PRIMERO]: '1er piso',
  [PISO_BAJA]: 'Planta baja',
};

export { COLOR_NARANJA };

// =============================================================================
// TIPOS
// =============================================================================

export interface EstokConfig {
  id: string;
  nombre: string;
  tipo_layout: string;
  grid_filas: number;
  grid_columnas: number;
}

export interface UbicacionPlano {
  id: string;
  nombre: string;
  piso?: string;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  grid_colspan?: number | null;
  grid_rowspan?: number | null;
  contenedores_count?: number;
  objetos_count?: number;
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
    nextUrl = data.next;
  }
  return todos;
}

export async function fetchUbicacionesPlano(): Promise<UbicacionPlano[]> {
  try {
    const data = await fetchTodos(`${API_BASE_URL}/ubicaciones/?page_size=1000`);
    return data.map((u) => ({
      id: u.id,
      nombre: u.nombre,
      piso: u.piso || PISO_BAJA,
      parent_grid_row: u.parent_grid_row ?? null,
      parent_grid_col: u.parent_grid_col ?? null,
      grid_colspan: entero(u.grid_colspan, 1),
      grid_rowspan: entero(u.grid_rowspan, 1),
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
 * Una Ubicacion es DIVISIÓN de fila del Mapa Estok si tiene fila
 * (parent_grid_row) pero NINGUNA columna (parent_grid_col == null).
 * Las habitaciones reales siempre tienen fila Y columna.
 */
export function esDivisionUbicacion(u: UbicacionPlano): boolean {
  return Boolean(u.parent_grid_row && !u.parent_grid_col);
}

/** Crea una división de fila (POST /api/ubicaciones/) con nombre y fila. */
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
      parent_grid_row: data.parent_grid_row ?? fila,
      parent_grid_col: data.parent_grid_col ?? null,
      grid_colspan: entero(data.grid_colspan, 1),
      grid_rowspan: entero(data.grid_rowspan, 1),
      contenedores_count: 0,
      objetos_count: 0,
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

// =============================================================================
// MINIMAPAS (selectores naranjas)
// =============================================================================

/** Minimapa de la planta: pinta en naranja el cuadrante de una Ubicación. */
export function minimapaPlantaHtml(
  filas: number,
  columnas: number,
  u: UbicacionPlano | null | undefined,
): string {
  if (!u) {
    return `<div class="minimapa-planta minimapa-planta-vacia">📍 Sin ubicación</div>`;
  }
  if (!u.parent_grid_row || !u.parent_grid_col) {
    return `<div class="minimapa-planta minimapa-planta-vacia">📍 ${escapeHtml(u.nombre)} (sin cuadrante)</div>`;
  }
  return `<div class="minimapa-planta">
    ${minimapaHtml({
      filas,
      columnas,
      fila: u.parent_grid_row,
      columna: u.parent_grid_col,
      titulo: `📍 ${u.piso ? (ETIQUETAS_PISO[u.piso] || 'Planta') : 'Planta'}`,
      detalle: escapeHtml(u.nombre),
      color: COLOR_NARANJA,
    })}
  </div>`;
}

/** Minimapa interno: replica la grilla del contenedor padre y pinta la sección. */
export function minimapaInternoHtml(
  filas: number,
  columnas: number,
  fila: number | null | undefined,
  columna: number | null | undefined,
  columnasPorFila?: number[] | null,
): string {
  if (!fila || !columna) {
    return `<div class="minimapa-interno minimapa-interno-vacio">▫ Sin sección</div>`;
  }
  return `<div class="minimapa-interno">
    ${minimapaHtml({
      filas,
      columnas,
      columnasPorFila: columnasPorFila ?? undefined,
      fila,
      columna,
      titulo: 'Sección en contenedor',
      detalle: `Casillero F${fila}·C${columna}`,
      color: COLOR_NARANJA,
    })}
  </div>`;
}

// =============================================================================
// MAPA ESTOK - FILAS COMO DIVISIONES (contenedores Drag & Drop nombrados)
// Cada fila del Mapa Estok es una división persistida como Ubicacion con
// parent_grid_row = N y parent_grid_col = null (esDivisionUbicacion).
// =============================================================================

/** Renderiza el Mapa Estok como filas-división, cada una un drop target vivo. */
export function mapaEstokFilasHtml(opts: {
  filas: number;
  columnas: number;
  divisiones: UbicacionPlano[];
  habitaciones: UbicacionPlano[];
  filaActiva: number | null;
}): string {
  const { filas, columnas, divisiones, habitaciones, filaActiva } = opts;

  const nombreDeFila = (f: number): { id: string | null; nombre: string } => {
    const div = divisiones.find((d) => d.parent_grid_row === f);
    const nombre =
      div?.nombre ||
      (f === 1 ? ETIQUETAS_PISO[PISO_PRIMERO] : f === 2 ? ETIQUETAS_PISO[PISO_BAJA] : `División ${f}`);
    return { id: div?.id ?? null, nombre };
  };

  const filasHtml: string[] = [];
  for (let f = 1; f <= filas; f++) {
    const { id, nombre } = nombreDeFila(f);
    const habs = habitaciones.filter((h) => h.parent_grid_row === f);
    filasHtml.push(`
    <div class="mapa-fila${filaActiva === f ? ' mapa-fila-activa' : ''}" data-fila="${f}">
      <div class="mapa-fila-encabezado" data-fila-select="${f}" title="Seleccionar la división «${escapeHtml(nombre)}»">
        <span class="mapa-fila-ico">🗂️</span>
        <input class="mapa-fila-nombre" data-nombre-division="${id ?? ''}" data-fila="${f}" value="${escapeHtml(nombre)}" aria-label="Nombre de la división (fila ${f})" />
        <span class="mapa-fila-meta">${habs.length} hab. · ${columnas} celdas</span>
      </div>
      <div class="mapa-fila-cuerpo" data-fila-drop="${f}" data-fila="${f}">
        ${habs.length ? habs.map((h) => habitacionMiniChip(h)).join('') : '<span class="mapa-fila-vacio">➕ Soltá habitaciones aquí</span>'}
      </div>
    </div>`);
  }

  return `<div class="mapa-estok-filas">${filasHtml.join('')}</div>`;
}

/** Chip compacto de habitación dentro de una fila-división del Mapa Estok. */
function habitacionMiniChip(u: UbicacionPlano): string {
  const col = u.parent_grid_col ? ` · C${u.parent_grid_col}` : '';
  return `<span class="mapa-fila-hab" data-ubicacion-id="${u.id}" title="${escapeHtml(u.nombre)}">🏠 ${escapeHtml(u.nombre)}<em>F${u.parent_grid_row}${col}</em></span>`;
}
