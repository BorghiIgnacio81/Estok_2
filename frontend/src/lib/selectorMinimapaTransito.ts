// =============================================================================
// «EN TRÁNSITO» · TARJETA EXTERNA Y SELECCIÓN DEL ESPACIO VIRTUAL
// -----------------------------------------------------------------------------
// El limbo de mudanza es una Ubicación de SISTEMA: NO es un cuarto físico y su
// geometría (100%×auto por defecto) jamás debe dibujarse sobre el plano.
//
// Este módulo concentra:
//   1. El markup de la TARJETA EXTERNA que el selector de objetos muestra
//      arriba del lienzo.
//   2. La mutación de estado que vincula el objeto al limbo sin navegar dentro
//      de ningún ambiente (nivel 1, sin habitación/mueble/caja).
//
// Sin dependencias del render: recibe los callbacks de escritura/pintado para
// evitar ciclos de importación. 100% desacoplado del DOM del plano.
// =============================================================================

import { estado } from './selectorMinimapaUbicacionEstado';

/**
 * Tarjeta EXTERNA «En tránsito» (fuera del recuadro del mapa).
 * `activo` refleja si la ubicación elegida es el limbo del Estok.
 */
export function transitoCardHtml(activo: boolean): string {
  return `
    <button type="button" data-accion="transito" aria-pressed="${activo}"
      class="mb-3 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-base ${
        activo
          ? 'border-amber-400 bg-amber-50 hover:bg-amber-100'
          : 'border-gray-200 bg-white hover:border-amber-300 hover:bg-amber-50/40'
      }">
      <span class="text-xl leading-none" aria-hidden="true">🚚</span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold ${activo ? 'text-amber-800' : 'text-gray-800'}">En tránsito</span>
        <span class="block text-[11px] ${activo ? 'text-amber-700' : 'text-gray-500'}">
          Sin ubicación física: el objeto viaja con la mudanza y NO ocupa un cuarto del plano.
        </span>
      </span>
      ${activo ? '<span class="ml-auto shrink-0 rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white">Seleccionado</span>' : ''}
    </button>`;
}

/**
 * Selecciona el espacio virtual «En Tránsito» del Estok. El objeto queda
 * vinculado al limbo (FK real de Ubicación) para que viaje con la mudanza, pero
 * NO se dibuja ni se navega dentro de ningún cuarto del plano.
 *
 * `escribirSeleccion` y `render` los aporta la capa de navegación para que este
 * módulo no dependa del render (sin ciclos de importación).
 */
export function seleccionarTransito(
  escribirSeleccion: () => void,
  render: () => void,
): boolean {
  if (!estado.limbo) return false;
  estado.enTransito = true;
  estado.habitacionId = null;
  estado.muebleId = null;
  estado.cajaId = null;
  estado.nivel = 1;
  escribirSeleccion();
  render();
  return true;
}
