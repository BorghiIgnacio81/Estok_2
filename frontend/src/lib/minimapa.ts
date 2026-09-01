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
  /** Cantidad de casilleros por fila para grillas asimétricas (ej: [3,2,2]).
   *  Si se provee, reemplaza `columnas` por fila. */
  columnasPorFila?: number[];
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

  // Grilla asimétrica: si se define columnasPorFila, cada fila tiene su propio
  // ancho (ej: [3,2,2]); de lo contrario todas las filas usan `columnas`.
  const esAsimetrico =
    Array.isArray(cfg.columnasPorFila) &&
    cfg.columnasPorFila.length >= filas &&
    cfg.columnasPorFila.every((n) => Number.isFinite(Number(n)));
  const columnasDeFila = (r: number): number => {
    if (esAsimetrico) return Math.max(1, Math.floor(Number(cfg.columnasPorFila![r - 1])) || columnas);
    return columnas;
  };

  const esAdicional = (r: number, c: number): boolean =>
    adicionales.some((a) => a.fila === r && a.columna === c);

  let grilla = '';
  for (let r = 1; r <= filas; r++) {
    const cols = columnasDeFila(r);
    let filaHtml = '';
    for (let c = 1; c <= cols; c++) {
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
      filaHtml += `<div class="${cls}" ${estilo} data-fila="${r}" data-columna="${c}" title="${activa ? `Casillero ${etiquetaCasillero(r, c)}` : 'Casillero libre'}">${activa ? '●' : ocupada ? '▣' : ''}</div>`;
    }
    grilla += `<div class="minimapa-fila" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr))">${filaHtml}</div>`;
  }

  return `
  <div class="minimapa">
    <div class="minimapa-titulo">${titulo}</div>
    <div class="minimapa-grilla">
      ${grilla}
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

  const esAsimetrico =
    Array.isArray(cfg.columnasPorFila) &&
    cfg.columnasPorFila.length >= filas &&
    cfg.columnasPorFila.every((n) => Number.isFinite(Number(n)));
  const columnasDeFila = (r: number): number => {
    if (esAsimetrico) return Math.max(1, Math.floor(Number(cfg.columnasPorFila![r - 1])) || columnas);
    return columnas;
  };

  const cell = 9;   // ULTRA-MINI: la celda se reduce 4× (antes 18)
  const gap = 2;
  const pad = 3;
  const maxColumnas = Math.max(...Array.from({ length: filas }, (_, i) => columnasDeFila(i + 1)));
  const w = pad * 2 + maxColumnas * cell + (maxColumnas - 1) * gap;
  const h = pad * 2 + filas * cell + (filas - 1) * gap;

  const esAdicional = (r: number, c: number): boolean =>
    adicionales.some((a) => a.fila === r && a.columna === c);

  let rects = '';
  for (let r = 0; r < filas; r++) {
    const cols = columnasDeFila(r + 1);
    for (let c = 0; c < cols; c++) {
      const activa = r + 1 === fila && c + 1 === columna;
      const ocupada = !activa && esAdicional(r + 1, c + 1);
      const x = pad + c * (cell + gap);
      const y = pad + r * (cell + gap);
      const fill = activa ? color : ocupada ? `${color}26` : '#f3f4f6';
      const stroke = activa ? color : ocupada ? `${color}80` : '#d1d5db';
      rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="0.5" />`;
    }
  }

  const cx = pad + (columna ? (columna - 1) * (cell + gap) + cell / 2 : cell / 2);
  const cy = pad + (fila ? (fila - 1) * (cell + gap) + cell / 2 : cell / 2);

  return `
  <svg class="minimapa-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Minimapa de sección">
    ${rects}
    ${fila && columna ? `<circle cx="${cx}" cy="${cy}" r="2" fill="#ffffff" />` : ''}
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
    /* Minimapa ULTRA-MINI (4× más chico): nitidez total en NARANJA #f97316 */
    .minimapa { display: flex; flex-direction: column; gap: 2px; }
    .minimapa-titulo { font-size: 5px; font-weight: 700; color: #374151; line-height: 1.2; }
    .minimapa-grilla { display: flex; flex-direction: column; gap: 2px; max-width: 40px; }
    .minimapa-fila { display: grid; gap: 2px; }
    .minimapa-celda {
      aspect-ratio: 1 / 1;
      border-radius: 2px;
      border: 0.5px solid #e5e7eb;
      background: #f9fafb;
      display: flex; align-items: center; justify-content: center;
      font-size: 5px; color: #9ca3af;
      line-height: 1;
    }
    .minimapa-celda-activa {
      font-weight: 700;
    }
    .minimapa-detalle { font-size: 5px; color: #6b7280; line-height: 1.2; }
    .minimapa-detalle-activo { color: #ea580c; font-weight: 700; }
  `;
  document.head.appendChild(style);
}


// =============================================================================
// MINIMAPA DE LA CASITA (silueta ancha con techo puntiagudo)
// Compartido entre el "Mapa Estok" (izquierda) y el Visor de Habitación
// (derecha) para mantener la MISMA silueta proporcional de casa.
// =============================================================================

export function minimapaCasitaSvg(opts: { filas: number; filaActiva: number }): string {
  const { filas, filaActiva } = opts;
  // Silueta ANCHA tipo casa real: cuerpo rectangular horizontal (no una
  // flecha vertical estrecha). Cada piso es una barra que ocupa todo el ancho
  // y el techo puntiagudo corona la silueta (proporciones w-18 h-10 / w-20 h-12).
  const cuerpoAncho = 34;
  const cell = 8; // alto de cada barra-piso
  const gap = 2;
  const pad = 4;
  const techoAlto = 13;
  const ancho = pad * 2 + cuerpoAncho;
  const altoCuerpo = pad * 2 + filas * cell + (filas - 1) * gap;
  const h = techoAlto + altoCuerpo;

  let celdas = '';
  for (let r = 1; r <= filas; r++) {
    const y = techoAlto + pad + (r - 1) * (cell + gap);
    const activa = r === filaActiva;
    celdas += `<rect data-mini-fila="${r}" x="${pad}" y="${y}" width="${cuerpoAncho}" height="${cell}" rx="2" fill="${activa ? COLOR_NARANJA : '#fef3c7'}" stroke="${activa ? '#c2410c' : '#d1d5db'}" stroke-width="0.5" />`;
  }

  const mitad = ancho / 2;
  const techo = `
    <path d="M2 ${techoAlto} L${mitad} 1 L${ancho - 2} ${techoAlto} Z" fill="#9a3412" stroke="#7c2d12" stroke-width="0.6" stroke-linejoin="round" />
    <rect x="${ancho - 22}" y="4" width="7" height="10" rx="1.5" fill="#7c2d12" stroke="#5b1f0a" stroke-width="0.5" />`;

  return `<svg class="casita-minimapa-svg" width="${ancho}" height="${h + 2}" viewBox="0 0 ${ancho} ${h + 2}" role="img" aria-label="Minimapa de la casita (sector activo en naranja)">${techo}${celdas}</svg>`;
}

