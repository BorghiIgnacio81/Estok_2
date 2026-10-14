// =============================================================================
// DEBOUNCE DE GUARDADO (anti-lag de arrastre y resizing) — helper reutilizable
// -----------------------------------------------------------------------------
// El movimiento del puntero corre a 60 FPS 100% en el CLIENTE (sólo transforma el
// DOM). La persistencia NO puede viajar en cada píxel: se AGENDA con este
// temporizador de 500 ms que se REINICIA en cada movimiento y se dispara recién
// cuando el gesto se detiene. `ejecutarYa()` fuerza el envío al soltar el puntero,
// de modo que el resultado final viaja en UN ÚNICO PUT consolidado a Django.
//
// Módulo PURO de temporización: no conoce HTTP, ni el DOM del lienzo, ni Tailwind.
// =============================================================================

/** Ventana de debounce del guardado elástico (ms). */
export const MS_DEBOUNCE_GUARDADO = 500;

/** Temporizador de guardado diferido de un gesto (arrastre / resizing). */
export interface GuardadoProgramado {
  /** (Re)programa el guardado a 500 ms del ÚLTIMO movimiento. */
  programar(): void;
  /** Guarda YA (el puntero se soltó), cancelando el temporizador pendiente. */
  ejecutarYa(): Promise<void>;
  /** Cancela el guardado diferido sin ejecutarlo (gesto abortado). */
  cancelar(): void;
}

/**
 * Crea un guardado DEBOUNCED: cada `programar()` reinicia el reloj y `ejecutar`
 * corre UNA sola vez, 500 ms después del último movimiento registrado.
 */
export function crearGuardadoProgramado(
  ejecutar: () => void | Promise<void>,
  ms: number = MS_DEBOUNCE_GUARDADO,
): GuardadoProgramado {
  let temporizador: number | null = null;

  const limpiar = (): void => {
    if (temporizador !== null) {
      window.clearTimeout(temporizador);
      temporizador = null;
    }
  };

  return {
    programar(): void {
      limpiar();
      temporizador = window.setTimeout(() => {
        temporizador = null;
        void ejecutar();
      }, ms);
    },
    async ejecutarYa(): Promise<void> {
      limpiar();
      await ejecutar();
    },
    cancelar: limpiar,
  };
}

/**
 * Notificador DEBOUNCED: agrupa ráfagas de avisos en UNA sola ejecución. Lo usa el
 * motor elástico para que varios gestos encadenados (mover + estirar + mover)
 * refresquen la pantalla UNA vez en vez de recargar en cada PUT.
 */
export function crearNotificadorDebounced(
  ms: number = MS_DEBOUNCE_GUARDADO,
): (ejecutar: () => void) => void {
  let temporizador: number | null = null;
  let pendiente: (() => void) | null = null;
  return (ejecutar: () => void): void => {
    pendiente = ejecutar;
    if (temporizador !== null) window.clearTimeout(temporizador);
    temporizador = window.setTimeout(() => {
      temporizador = null;
      const accion = pendiente;
      pendiente = null;
      accion?.();
    }, ms);
  };
}
