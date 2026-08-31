// =============================================================================
// MAPA JERÃƒÂRQUICO RECURSIVO - Minimapas jerÃƒÂ¡rquicos con selectores naranjas
// -----------------------------------------------------------------------------
// Implementa el sistema visual del bosquejo:
//   1. Macro-Estok en forma de casa (1er piso / Planta baja) con inputs de
//      Filas y Columnas a la derecha para su grilla estilo Word.
//   2. Plano de planta por piso: grilla configurable cuyos cuadrantes son
//      Ubicaciones con nombres editables y anchos variables (escala).
//      Arriba, una mini-casita pinta en NARANJA (#f97316) el piso activo.
//   3. Ficha tÃƒÂ©cnica de contenedor: minimapa de la planta en la esquina
//      superior izquierda pintando el cuadrante exacto de su UbicaciÃƒÂ³n.
//   4. Sub-contenedores: minimapa horizontal que replica la grilla interna
//      del contenedor padre y pinta en naranja el casillero de residencia.
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

export const TIPO_CASA_2_PISOS = 'CASA_2_PISOS';

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
      throw new Error('SesiÃƒÂ³n expirada');
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
      toast('Ã¢Å¡Â Ã¯Â¸Â Solo el admin del Estok puede cambiar la grilla del macro-Estok.');
      return false;
    }
    return true;
  } catch {
    toast('Ã¢ÂÅ’ Error de conexiÃƒÂ³n al guardar la grilla.');
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

// =============================================================================
// SVG DE LA CASA (Macro-Estok) + MINI-CASITA
// =============================================================================

/** Casa con silueta, dividida horizontalmente en "1er piso" y "Planta baja". */
export function casaSvgHtml(pisoActivo: string | null, filas: number, columnas: number): string {
  const activo1 = pisoActivo === PISO_PRIMERO;
  const activo0 = pisoActivo === PISO_BAJA;
  const base = '#fef3c7';
  const borde = '#d97706';
  return `
  <svg class="macro-casa-svg" viewBox="0 0 220 168" role="img" aria-label="Macro-Estok: casa de dos pisos (${filas}Ãƒâ€”${columnas})">
    <!-- Techo -->
    <polygon points="20,54 110,6 200,54" fill="${base}" stroke="${borde}" stroke-width="2" stroke-linejoin="round" />
    <polygon points="110,6 200,54 110,54" fill="#fde68a" opacity="0.45" />
    <!-- 1er piso -->
    <rect x="20" y="54" width="180" height="56" rx="6" fill="${activo1 ? COLOR_NARANJA : base}" stroke="${borde}" stroke-width="2" data-piso-select="${PISO_PRIMERO}" data-piso-drop="${PISO_PRIMERO}" />
    <text x="110" y="86" text-anchor="middle" font-size="14" font-weight="700" fill="${activo1 ? '#ffffff' : '#92400e'}">1er piso</text>
    <text x="110" y="102" text-anchor="middle" font-size="9" fill="${activo1 ? '#ffedd5' : '#b45309'}">drag &amp; drop</text>
    <line x1="20" y1="110" x2="200" y2="110" stroke="#b45309" stroke-width="2" />
    <!-- Planta baja -->
    <rect x="20" y="110" width="180" height="56" rx="6" fill="${activo0 ? COLOR_NARANJA : base}" stroke="${borde}" stroke-width="2" data-piso-select="${PISO_BAJA}" data-piso-drop="${PISO_BAJA}" />
    <text x="110" y="142" text-anchor="middle" font-size="14" font-weight="700" fill="${activo0 ? '#ffffff' : '#92400e'}">Planta baja</text>
    <text x="110" y="158" text-anchor="middle" font-size="9" fill="${activo0 ? '#ffedd5' : '#b45309'}">drag &amp; drop</text>
  </svg>`;
}

/** Icono compacto de casita con el piso activo pintado en naranja. */
export function minicasitaHtml(pisoActivo: string | null): string {
  const activo1 = pisoActivo === PISO_PRIMERO;
  const activo0 = pisoActivo === PISO_BAJA;
  return `
  <svg class="minicasita" width="44" height="40" viewBox="0 0 44 40" aria-hidden="true">
    <polygon points="5,17 22,3 39,17" fill="#fde68a" stroke="#b45309" stroke-width="1.5" />
    <rect x="5" y="17" width="34" height="11.5" rx="2" fill="${activo1 ? COLOR_NARANJA : '#fef3c7'}" stroke="#b45309" stroke-width="1.5" />
    <rect x="5" y="28.5" width="34" height="11.5" rx="2" fill="${activo0 ? COLOR_NARANJA : '#fef3c7'}" stroke="#b45309" stroke-width="1.5" />
  </svg>`;
}

// =============================================================================
// MINIMAPAS (selectores naranjas)
// =============================================================================

/** Minimapa de la planta: pinta en naranja el cuadrante de una UbicaciÃƒÂ³n. */
export function minimapaPlantaHtml(
  filas: number,
  columnas: number,
  u: UbicacionPlano | null | undefined,
): string {
  if (!u) {
    return `<div class="minimapa-planta minimapa-planta-vacia">Ã°Å¸â€œÂ Sin ubicaciÃƒÂ³n</div>`;
  }
  if (!u.parent_grid_row || !u.parent_grid_col) {
    return `<div class="minimapa-planta minimapa-planta-vacia">Ã°Å¸â€œÂ ${escapeHtml(u.nombre)} (sin cuadrante)</div>`;
  }
  return `<div class="minimapa-planta">
    ${minimapaHtml({
      filas,
      columnas,
      fila: u.parent_grid_row,
      columna: u.parent_grid_col,
      titulo: `Ã°Å¸â€œÂ ${u.piso ? (ETIQUETAS_PISO[u.piso] || 'Planta') : 'Planta'}`,
      detalle: escapeHtml(u.nombre),
      color: COLOR_NARANJA,
    })}
  </div>`;
}

/** Minimapa interno: replica la grilla del contenedor padre y pinta la secciÃƒÂ³n. */
export function minimapaInternoHtml(
  filas: number,
  columnas: number,
  fila: number | null | undefined,
  columna: number | null | undefined,
): string {
  if (!fila || !columna) {
    return `<div class="minimapa-interno minimapa-interno-vacio">Ã¢â€“Â« Sin secciÃƒÂ³n</div>`;
  }
  return `<div class="minimapa-interno">
    ${minimapaHtml({
      filas,
      columnas,
      fila,
      columna,
      titulo: 'SecciÃƒÂ³n en contenedor',
      detalle: `Casillero F${fila}Ã‚Â·C${columna}`,
      color: COLOR_NARANJA,
    })}
  </div>`;
}


// =============================================================================
// PLANO DE PLANTA (grilla estilo Word con nombres editables y escalas)
// =============================================================================

export function planoPlantaHtml(opts: {
  filas: number;
  columnas: number;
  piso: string;
  ubicaciones: UbicacionPlano[];
  esCasa: boolean;
}): string {
  const { filas, columnas, piso, esCasa } = opts;
  const delPiso = esCasa ? opts.ubicaciones.filter((u) => u.piso === piso) : opts.ubicaciones;
  const asignadas = delPiso.filter((u) => u.parent_grid_row && u.parent_grid_col);
  const sinAsignar = delPiso.filter((u) => !u.parent_grid_row || !u.parent_grid_col);
  const tituloPiso = ETIQUETAS_PISO[piso] || piso;

  const ocupadas = new Set<string>();
  const tiles: string[] = [];

  for (const u of asignadas) {
    const r = u.parent_grid_row!;
    const c = u.parent_grid_col!;
    const cs = Math.min(Math.max(1, u.grid_colspan || 1), Math.max(1, columnas - c + 1));
    const rs = Math.min(Math.max(1, u.grid_rowspan || 1), Math.max(1, filas - r + 1));
    for (let rr = r; rr < r + rs; rr++) {
      for (let cc = c; cc < c + cs; cc++) ocupadas.add(`${rr}-${cc}`);
    }
    tiles.push(`
      <div class="plano-habitacion" data-ubicacion-id="${u.id}" data-grid-row="${r}" data-grid-col="${c}" data-colspan="${cs}" data-rowspan="${rs}" draggable="true" title="ArrastrÃƒÂ¡ sobre un piso de la casa para cambiar de nivel"
        style="grid-column: ${c} / span ${cs}; grid-row: ${r} / span ${rs};">
        <input class="plano-habitacion-nombre" data-nombre-ubicacion="${u.id}" value="${escapeHtml(u.nombre)}" aria-label="Nombre de la habitaciÃƒÂ³n" />
        <div class="plano-escala">
          <span class="escala-btn" data-escala="menos" data-eje="colspan" data-ubicacion="${u.id}" title="Reducir ancho">Ã¢Ë†â€™</span>
          <span class="escala-valor">${cs}Ãƒâ€”${rs}</span>
          <span class="escala-btn" data-escala="mas" data-eje="colspan" data-ubicacion="${u.id}" title="Ampliar ancho">+</span>
          <span class="escala-sep">Ã‚Â·</span>
          <span class="escala-btn" data-escala="menos" data-eje="rowspan" data-ubicacion="${u.id}" title="Reducir alto">Ã¢Ë†â€™</span>
          <span class="escala-valor">${rs}</span>
          <span class="escala-btn" data-escala="mas" data-eje="rowspan" data-ubicacion="${u.id}" title="Ampliar alto">+</span>
        </div>
        <p class="plano-habitacion-meta">Ã°Å¸â€œÂ¦ ${u.contenedores_count || 0} Ã‚Â· Ã°Å¸Â§Âº ${u.objetos_count || 0}</p>
      </div>`);
  }

  for (let r = 1; r <= filas; r++) {
    for (let c = 1; c <= columnas; c++) {
      if (!ocupadas.has(`${r}-${c}`)) {
        tiles.push(`
          <div class="plano-celda-libre" data-celda-libre data-grid-row="${r}" data-grid-col="${c}" data-piso="${piso}" title="HacÃƒÂ© clic para diagramar una habitaciÃƒÂ³n libre aquÃƒÂ­">Ã¢Å¾â€¢</div>`);
      }
    }
  }

  return `
  <div class="plano-planta-seccion">
    <div class="plano-planta-encabezado">
      <div class="plano-planta-titulo">
        ${minicasitaHtml(piso)}
        <div>
          <h4 class="plano-planta-nombre">Plano de planta: ${tituloPiso}</h4>
          <p class="plano-planta-sub">Grilla estilo Word ${filas}Ãƒâ€”${columnas} Ã‚Â· nombres editables y anchos variables</p>
        </div>
      </div>
      <span class="plano-planta-badge">${asignadas.length}/${delPiso.length} habitaciones</span>
    </div>
    <div class="plano-planta" data-piso="${piso}" style="grid-template-columns: repeat(${columnas}, minmax(0, 1fr)); grid-template-rows: repeat(${filas}, minmax(72px, auto));">
      ${tiles.join('')}
    </div>
    ${sinAsignar.length ? `
    <div class="plano-sin-casillero">
      <p class="plano-sin-casillero-titulo">Ã°Å¸â€œÂ Habitaciones sin diagramar (clic en una celda libre para asignarlas):</p>
      <div class="plano-sin-casillero-lista">
        ${sinAsignar.map((u) => `<span class="chipsin">${escapeHtml(u.nombre)}</span>`).join('')}
      </div>
    </div>` : ''}
  </div>`;
}

