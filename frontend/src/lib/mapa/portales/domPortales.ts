// =============================================================================
// HELPERS DE DOM DEL MOTOR DE PORTALES
// -----------------------------------------------------------------------------
// Utilidades mínimas compartidas por la máquina de portales y sus enlaces: no
// contienen estado propio ni lógica de negocio (sólo resolución de nodos y
// movimiento de paneles entre las dos columnas).
// =============================================================================

import { ASPECTO_LIENZO } from '../../minimapa';

/** Resuelve un host por id. */
export function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Slot (columna) del Panel Izquierdo. */
export const slotIzq = (): HTMLElement | null => el('contenidoPanelIzquierdo');

/** Slot (columna) del Panel Derecho. */
export const slotDer = (): HTMLElement | null => el('contenidoPanelDerecho');

/** Mueve un host al slot destino y lo enciende (el resto se apaga aparte). */
export function moverPanel(panel: HTMLElement | null, slot: HTMLElement | null): void {
  if (!panel || !slot) return;
  slot.appendChild(panel);
  panel.classList.remove('hidden');
}

/** Escribe el texto de un nodo por id (títulos y descripciones de cabecera). */
export function setTexto(id: string, valor: string): void {
  const nodo = el(id);
  if (nodo) nodo.textContent = valor;
}

/** Aspecto elástico (alto/ancho) del lienzo visible, para los minimapas. */
export function aspectoDelLienzo(): number {
  const lienzo = Array.from(document.querySelectorAll<HTMLElement>('[data-lienzo-pu]')).find(
    (candidato) => candidato.getBoundingClientRect().height > 0,
  );
  const rect = lienzo?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return ASPECTO_LIENZO;
  return Math.max(0.35, Math.min(1.8, rect.height / rect.width));
}

/**
 * LEY 2 · Resalta en NARANJA (#f97316) el nodo seleccionado dentro del Panel
 * Izquierdo (ancla). Cubre tanto las siluetas SVG del mapa como las tarjetas
 * HTML de los visores históricos (`[data-inplace-card][data-id]`). Quita el
 * resalte anterior antes de pintar el nuevo.
 */
export function resaltarSeleccionIzquierda(id: string | null): void {
  const slot = slotIzq();
  if (!slot) return;
  slot
    .querySelectorAll<HTMLElement>('.portal-seleccion-naranja')
    .forEach((nodo) => nodo.classList.remove('portal-seleccion-naranja'));
  if (!id) return;
  const esc = CSS.escape(id);
  const objetivo = slot.querySelector<HTMLElement>(
    `[data-inplace-card][data-id="${esc}"], [data-ubicacion="${esc}"], [data-portal-abrir="${esc}"]`,
  );
  objetivo?.classList.add('portal-seleccion-naranja');
}
