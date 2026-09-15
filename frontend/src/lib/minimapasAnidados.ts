// =============================================================================
// RED DE MINIMAPAS ANIDADOS (Anti-Perdición de UX)
// -----------------------------------------------------------------------------
// Cadena compacta (4× más chica que el minimapa de origen) del historial
// gráfico de procedencia que vive en la CIMA del panel derecho del flujo de
// portales de la pantalla de Almacenamiento.
//
// Regla de color estricta: el nodo ACTUAL (el último de la cadena) se pinta en
// NARANJA (#f97316) — la MISMA convención del minimapa de planta y del
// selector de posición. Los nodos de procedencia quedan en gris apagado.
//
// REGLA GEOMÉTRICA: los nodos con geometría real disponible (las habitaciones de
// la planta activa —alta o baja—, los muebles de la habitación, los estantes del
// mueble) se dibujan por SECTORES PROPORCIONALES (ui_left/ui_top/ui_width/
// ui_height) dentro de una CAJA CON PORCENTAJES CSS DINÁMICOS: el contenedor
// recibe el `aspect-ratio` real del lienzo medido en vivo y cada sector conserva
// su ancho/alto relativo — nunca celdas cuadradas idénticas ni escalado forzado a
// un cuadrado. El sector/nodo activo va en NARANJA (#f97316).
//
//   Nivel 1 (Planta)      → plano proporcional de las habitaciones de la planta
//                           activa (planta alta o baja), todas con su tamaño real.
//   Nivel 2 (Habitación)  → plano de la planta + la habitación activa en naranja.
//   Nivel 3 (Mueble)      → plano de la planta + habitación + muebles reales.
//   Nivel 4 (Caja/Estante)→ lo anterior + el estante/casillero activo en naranja.
//   Sin geometría persistida → casita (niveles) o grilla asimétrica, como fallback.
//
// 100% render puro (sin estado). Consumido por portalesAlmacenamiento.ts.
// =============================================================================

import { ASPECTO_LIENZO, minimapaCasitaSvg, minimapaRectangularSvg, minimapaSectoresSvg } from './minimapa';
import type { SectorMinimapa } from './minimapa';
import { escapeHtml } from './mapaJerarquico';

export type TipoNodoRuta = 'estok' | 'planta' | 'habitacion' | 'mueble' | 'caja';

export interface NodoRuta {
  tipo: TipoNodoRuta;
  /** Nombre legible del nodo (se muestra bajo la miniatura). */
  nombre: string;
  /** Planta activa (1-based) del minimapa de la casita (nodos casa/planta). */
  filaActiva?: number | null;
  /** Cantidad total de plantas (filas del macro-plano) para el minimapa casa. */
  totalPlantas?: number;
  /** Grilla del nodo para el minimapa rectangular (habitación / mueble / caja). */
  filas?: number;
  columnasPorFila?: number[];
  /**
   * Sectores con GEOMETRÍA REAL (ui_left/ui_top/ui_width/ui_height en % del
   * lienzo) que reemplazan a la cuadrícula de celdas idénticas: el minimapa
   * replica las proporciones reales de cada espacio y pinta en naranja el
   * sector activo. Si se omite, cae al minimapa de grilla.
   */
  sectores?: SectorMinimapa[];
  /** Relación alto/ancho del lienzo real (evita deformar las proporciones). */
  aspecto?: number;
  /** Casillero activo dentro de esa grilla (1-based). */
  celdaFila?: number | null;
  celdaCol?: number | null;
}

const ICONO: Record<TipoNodoRuta, string> = {
  estok: '🏠',
  planta: '🏢',
  habitacion: '🚪',
  mueble: '🗄️',
  caja: '📦',
};

/** Aspecto elástico (alto/ancho) acotado al rango real del lienzo en pantalla. */
function aspectoValido(aspecto: number | undefined): number {
  return Math.max(0.35, Math.min(1.8, Number(aspecto) || ASPECTO_LIENZO));
}

/**
 * Caja del minimapa PROPORCIONAL: contenedor con PORCENTAJES CSS DINÁMICOS.
 *
 * El `aspect-ratio` se inyecta por nodo con la proporción real del lienzo
 * (alto/ancho medido en vivo), así que la caja es alta o ancha según el plano:
 * una habitación alargada, ancha, grande o chica se lee tal cual es en CUALQUIERA
 * de las plantas. El SVG interior la llena al 100% (su viewBox comparte el mismo
 * aspecto), por lo que los sectores nunca se deforman ni se recortan.
 */
function cajaProporcional(aspecto: number | undefined, svg: string): string {
  const ratio = 1 / aspectoValido(aspecto);
  return `<span class="mini-anidado-lienzo mini-anidado-proporcional" style="aspect-ratio:${ratio.toFixed(3)} / 1">${svg}</span>`;
}

/** Miniatura del nodo: sectores reales, casita (sin geometría) o grilla pura. */
function lienzoHtml(nodo: NodoRuta): string {
  // Geometría REAL disponible: se dibujan los sectores proporcionales consumiendo
  // ui_left/ui_top/ui_width/ui_height, con el sector activo en naranja.
  if (nodo.sectores && nodo.sectores.length) {
    const svg = minimapaSectoresSvg({ sectores: nodo.sectores, aspecto: nodo.aspecto });
    if (svg) return cajaProporcional(nodo.aspecto, svg);
  }
  if (nodo.tipo === 'estok' || nodo.tipo === 'planta') {
    // Fallback sin geometría persistida: silueta de la casita, planta activa naranja.
    const total = Math.max(1, Math.floor(Number(nodo.totalPlantas) || 1));
    const fila = Math.max(1, Math.floor(Number(nodo.filaActiva) || 1));
    return `<span class="mini-anidado-lienzo">${minimapaCasitaSvg({ filas: total, filaActiva: fila })}</span>`;
  }
  const filas = Math.max(1, Math.floor(Number(nodo.filas) || 1));
  const columnasPorFila =
    nodo.columnasPorFila && nodo.columnasPorFila.length
      ? nodo.columnasPorFila
      : Array.from({ length: filas }, () => 1);
  return `<span class="mini-anidado-lienzo">${minimapaRectangularSvg({
    filas,
    columnasPorFila,
    filaActiva: nodo.celdaFila ?? null,
    columnaActiva: nodo.celdaCol ?? null,
  })}</span>`;
}

/**
 * Renderiza la barra de minimapas anidados.
 *
 * Por defecto el ÚLTIMO nodo de la cadena es el activo y se resalta en naranja;
 * el resto son la "migaja" de procedencia (atenuadas). Con `todosActivos: true`
 * (ruta geográfica de una caja) TODOS los nodos conservan su resalte naranja.
 */
export function renderMinimapasAnidados(
  nodos: NodoRuta[],
  opts: { todosActivos?: boolean } = {},
): string {
  if (!nodos.length) return '';
  const piezas = nodos.map((nodo, i) => {
    const activo = opts.todosActivos === true || i === nodos.length - 1;
    const bloque = `<div class="mini-anidado${activo ? ' mini-anidado-activo' : ''}" title="${escapeHtml(nodo.nombre)}">
      <span class="mini-anidado-ico" aria-hidden="true">${ICONO[nodo.tipo]}</span>
      ${lienzoHtml(nodo)}
      <span class="mini-anidado-nombre">${escapeHtml(nodo.nombre)}</span>
    </div>`;
    return i < nodos.length - 1 ? `${bloque}<span class="mini-anidado-flecha" aria-hidden="true">→</span>` : bloque;
  });
  return `<div class="mini-anidados-barra" aria-label="Historial de niveles (nodo activo en naranja)">${piezas.join('')}</div>`;
}
