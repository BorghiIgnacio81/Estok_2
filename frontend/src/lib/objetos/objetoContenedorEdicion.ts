// =============================================================================
// EDICIÓN DE OBJETO · SWITCH «¿ES UNA CAJA O CONTENEDOR?»
// -----------------------------------------------------------------------------
// Comportamiento del control ClasificacionContenedorEdicion.astro, que
// rectifica `Objeto.es_contenedor` desde /objetos/[id]/editar.
//
// Vive fuera de lib/editarObjetoForm.ts por la regla de modularización (<400
// líneas por archivo de UI): el orquestador sólo hidrata, lee y avisa.
//
// El backend es la AUTORIDAD FINAL: una categoría explícitamente contenedora
// («Cajas y Contenedores», «Cajas», «Baúles»…) o un rótulo que EMPIEZA por
// «Caja» conserva el flag aunque el switch se apague. Por eso el aviso posterior
// compara lo pedido contra el `es_contenedor` REALMENTE persistido.
// =============================================================================

import { refOpcional } from '../dom';

let checkbox: HTMLInputElement | null = null;
let estadoEl: HTMLElement | null = null;

/** Refleja en el texto de ayuda la intención elegida con el switch. */
function pintarEstado(): void {
  if (!checkbox || !estadoEl) return;
  const esCaja = checkbox.checked;
  estadoEl.textContent = esCaja
    ? '📦 Se guardará como caja/contenedor: puede alojar otros objetos dentro.'
    : '🧸 Se guardará como objeto simple: dejará de listarse en «Cajas e Inventario Interno».';
  estadoEl.className = esCaja
    ? 'mt-3 text-xs font-medium text-orange-700'
    : 'mt-3 text-xs font-medium text-gray-500';
}

/** Resuelve el control y conecta su feedback visual (idempotente). */
export function iniciarSwitchContenedor(): void {
  checkbox = refOpcional<HTMLInputElement>('es_contenedor');
  estadoEl = refOpcional<HTMLElement>('esContenedorEstado');
  if (!checkbox) return;
  if (checkbox.dataset.contenedorActivo !== 'true') {
    checkbox.dataset.contenedorActivo = 'true';
    checkbox.addEventListener('change', pintarEstado);
  }
  pintarEstado();
}

/** Precarga el estado REAL que devolvió la API al abrir la edición. */
export function hidratarSwitchContenedor(esContenedor: unknown): void {
  if (!checkbox) return;
  checkbox.checked = esContenedor === true;
  pintarEstado();
}

/** Clasificación elegida AHORA por el operador (se lee del DOM, sin estado duplicado). */
export function contenedorSeleccionado(): boolean {
  return checkbox?.checked === true;
}

/**
 * Aviso para el toast según el valor persistido por el backend.
 *
 * Cadena VACÍA cuando lo pedido coincide con lo guardado (caso normal). Si el
 * backend conservó el flag por categoría/rótulo, lo informa explícitamente para
 * que la tarjeta no "desaparezca" de una sección sin explicación.
 */
export function avisoClasificacionPersistida(
  guardado: Record<string, any> | null | undefined,
): string {
  const solicitado = contenedorSeleccionado();
  const persistido = guardado?.['es_contenedor'] === true;
  if (solicitado === persistido) return '';
  return persistido
    ? ' · 📦 se conserva como contenedor por su categoría/rótulo'
    : ' · 🧸 quedó como objeto simple';
}
