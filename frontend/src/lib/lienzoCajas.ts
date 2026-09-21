// =============================================================================
// CAJAS ELÁSTICAS DEL LIENZO 2D (geometría leída/escrita desde el DOM)
// -----------------------------------------------------------------------------
// Única fuente de verdad para traducir el DOM del lienzo a cajas (% del lienzo)
// y viceversa. La consumen el motor de arrastre (plantaUnicaArrastre.ts) y el
// motor de compactación al guardar (plantaGuardado.ts): cero duplicación.
//
// SILUETA REAL: un espacio común es UNA caja; un bloque fusionado es la UNIÓN de
// sus tiles (los <rect> del SVG continuo). El bounding box de un bloque en «L»
// se usa solo para posicionar la tarjeta y sus controles: NUNCA como cuerpo
// físico, porque su esquina vacía bloquearía a los ambientes vecinos.
// =============================================================================

import { pctValor } from './mapaPlantaUnica';
import { bboxDe, type Caja } from './compactacionPlanta';

/** Redondeo a 2 decimales (precisión de persistencia de ui_*). */
export function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Token CSS de geometría elástica (ej: 12.34% ). */
export function pct(n: number): string {
  return `${redondear(n)}%`;
}

export function acotar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Lee la caja (% del lienzo) desde los estilos inline de una tarjeta. */
export function leerCaja(el: HTMLElement): Caja {
  return {
    left: pctValor(el.style.left, 0),
    top: pctValor(el.style.top, 0),
    width: pctValor(el.style.width, 28),
    height: pctValor(el.style.height, 24),
  };
}

/** Vuelca una caja a los estilos inline de una tarjeta. */
export function aplicarCaja(card: HTMLElement, caja: Caja): void {
  card.style.left = pct(caja.left);
  card.style.top = pct(caja.top);
  card.style.width = pct(caja.width);
  card.style.height = pct(caja.height);
}

/** true si la tarjeta es un BLOQUE FUSIONADO (tiles SVG en su interior). */
export function esGrupo(card: HTMLElement): boolean {
  return Boolean(card.dataset.fusionGrupo) || Boolean(card.querySelector('[data-tile-id]'));
}

function tiles(card: HTMLElement): SVGRectElement[] {
  return Array.from(card.querySelectorAll<SVGRectElement>('.pu-grupo-svg rect[data-tile-id]'));
}

function numero(valor: string | null): number {
  const n = parseFloat(valor ?? '');
  return Number.isFinite(n) ? n : 0;
}

/**
 * SILUETA REAL en % del lienzo: los tiles (bloque fusionado) o la caja propia
 * (espacio común). Los tiles se derivan del SVG VIVO + el bbox actual de la
 * tarjeta, por lo que la silueta nunca queda desfasada respecto de lo visible.
 */
export function cajasDeCarta(card: HTMLElement): Caja[] {
  const bbox = leerCaja(card);
  const rects = tiles(card);
  if (!rects.length) return [bbox];
  const cajas = rects.map((r) => ({
    left: bbox.left + (numero(r.getAttribute('x')) / 100) * bbox.width,
    top: bbox.top + (numero(r.getAttribute('y')) / 100) * bbox.height,
    width: (numero(r.getAttribute('width')) / 100) * bbox.width,
    height: (numero(r.getAttribute('height')) / 100) * bbox.height,
  }));
  // Datos incompletos (SVG sin medidas): se trata como un espacio común.
  if (cajas.some((c) => c.width <= 0 || c.height <= 0)) return [bbox];
  return cajas;
}

/**
 * Escribe una SILUETA completa:
 *  - espacio común  → caja en los estilos inline de la tarjeta.
 *  - bloque fusionado → bbox de la tarjeta + reescalado de cada tile (el SVG es
 *    relativo, por lo que la forma en «L» se conserva) + memorias data-tile-*
 *    que consume la persistencia consolidada del grupo.
 */
export function aplicarSilueta(card: HTMLElement, cajas: Caja[]): void {
  const rects = tiles(card);
  if (!rects.length) {
    const unica = cajas[0];
    if (unica) aplicarCaja(card, unica);
    return;
  }
  // Recorte ESTRICTO: el marco queda pegado a la superficie texturada real.
  const b = bboxDe(cajas);
  aplicarCaja(card, b);
  if (cajas.length !== rects.length) return; // silueta parcial: solo se mueve el marco
  rects.forEach((r, i) => {
    const c = cajas[i];
    r.setAttribute('x', (((c.left - b.left) / b.width) * 100).toFixed(2));
    r.setAttribute('y', (((c.top - b.top) / b.height) * 100).toFixed(2));
    r.setAttribute('width', ((c.width / b.width) * 100).toFixed(2));
    r.setAttribute('height', ((c.height / b.height) * 100).toFixed(2));
    r.dataset.tileLeft = String(redondear(c.left));
    r.dataset.tileTop = String(redondear(c.top));
    r.dataset.tileWidth = String(redondear(c.width));
    r.dataset.tileHeight = String(redondear(c.height));
  });
}
