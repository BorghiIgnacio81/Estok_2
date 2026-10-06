// =============================================================================
// MAPA ESTOK - TRANSFORMACIONES Y ENCASTRE DE TILES
// -----------------------------------------------------------------------------
// Motor de render del mapa jerárquico:
//   - Sub-grillas matriciales por división (filas internas × columnas por fila,
//     asimétrica vía grid_filas_config) con el encastre de habitaciones.
//   - Render del Mapa Estok como filas-división (mapaEstokFilasHtml).
//   - Minimapas naranjas de planta y de sección interna (minimapaPlantaHtml /
//     minimapaInternoHtml).
//
// Depende del núcleo de datos en mapaQueries.ts (tipos, constantes y escapeHtml).
// =============================================================================

import { minimapaHtml, COLOR_NARANJA } from '../minimapa';
import { escapeHtml, ETIQUETAS_PISO, PISO_PRIMERO, PISO_BAJA } from './mapaQueries';
import type { UbicacionPlano } from './mapaQueries';

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
