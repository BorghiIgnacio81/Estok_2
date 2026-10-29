// =============================================================================
// FRENO DE EDICIÓN DE TEXTO (anti-autoguardado interruptivo)
// -----------------------------------------------------------------------------
// Mientras el operador escribe el NOMBRE de un espacio en el campo in-place del
// lienzo (lib/lienzoInteractivo.ts → `conectarRenombradoEnVivo`), NINGÚN
// temporizador de autoguardado ni ningún refresco pesado puede dispararse: la
// respuesta del PUT emite `estok:espacios-cambiados`, el lienzo se repinta por
// `innerHTML` y el `<input>` con el texto a medio escribir se destruye (además
// del salto de scroll que produce el re-render).
//
// El guardado del nombre SÍ ocurre, pero SOLO en los tres gestos deliberados que
// ya implementa el editor: «Enter», «blur» (pérdida de foco real) o el botón
// «💾 Guardar» del modo edición.
//
// Módulo de DOM puro: no hace fetch, no conoce Tailwind ni el estado del lienzo.
// Lo consumen lib/pintorFrame.ts (gate de los refrescos pesados),
// lib/debounceGuardado.ts (reloj del autoguardado) y los visores que repintan
// su contenido ante `estok:espacios-cambiados`.
// =============================================================================

/** Campo de nombre en caliente que inyecta el motor del lienzo. */
const SELECTOR_INPUT_NOMBRE = '.inplace-input-nombre';

/** Etiqueta renombrable marcada como «en edición» (desde el clic al Enter/blur). */
const SELECTOR_EDITANDO = '[data-inplace-renombrar][data-editando="1"]';

/** ¿El nodo es un campo donde el operador escribe texto? */
function esCampoDeTexto(nodo: Element | null): boolean {
  if (!nodo) return false;
  if (nodo instanceof HTMLTextAreaElement) return true;
  if (nodo instanceof HTMLInputElement) {
    // Sólo tipos de TEXTO: un checkbox o un botón no son edición de texto.
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes(
      nodo.type,
    );
  }
  return (nodo as HTMLElement).isContentEditable === true;
}

/**
 * ¿Hay un campo de texto del editor enfocado o en edición activa?
 *
 * Cubre los dos estados reales del renombrado in-place:
 *   1. el `<input>` creado por el motor tiene el foco,
 *   2. la etiqueta quedó marcada `data-editando="1"` (teclado virtual cerrado,
 *      foco en la barra del navegador o PUT en vuelo).
 */
export function hayEdicionTextoActiva(): boolean {
  if (typeof document === 'undefined') return false;
  const activo = document.activeElement;
  if (esCampoDeTexto(activo) && activo?.closest(SELECTOR_INPUT_NOMBRE)) return true;
  return document.querySelector(SELECTOR_EDITANDO) !== null;
}
