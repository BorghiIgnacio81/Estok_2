// =============================================================================
// MINIMAPA DE SECCIÓN - micro-recuadro HTML/SVG de la grilla de un contenedor
// -----------------------------------------------------------------------------
// Dibuja la grilla de un contenedor padre (ej: 3x3 casilleros de un armario)
// y pinta con color destacado (bg-green-500) la celda exacta donde reside un
// objeto o sub-contenedor, usando sus coordenadas relativas persistidas en
// PostgreSQL (parent_grid_row / parent_grid_col).
//
// Uso típico:
//   minimapaHtml({ fila: 2, columna: 3, titulo: 'Posición en «Armario 1»' })
// =============================================================================

// =============================================================================
// TIPOS
// =============================================================================

export interface MinimapaConfig {
  /** Cantidad de filas de la grilla (default 3). */
  filas?: number;
  /** Cantidad de columnas de la grilla (default 3). */
  columnas?: number;
  /** Fila activa (1-based) donde reside el elemento. null => sin casillero. */
  fila?: number | null;
  /** Columna activa (1-based) donde reside el elemento. null => sin casillero. */
  columna?: number | null;
  /** Celdas adicionales ocupadas (tinte suave), ej: otros objetos del contenedor. */
  celdasAdicionales?: Array<{ fila: number; columna: number }>;
  /** Título opcional del minimapa. */
  titulo?: string;
  /** Texto de detalle (ej: "Casillero F2·C3"). Si no se pasa, se deduce. */
  detalle?: string;
  /** Color de resalte hex (default verde '#10b981'; selector naranja '#f97316'). */
  color?: string;
}

export const DEFAULT_FILAS = 3;
export const DEFAULT_COLUMNAS = 3;
/** Color de los selectores de posición (bosquejo estricto). */
export const COLOR_NARANJA = '#f97316';

// =============================================================================
// HELPERS
// =============================================================================

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function etiquetaCasillero(fila: number | null, columna: number | null): string {
  if (fila && columna) return `F${fila}·C${columna}`;
  return 'Sin casillero';
}

// =============================================================================
// GENERADOR HTML (CSS grid + Tailwind). Recomendado para la UI.
// =============================================================================

export function minimapaHtml(cfg: MinimapaConfig = {}): string {
  const filas = cfg.filas || DEFAULT_FILAS;
  const columnas = cfg.columnas || DEFAULT_COLUMNAS;
  const fila = cfg.fila ?? null;
  const columna = cfg.columna ?? null;
  const adicionales = cfg.celdasAdicionales ?? [];
  const color = cfg.color || '#10b981';
  const titulo = escapeHtml(cfg.titulo ?? 'Minimapa de sección');
  const detalle = escapeHtml(
    cfg.detalle ?? (fila && columna ? `Casillero ${etiquetaCasillero(fila, columna)}` : 'Sin casillero asignado'),
  );

  const esAdicional = (r: number, c: number): boolean =>
    adicionales.some((a) => a.fila === r && a.columna === c);

  let celdas = '';
  for (let r = 1; r <= filas; r++) {
    for (let c = 1; c <= columnas; c++) {
      const activa = r === fila && c === columna;
      const ocupada = !activa && esAdicional(r, c);
      let cls = 'minimapa-celda';
      let estilo = '';
      if (activa) {
        cls = 'minimapa-celda minimapa-celda-activa';
        estilo = `style="background:${color};border-color:${color};color:#fff"`;
      } else if (ocupada) {
        estilo = `style="background:${color}26;border-color:${color}80;color:${color}"`;
      }
      celdas += `<div class="${cls}" ${estilo} data-fila="${r}" data-columna="${c}" title="${activa ? `Casillero ${etiquetaCasillero(r, c)}` : 'Casillero libre'}">${activa ? '●' : ocupada ? '▣' : ''}</div>`;
    }
  }

  return `
  <div class="minimapa">
    <div class="minimapa-titulo">${titulo}</div>
    <div class="minimapa-grilla" style="grid-template-columns: repeat(${columnas}, minmax(0, 1fr))">
      ${celdas}
    </div>
    <div class="minimapa-detalle ${fila && columna ? 'minimapa-detalle-activo' : ''}">${detalle}</div>
  </div>`;
}

// =============================================================================
// GENERADOR SVG (standalone, sin dependencia de CSS externa)
// =============================================================================

export function minimapaSvg(cfg: MinimapaConfig = {}): string {
  const filas = cfg.filas || DEFAULT_FILAS;
  const columnas = cfg.columnas || DEFAULT_COLUMNAS;
  const fila = cfg.fila ?? null;
  const columna = cfg.columna ?? null;
  const adicionales = cfg.celdasAdicionales ?? [];
  const color = cfg.color || '#10b981';

  const cell = 18;
  const gap = 3;
  const pad = 4;
  const w = pad * 2 + columnas * cell + (columnas - 1) * gap;
  const h = pad * 2 + filas * cell + (filas - 1) * gap;

  const esAdicional = (r: number, c: number): boolean =>
    adicionales.some((a) => a.fila === r && a.columna === c);

  let rects = '';
  for (let r = 0; r < filas; r++) {
    for (let c = 0; c < columnas; c++) {
      const activa = r + 1 === fila && c + 1 === columna;
      const ocupada = !activa && esAdicional(r + 1, c + 1);
      const x = pad + c * (cell + gap);
      const y = pad + r * (cell + gap);
      const fill = activa ? color : ocupada ? `${color}26` : '#f3f4f6';
      const stroke = activa ? color : ocupada ? `${color}80` : '#d1d5db';
      rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1" />`;
    }
  }

  const cx = pad + (columna ? (columna - 1) * (cell + gap) + cell / 2 : cell / 2);
  const cy = pad + (fila ? (fila - 1) * (cell + gap) + cell / 2 : cell / 2);

  return `
  <svg class="minimapa-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Minimapa de sección">
    ${rects}
    ${fila && columna ? `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#ffffff" />` : ''}
  </svg>`;
}

// =============================================================================
// CSS GLOBAL DEL MINIMAPA (se inyecta una sola vez por documento)
// =============================================================================

let minimapaCssInyectado = false;

export function inyectarCssMinimapa(): void {
  if (minimapaCssInyectado || typeof document === 'undefined') return;
  minimapaCssInyectado = true;
  const style = document.createElement('style');
  style.textContent = `
    .minimapa { display: flex; flex-direction: column; gap: 8px; }
    .minimapa-titulo { font-size: 12px; font-weight: 600; color: #374151; }
    .minimapa-grilla { display: grid; gap: 4px; max-width: 150px; }
    .minimapa-celda {
      aspect-ratio: 1 / 1;
      border-radius: 6px;
      border: 1px solid #e5e7eb;
      background: #f9fafb;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; color: #9ca3af;
    }
    .minimapa-celda-activa {
      background: #10b981 !important;
      border-color: #059669 !important;
      color: #ffffff !important;
      font-weight: 700;
    }
    .minimapa-detalle { font-size: 11px; color: #6b7280; }
    .minimapa-detalle-activo { color: #059669; font-weight: 600; }
  `;
  document.head.appendChild(style);
}

