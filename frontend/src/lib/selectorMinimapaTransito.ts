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
// UI REUTILIZABLE EXTERNA: el bloque «En tránsito» vive en un único módulo y
// SIEMPRE se monta fuera del recuadro del plano (nunca dentro del lienzo).
import { bloqueTransitoExternoHtml } from './espacioTransitoExterno';

/**
 * Tarjeta EXTERNA «En tránsito» (fuera del recuadro del mapa).
 * `activo` refleja si la ubicación elegida es el limbo del Estok.
 */
export function transitoCardHtml(activo: boolean): string {
  return bloqueTransitoExternoHtml({ activo });
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
