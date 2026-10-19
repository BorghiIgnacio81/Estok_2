// =============================================================================
// PINTOR POR FRAME + CONTENCIÓN DEL GESTO TÁCTIL (móvil / iOS Safari)
// -----------------------------------------------------------------------------
// En pantallas táctiles `pointermove` puede dispararse varias veces por frame
// (120 Hz en iPhone Pro) y cada escritura de estilo fuerza un re-layout. Este
// helper COALESCED las actualizaciones visuales en un ÚNICO
// requestAnimationFrame: la posición se guarda en referencias LOCALES durante el
// gesto y el DOM se pinta una sola vez por frame. El valor definitivo se vuelca
// y se persiste al soltar (pointerup), nunca píxel a píxel.
//
// `contenerGestoTactil` frena el gesto nativo de Safari (scroll, rebote
// elástico, selección de texto y callout de long-press) mientras se arrastra un
// elemento del editor. Es el complemento JS del `touch-action: none` declarado
// en styles/planta-unica.css.
// =============================================================================

/** Programador de pintado visual: máximo UNA actualización por frame. */
export interface PintorFrame {
  /** Agenda el pintado para el próximo frame (llamadas repetidas se agrupan). */
  programar(): void;
  /** Cancela el frame pendiente (soltar el puntero o gesto abortado). */
  cancelar(): void;
}

/** Crea un pintor coalescido por `requestAnimationFrame`. */
export function crearPintorFrame(pintar: () => void): PintorFrame {
  let frame: number | null = null;
  const correr = (): void => {
    frame = null;
    pintar();
  };
  return {
    programar(): void {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(correr);
    },
    cancelar(): void {
      if (frame === null) return;
      window.cancelAnimationFrame(frame);
      frame = null;
    },
  };
}

/**
 * Neutraliza el gesto nativo del navegador durante un arrastre táctil:
 * detiene la propagación y el comportamiento por defecto (scroll/rebote).
 */
export function contenerGestoTactil(ev: Event): void {
  if (ev.cancelable) ev.preventDefault();
  ev.stopPropagation();
}

/**
 * Clases que el motor del lienzo agrega SOLO mientras hay un gesto de edición
 * en curso (arrastre / estirado de pieza / estirado del perímetro).
 */
const SELECTOR_GESTO_ACTIVO =
  '.pu-arrastrando, .pu-redimensionando, .pu-perimetro-redimensionando, .inplace-redimensionando';

/**
 * ¿Hay un dedo arrastrando/estirando AHORA MISMO? Los refrescos pesados
 * (re-render del panel + re-lectura del padrón) deben esperar: si caen en medio
 * de un gesto, el navegador reemplaza el nodo bajo el dedo y la pantalla
 * "salta" en iOS Safari.
 */
export function hayGestoActivo(): boolean {
  return document.querySelector(SELECTOR_GESTO_ACTIVO) !== null;
}
