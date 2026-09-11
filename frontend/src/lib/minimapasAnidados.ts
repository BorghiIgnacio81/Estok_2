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
//   Nivel 1 (Planta)      → minimapa de la casita con la planta activa naranja.
//   Nivel 2 (Habitación)  → miniatura de la casa + grilla de la habitación con
//                           el casillero activo en naranja.
//   Nivel 3 (Mueble)      → casa + habitación + grilla del mueble.
//   Nivel 4 (Caja/Estante)→ casa + habitación + mueble + estante activo naranja.
//
// 100% render puro (sin estado). Consumido por portalesAlmacenamiento.ts.
// =============================================================================

import { minimapaCasitaSvg, minimapaRectangularSvg } from './minimapa';
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

/** Miniatura SVG del nodo según su tipo (casa con techo vs rectángulo puro). */
function lienzoHtml(nodo: NodoRuta): string {
  if (nodo.tipo === 'estok' || nodo.tipo === 'planta') {
    const total = Math.max(1, Math.floor(Number(nodo.totalPlantas) || 1));
    const fila = Math.max(1, Math.floor(Number(nodo.filaActiva) || 1));
    return minimapaCasitaSvg({ filas: total, filaActiva: fila });
  }
  const filas = Math.max(1, Math.floor(Number(nodo.filas) || 1));
  const columnasPorFila =
    nodo.columnasPorFila && nodo.columnasPorFila.length
      ? nodo.columnasPorFila
      : Array.from({ length: filas }, () => 1);
  return minimapaRectangularSvg({
    filas,
    columnasPorFila,
    filaActiva: nodo.celdaFila ?? null,
    columnaActiva: nodo.celdaCol ?? null,
  });
}

/**
 * Renderiza la barra de minimapas anidados. El ÚLTIMO nodo de la cadena es el
 * activo y se resalta en naranja; el resto son la "migaja" de procedencia.
 */
export function renderMinimapasAnidados(nodos: NodoRuta[]): string {
  if (!nodos.length) return '';
  const piezas = nodos.map((nodo, i) => {
    const activo = i === nodos.length - 1;
    const bloque = `<div class="mini-anidado${activo ? ' mini-anidado-activo' : ''}" title="${escapeHtml(nodo.nombre)}">
      <span class="mini-anidado-ico" aria-hidden="true">${ICONO[nodo.tipo]}</span>
      <span class="mini-anidado-lienzo">${lienzoHtml(nodo)}</span>
      <span class="mini-anidado-nombre">${escapeHtml(nodo.nombre)}</span>
    </div>`;
    return i < nodos.length - 1 ? `${bloque}<span class="mini-anidado-flecha" aria-hidden="true">→</span>` : bloque;
  });
  return `<div class="mini-anidados-barra" aria-label="Historial de niveles (nodo activo en naranja)">${piezas.join('')}</div>`;
}
