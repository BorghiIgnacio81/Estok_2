// =============================================================================
// MAPA DE ESTOK - WIZARD DE MODELADO ESPACIAL RECURSIVO (Niveles 1-4)
// -----------------------------------------------------------------------------
// Rediseño del flujo de creación de Estoks: al confirmar el nombre del nuevo
// Estok, en vez de cerrar el flujo se despliega el modal "Mapa de Estok".
//   - Nivel 1 (Macro-Plano): grilla raíz filas × columnas (asimétrica).
//   - Niveles 2-4 (Sub-divisiones): cada celda abre un sub-mapa anidado
//     (Habitaciones → Muebles grandes → Estanterías) con filas/columnas
//     independientes por nodo del árbol espacial.
//   - Minimapa de orientación: a partir del Nivel 2 se renderiza en la esquina
//     superior el cuadrante de procedencia pintado en NARANJA (#f97316).
// La persistencia es atómica: "Guardar Mapa" envía el payload jerárquico a
// POST /api/estoks/{id}/mapa/ (backend Django).
// =============================================================================

import { minimapaHtml, COLOR_NARANJA } from './minimapa';

// =============================================================================
// CONSTANTES
// =============================================================================

export const MAX_GRILLA = 12;
export const MIN_GRILLA = 1;
export const NIVEL_MAXIMO = 4;

export interface NivelInfo {
  nombre: string;
  icono: string;
  etiquetaCelda: string;
}

export const NIVELES: Record<number, NivelInfo> = {
  1: { nombre: 'Macro-Plano', icono: '🏢', etiquetaCelda: 'División' },
  2: { nombre: 'Habitaciones', icono: '🚪', etiquetaCelda: 'Habitación' },
  3: { nombre: 'Muebles grandes', icono: '🛋️', etiquetaCelda: 'Mueble' },
  4: { nombre: 'Estanterías', icono: '📚', etiquetaCelda: 'Estantería' },
};

// =============================================================================
// TIPOS DEL ESTADO
// =============================================================================

export interface CeldaWizard {
  nombre: string;
  grid_filas: number;
  grid_columnas: number;
  grid_filas_config: number[] | null;
  hijos: CeldaWizard[];
}

export interface MapaEstokWizardState {
  estokId: string;
  estokNombre: string;
  grid_filas: number;
  grid_columnas: number;
  grid_filas_config: number[] | null;
  celdas: CeldaWizard[];
  ruta: number[];
}

export interface VistaNodo {
  celdas: CeldaWizard[];
  filas: number;
  columnas: number;
  config: number[] | null;
  nombreNodo: string;
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

export function clampGrilla(v: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return MIN_GRILLA;
  return Math.max(MIN_GRILLA, Math.min(MAX_GRILLA, n));
}

export function nombreDefault(nivel: number, fila: number, col: number): string {
  const etiqueta = NIVELES[nivel]?.etiquetaCelda || 'Espacio';
  if (nivel === 1) {
    if (fila === 1 && col === 1) return 'Planta Alta';
    if (fila === 2 && col === 1) return 'Planta Baja';
  }
  return `${etiqueta} F${fila}·C${col}`;
}

export function crearCelda(nivel: number, fila: number, col: number): CeldaWizard {
  return {
    nombre: nombreDefault(nivel, fila, col),
    grid_filas: 2,
    grid_columnas: 2,
    grid_filas_config: null,
    hijos: [],
  };
}

export function columnasDeFila(filas: number, columnas: number, config: number[] | null, fila: number): number {
  if (fila < 1 || fila > filas) return MIN_GRILLA;
  if (config && fila <= config.length) {
    const c = Math.floor(Number(config[fila - 1]));
    if (Number.isFinite(c) && c >= MIN_GRILLA) return Math.min(MAX_GRILLA, c);
  }
  return Math.max(MIN_GRILLA, Math.min(MAX_GRILLA, columnas));
}

export function totalCeldas(filas: number, columnas: number, config: number[] | null): number {
  let total = 0;
  for (let f = 1; f <= filas; f++) total += columnasDeFila(filas, columnas, config, f);
  return total;
}

export function coordenadasDeIndice(
  indice: number,
  filas: number,
  columnas: number,
  config: number[] | null,
): { fila: number; col: number } {
  let restante = indice;
  for (let f = 1; f <= filas; f++) {
    const cols = columnasDeFila(filas, columnas, config, f);
    if (restante < cols) return { fila: f, col: restante + 1 };
    restante -= cols;
  }
  return { fila: filas, col: columnasDeFila(filas, columnas, config, filas) };
}

export function configPorFila(filas: number, columnas: number, config: number[] | null): number[] {
  const arr: number[] = [];
  for (let f = 1; f <= filas; f++) arr.push(columnasDeFila(filas, columnas, config, f));
  return arr;
}

export function normalizarConfig(arr: number[], columnas: number): number[] | null {
  return arr.every((c) => c === columnas) ? null : arr.slice();
}

export function reajustarCeldas(
  celdas: CeldaWizard[],
  filas: number,
  columnas: number,
  config: number[] | null,
  nivel: number,
): CeldaWizard[] {
  const total = totalCeldas(filas, columnas, config);
  const nuevas: CeldaWizard[] = [];
  for (let i = 0; i < total; i++) {
    if (i < celdas.length) {
      nuevas.push(celdas[i]);
    } else {
      const { fila, col } = coordenadasDeIndice(i, filas, columnas, config);
      nuevas.push(crearCelda(nivel, fila, col));
    }
  }
  return nuevas;
}

// =============================================================================
// NAVEGACIÓN POR EL ÁRBOL ESPACIAL
// =============================================================================

export function nivelActual(state: MapaEstokWizardState): number {
  return state.ruta.length + 1;
}

export function nodoDeRuta(state: MapaEstokWizardState, ruta: number[]): VistaNodo {
  if (ruta.length === 0) {
    return {
      celdas: state.celdas,
      filas: state.grid_filas,
      columnas: state.grid_columnas,
      config: state.grid_filas_config,
      nombreNodo: state.estokNombre,
    };
  }
  let nodo: CeldaWizard = state.celdas[ruta[0]];
  for (let i = 1; i < ruta.length; i++) {
    nodo = nodo.hijos[ruta[i]];
  }
  return {
    celdas: nodo.hijos,
    filas: nodo.grid_filas,
    columnas: nodo.grid_columnas,
    config: nodo.grid_filas_config,
    nombreNodo: nodo.nombre,
  };
}

/** Devuelve la celda VIVA de la ruta (null si la ruta apunta al nivel raíz). */
export function celdaDeRuta(state: MapaEstokWizardState, ruta: number[]): CeldaWizard | null {
  if (ruta.length === 0) return null;
  let nodo: CeldaWizard = state.celdas[ruta[0]];
  for (let i = 1; i < ruta.length; i++) {
    nodo = nodo.hijos[ruta[i]];
  }
  return nodo;
}

/** Nodo padre del nivel actual (para el minimapa naranja de orientación). */
export function padreDeRuta(state: MapaEstokWizardState, ruta: number[]): VistaNodo | null {
  if (ruta.length < 1) return null;
  return nodoDeRuta(state, ruta.slice(0, -1));
}

// =============================================================================
// PAYLOAD DE PERSISTENCIA (POST /api/estoks/{id}/mapa/)
// =============================================================================

export function construirPayload(state: MapaEstokWizardState): Record<string, unknown> {
  return {
    grid_filas: state.grid_filas,
    grid_columnas: state.grid_columnas,
    grid_filas_config: state.grid_filas_config,
    nivel_1: state.celdas.map((celda, indice) =>
      celdaPayload(celda, indice, state.grid_filas, state.grid_columnas, state.grid_filas_config, 1),
    ),
  };
}

function celdaPayload(
  celda: CeldaWizard,
  indice: number,
  filasPadre: number,
  columnasPadre: number,
  configPadre: number[] | null,
  nivel: number,
): Record<string, unknown> {
  const { fila, col } = coordenadasDeIndice(indice, filasPadre, columnasPadre, configPadre);
  const nodo: Record<string, unknown> = {
    nombre: celda.nombre || nombreDefault(nivel, fila, col),
    parent_grid_row: fila,
    parent_grid_col: col,
    grid_filas: celda.grid_filas,
    grid_columnas: celda.grid_columnas,
    grid_filas_config: celda.grid_filas_config,
  };
  if (nivel === 1) {
    nodo.nivel_2 = celda.hijos.map((h, i) =>
      celdaPayload(h, i, celda.grid_filas, celda.grid_columnas, celda.grid_filas_config, 2));
  } else if (nivel === 2) {
    nodo.nivel_3 = celda.hijos.map((h, i) =>
      celdaPayload(h, i, celda.grid_filas, celda.grid_columnas, celda.grid_filas_config, 3));
  } else if (nivel === 3) {
    nodo.nivel_4 = celda.hijos.map((h, i) =>
      celdaPayload(h, i, celda.grid_filas, celda.grid_columnas, celda.grid_filas_config, 4));
  }
  return nodo;
}


// =============================================================================
// RENDER (HTML string; el controlador UI lo inyecta y enlaza el DOM)
// =============================================================================

export function renderBreadcrumb(state: MapaEstokWizardState): string {
  const partes: string[] = [
    `<button type="button" class="wizard-crumb${state.ruta.length === 0 ? ' wizard-crumb-actual' : ''}" data-ir-nivel="0">${escapeHtml(state.estokNombre)}</button>`,
  ];
  const rutaAcumulada: number[] = [];
  for (let i = 0; i < state.ruta.length; i++) {
    rutaAcumulada.push(state.ruta[i]);
    const nodo = nodoDeRuta(state, rutaAcumulada);
    const esActual = i === state.ruta.length - 1;
    partes.push(
      '<span class="wizard-crumb-sep">›</span>',
      `<button type="button" class="wizard-crumb${esActual ? ' wizard-crumb-actual' : ''}" data-ir-nivel="${i + 1}">${escapeHtml(nodo.nombreNodo)}</button>`,
    );
  }
  return partes.join('');
}

/** Minimapa naranja (#f97316) con el cuadrante de procedencia del nivel anterior. */
export function renderMinimapa(state: MapaEstokWizardState): string {
  if (nivelActual(state) < 2) {
    return '<div class="wizard-minimapa-placeholder">Nivel 1 · minimapa disponible desde el Nivel 2</div>';
  }
  const padre = padreDeRuta(state, state.ruta);
  if (!padre) return '';
  const indiceOrigen = state.ruta[state.ruta.length - 1];
  const { fila, col } = coordenadasDeIndice(indiceOrigen, padre.filas, padre.columnas, padre.config);
  return `
    <div class="wizard-minimapa">
      <div class="wizard-minimapa-titulo">📍 Orientación · Nivel ${nivelActual(state) - 1} · estás en</div>
      ${minimapaHtml({
        filas: padre.filas,
        columnas: padre.columnas,
        columnasPorFila: padre.config ?? undefined,
        fila,
        columna: col,
        titulo: padre.nombreNodo,
        detalle: `F${fila}·C${col}`,
        color: COLOR_NARANJA,
      })}
    </div>`;
}

export function renderControlesGrilla(state: MapaEstokWizardState): string {
  const nodo = nodoDeRuta(state, state.ruta);
  const filasControles = configPorFila(nodo.filas, nodo.columnas, nodo.config)
    .map((cols, i) => `
      <span class="wizard-ctrl-fila">
        <span class="wizard-ctrl-fila-label">Fila ${i + 1}</span>
        <span class="num-control">
          <button type="button" class="num-btn" data-col-menos="${i + 1}" title="Quitar columna a la fila ${i + 1}">−</button>
          <input class="num-input" type="number" min="1" max="${MAX_GRILLA}" readonly value="${cols}" data-col-input="${i + 1}" aria-label="Columnas de la fila ${i + 1}" />
          <button type="button" class="num-btn" data-col-mas="${i + 1}" title="Agregar columna a la fila ${i + 1}">+</button>
        </span>
      </span>`)
    .join('');

  return `
    <div class="wizard-controles">
      <span class="macro-input-label">Filas del plano
        <span class="num-control">
          <button type="button" class="num-btn" data-filas-menos title="Quitar fila">−</button>
          <input class="num-input" type="number" min="1" max="${MAX_GRILLA}" readonly value="${nodo.filas}" data-filas-input aria-label="Filas del plano" />
          <button type="button" class="num-btn" data-filas-mas title="Agregar fila">+</button>
        </span>
      </span>
      <span class="macro-input-label">Columnas por fila (asimétrico)</span>
      <span class="wizard-ctrl-filas">${filasControles}</span>
    </div>`;
}

export function renderGrilla(state: MapaEstokWizardState): string {
  const nivel = nivelActual(state);
  const nodo = nodoDeRuta(state, state.ruta);
  const filasHtml: string[] = [];
  let indice = 0;
  for (let f = 1; f <= nodo.filas; f++) {
    const cols = columnasDeFila(nodo.filas, nodo.columnas, nodo.config, f);
    const celdasHtml: string[] = [];
    for (let c = 1; c <= cols; c++) {
      const celda = nodo.celdas[indice];
      celdasHtml.push(`
        <div class="wizard-celda" data-celda="${indice}">
          <span class="wizard-celda-coords">F${f}·C${c}</span>
          <input class="wizard-celda-nombre" data-nombre-celda="${indice}" value="${escapeHtml(celda?.nombre ?? '')}" maxlength="200" placeholder="${escapeHtml(nombreDefault(nivel, f, c))}" />
          <button type="button" class="wizard-entrar-btn" data-entrar="${indice}" ${nivel >= NIVEL_MAXIMO ? 'disabled title="Nivel máximo alcanzado"' : 'title="Entrar y subdividir"'}">🔍 Entrar</button>
        </div>`);
      indice++;
    }
    filasHtml.push(`<div class="wizard-fila" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));">${celdasHtml.join('')}</div>`);
  }
  return filasHtml.join('');
}


/** Vista completa del modal del wizard para el nivel actual. */
export function renderVistaWizard(state: MapaEstokWizardState): string {
  const nivel = nivelActual(state);
  const nodo = nodoDeRuta(state, state.ruta);
  const info = NIVELES[nivel];
  const esNivel1 = nivel === 1;
  return `
  <div class="wizard-overlay">
    <div class="wizard-modal">
      <div class="wizard-header">
        <div class="wizard-header-info">
          <h3 class="wizard-titulo">${info.icono} Mapa de Estok · Nivel ${nivel} — ${info.nombre}</h3>
          <p class="wizard-subtitulo">${esNivel1
            ? 'Paso obligatorio del alta: definí la distribución raíz. Nombra cada celda en caliente y usá «🔍 Entrar» para modelar su interior.'
            : `Sub-divisiones de «${escapeHtml(nodo.nombreNodo)}». Cada celda se nombra en caliente y puede subdividirse.`}</p>
        </div>
        <button type="button" class="wizard-cerrar" data-cerrar-wizard title="Cerrar sin guardar">✕</button>
      </div>
      <div class="wizard-breadcrumb">${renderBreadcrumb(state)}</div>
      <div id="wizardError" class="wizard-error hidden" role="alert" aria-live="assertive"></div>
      <div class="wizard-cuerpo">
        <div class="wizard-superior">
          ${renderControlesGrilla(state)}
          ${renderMinimapa(state)}
        </div>
        <div class="wizard-grilla">${renderGrilla(state)}</div>
      </div>
      <div class="wizard-pie">
        <span class="wizard-aviso">${esNivel1
          ? '⚠️ Al guardar se persiste toda la jerarquía espacial en el Estok.'
          : `Estás dentro de «${escapeHtml(nodo.nombreNodo)}»`}</span>
        <div class="wizard-pie-botones">
          ${nivel > 1 ? `<button type="button" class="wizard-volver-btn" data-volver>← Volver al nivel ${nivel - 1}</button>` : ''}
          <button type="button" class="wizard-guardar-btn" data-guardar-mapa>💾 Guardar Mapa</button>
        </div>
      </div>
    </div>
  </div>`;
}

