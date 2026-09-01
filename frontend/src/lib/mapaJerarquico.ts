// =============================================================================
// MAPA ESTOK - divisiones con sub-grillas matriciales y minimapas naranjas
// -----------------------------------------------------------------------------
// Implementa el sistema visual del bosquejo:
//   1. Mapa Estok: cada FILA es una división nombrada (Ubicacion con
//      parent_grid_row = N y parent_grid_col = null) que define su PROPIA
//      sub-grilla interna configurable (Filas Internas × Columnas por fila,
//      asimétrica tipo [3,2,2]).
//   2. Habitaciones (Nivel 2): se encastran por Drag & Drop en las celdas de
//      la sub-grilla de la división; el PUT /api/ubicaciones/{id}/ persiste
//      parent_ubicacion (division) + parent_grid_row + parent_grid_col (int).
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

// =============================================================================
// MINIMAPAS (selectores naranjas)
// =============================================================================

/** Minimapa de la planta/división: pinta en naranja el cuadrante de una Ubicación. */
export function minimapaPlantaHtml(
  filas: number,
  columnas: number,
  u: UbicacionPlano | null | undefined,
  columnasPorFila?: number[] | null,
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
      columnasPorFila: columnasPorFila ?? undefined,
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
// MAPA ESTOK - DIVISIONES DE FILA CON SUB-GRILLAS MATRICIALES
// Cada división (Ubicacion con parent_grid_row=N, parent_grid_col=null) define
// su propia sub-grilla interna (Filas Internas × Columnas por fila, asimétrica)
// donde se encastran las habitaciones (Nivel 2) vía parent_ubicacion + coords.
// =============================================================================

/** Filas internas de una división (1..12). */
export function filasInternasDe(div: UbicacionPlano): number {
  return Math.max(1, Math.min(12, Math.floor(Number(div.grid_filas) || 3)));
}

/** Columnas por defecto de una división (1..12). */
export function columnasInternasDe(div: UbicacionPlano): number {
  return Math.max(1, Math.min(12, Math.floor(Number(div.grid_columnas) || 3)));
}

/** Columnas de una fila interna específica (asimétrica vía grid_filas_config). */
export function columnasDeFilaInterna(div: UbicacionPlano, filaInterna: number): number {
  const def = columnasInternasDe(div);
  const cfg = Array.isArray(div.grid_filas_config) && div.grid_filas_config.length >= filasInternasDe(div)
    ? div.grid_filas_config
    : null;
  if (cfg) {
    const c = Math.floor(Number(cfg[filaInterna - 1]));
    return Number.isFinite(c) && c > 0 ? Math.min(12, c) : def;
  }
  return def;
}

/** Habitación encastrada: ocupa el 100% del cuadrante y abre el Visor al clic. */
function habitacionNestedHtml(u: UbicacionPlano): string {
  return `<div class="mapa-celda-hab" data-seleccionar-habitacion="${u.id}" title="Ver «${escapeHtml(u.nombre)}» en el Visor">
    <span class="mapa-celda-hab-ico">🏠</span>
    <span class="mapa-celda-hab-nombre">${escapeHtml(u.nombre)}</span>
    <em class="mapa-celda-hab-meta">F${u.parent_grid_row}·C${u.parent_grid_col}</em>
  </div>`;
}

/** Sub-grilla matricial de una división (filas internas × columnas por fila). */
function divisionSubgridHtml(opts: {
  division: UbicacionPlano;
  fila: number;
  habitaciones: UbicacionPlano[];
  filaActiva: number | null;
}): string {
  const { division, fila, habitaciones, filaActiva } = opts;
  const id = division.id;
  const filasInt = filasInternasDe(division);
  const habs = habitaciones.filter((h) => h.parent_ubicacion === id);
  const legacy = habitaciones.filter((h) => !h.parent_ubicacion && h.parent_grid_row === fila);

  const filasHtml: string[] = [];
  for (let r = 1; r <= filasInt; r++) {
    const cols = columnasDeFilaInterna(division, r);
    const celdas: string[] = [];
    for (let c = 1; c <= cols; c++) {
      const hab = habs.find((h) => h.parent_grid_row === r && h.parent_grid_col === c);
      celdas.push(`
        <div class="mapa-celda${hab ? ' mapa-celda-ocupada' : ''}" data-celda-division="${id}" data-celda-row="${r}" data-celda-col="${c}" title="Soltá una habitación aquí">
          ${hab ? habitacionNestedHtml(hab) : '<span class="mapa-celda-vacia">＋</span>'}
        </div>`);
    }
    filasHtml.push(`
      <div class="mapa-fila-interna">
        <div class="mapa-fila-interna-cab">
          <span class="mapa-fila-interna-etiqueta">Fila ${r}</span>
          <span class="mapa-cols-control">
            <button type="button" class="num-btn" data-div-cols="menos" data-division="${id}" data-fila="${r}" title="Quitar columna a la fila ${r}">−</button>
            <input type="number" class="num-input" min="1" max="12" value="${cols}" readonly data-div-cols-input="${id}" data-fila="${r}" aria-label="Columnas de la fila interna ${r}" />
            <button type="button" class="num-btn" data-div-cols="mas" data-division="${id}" data-fila="${r}" title="Agregar columna a la fila ${r}">+</button>
          </span>
        </div>
        <div class="mapa-fila-interna-celdas" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));">
          ${celdas.join('')}
        </div>
      </div>`);
  }

  return `
  <div class="mapa-fila${filaActiva === fila ? ' mapa-fila-activa' : ''}" data-fila="${fila}" data-division-id="${id}">
    <div class="mapa-fila-encabezado" data-fila-select="${fila}" title="Seleccionar la división «${escapeHtml(division.nombre)}»">
      <span class="mapa-fila-ico">🗂️</span>
      <input class="mapa-fila-nombre" data-nombre-division="${id}" data-fila="${fila}" value="${escapeHtml(division.nombre)}" aria-label="Nombre de la división (fila ${fila})" />
      <span class="mapa-filas-internas-control">
        <span class="mapa-filas-internas-etiqueta">Filas</span>
        <span class="num-control">
          <button type="button" class="num-btn" data-div-filas="menos" data-division="${id}" title="Quitar fila interna">−</button>
          <input type="number" class="num-input" min="1" max="12" value="${filasInt}" readonly data-div-filas-input="${id}" aria-label="Filas internas de la división" />
          <button type="button" class="num-btn" data-div-filas="mas" data-division="${id}" title="Agregar fila interna">+</button>
        </span>
      </span>
      <span class="mapa-fila-meta">${habs.length} encastrada${habs.length === 1 ? '' : 's'}${legacy.length ? ` · ${legacy.length} suelta${legacy.length === 1 ? '' : 's'}` : ''}</span>
    </div>
    <div class="mapa-fila-cuerpo" data-fila-drop="${fila}">
      <div class="mapa-subgrid">${filasHtml.join('')}</div>
      ${legacy.length ? `<div class="mapa-fila-legacy"><span class="mapa-fila-legacy-titulo">Sueltas:</span>${legacy.map((h) => habitacionMiniChip(h)).join('')}</div>` : ''}
    </div>
  </div>`;
}

/** Renderiza el Mapa Estok como filas-división con sub-grillas matriciales. */
export function mapaEstokFilasHtml(opts: {
  filas: number;
  divisiones: UbicacionPlano[];
  habitaciones: UbicacionPlano[];
  filaActiva: number | null;
}): string {
  const { filas, divisiones, habitaciones, filaActiva } = opts;

  const nombreDeFila = (f: number): string =>
    (f === 1 ? ETIQUETAS_PISO[PISO_PRIMERO] : f === 2 ? ETIQUETAS_PISO[PISO_BAJA] : `División ${f}`);

  const filasHtml: string[] = [];
  for (let f = 1; f <= filas; f++) {
    const div = divisiones.find((d) => d.parent_grid_row === f);
    if (div) {
      filasHtml.push(divisionSubgridHtml({ division: div, fila: f, habitaciones, filaActiva }));
    } else {
      // Fila sin división persistida: placeholder con acción de creación en caliente.
      filasHtml.push(`
      <div class="mapa-fila mapa-fila-sin-division" data-fila="${f}">
        <div class="mapa-fila-encabezado">
          <span class="mapa-fila-ico">🗂️</span>
          <span class="mapa-fila-nombre-plano">${escapeHtml(nombreDeFila(f))}</span>
          <button type="button" class="mapa-fila-crear" data-crear-division="${f}" title="Crear esta división en caliente">➕ Crear división</button>
        </div>
        <div class="mapa-fila-cuerpo">
          <span class="mapa-fila-vacio">Esta fila aún no es una división. Creala para configurar su sub-grilla y encastrar habitaciones.</span>
        </div>
      </div>`);
    }
  }

  return `<div class="mapa-estok-filas">${filasHtml.join('')}</div>`;
}

/** Chip compacto de habitación suelta (sin encastre) dentro de una división. */
function habitacionMiniChip(u: UbicacionPlano): string {
  const col = u.parent_grid_col ? ` · C${u.parent_grid_col}` : '';
  return `<span class="mapa-fila-hab" data-seleccionar-habitacion="${u.id}" title="Ver «${escapeHtml(u.nombre)}» en el Visor">🏠 ${escapeHtml(u.nombre)}<em>F${u.parent_grid_row}${col}</em></span>`;
}
