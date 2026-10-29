// =============================================================================
// DEBOUNCE DE GUARDADO (anti-lag de arrastre y resizing) — helper reutilizable
// -----------------------------------------------------------------------------
// El movimiento del puntero corre a 60 FPS 100% en el CLIENTE (sólo transforma el
// DOM). La persistencia NO puede viajar en cada píxel: durante el gesto NO se
// dispara ninguna petición; al SOLTAR el elemento la geometría final se agenda
// con `MS_GUARDADO_FINAL` (1000 ms) y cualquier gesto nuevo REINICIA el reloj.
// Así una ráfaga de arrastres encadenados termina en UN ÚNICO lote de PUTs.
//
// Módulo de temporización: no conoce HTTP ni el DOM del lienzo. Su ÚNICO freno
// externo es la edición de texto en caliente (lib/edicionTextoActiva.ts): el reloj
// no puede vencer mientras el operador está escribiendo un nombre.
// =============================================================================

import { hayEdicionTextoActiva } from './edicionTextoActiva';

/** Ventana del notificador diferido de refrescos (ms). */
export const MS_DEBOUNCE_GUARDADO = 500;

/**
 * Ventana del guardado posterior al gesto (ms): margen anti-salto en iOS.
 * Mínimo estricto de 1000 ms desde que el dedo se levanta (pointerup/touchend):
 * si el operador encadena otro arrastre, el reloj vuelve a cero.
 */
export const MS_GUARDADO_FINAL = 1000;

/** Agendador de guardado DIFERIDO posterior al gesto (arrastre / resizing). */
export interface AgendadorGuardado {
  /**
   * (Re)programa la tarea de una clave (id del espacio / 'perimetro') y REINICIA
   * el reloj. Si la misma clave se vuelve a programar antes de vencer, la tarea
   * anterior se REEMPLAZA: nunca se encola dos veces el mismo espacio.
   */
  programar(clave: string, ejecutar: () => void | Promise<void>): void;
  /**
   * Reinicia el reloj sin encolar nada. Lo llama el editor al iniciar un gesto
   * nuevo: si el operador vuelve a mover algo antes de los 1000 ms, la espera
   * arranca de cero.
   */
  posponer(): void;
  /** ¿Quedan tareas esperando el debounce? (la interfaz sigue "en uso"). */
  pendiente(): boolean;
  /** Ejecuta YA las tareas pendientes, en orden de programación. */
  ejecutarYa(): Promise<void>;
  /** Descarta la tarea pendiente de una clave (recurso eliminado). */
  descartar(clave: string): void;
  /** Descarta las tareas pendientes sin ejecutarlas. */
  cancelar(): void;
}

/**
 * Crea un agendador DEBOUNCED por clave: cada `programar()` reinicia el reloj y
 * el lote completo se ejecuta UNA vez, `ms` después del último gesto. Las tareas
 * corren en serie (una espera a la anterior) para no pisar geometrías.
 */
export function crearAgendadorGuardado(ms: number = MS_GUARDADO_FINAL): AgendadorGuardado {
  const tareas = new Map<string, () => void | Promise<void>>();
  let temporizador: number | null = null;

  const limpiar = (): void => {
    if (temporizador !== null) {
      window.clearTimeout(temporizador);
      temporizador = null;
    }
  };

  // Se consume UNA tarea por vuelta: mientras corre la primera, las restantes
  // siguen visibles en `tareas` y `pendiente()` responde con la verdad (así el
  // refresco pesado no se adelanta a mitad del lote).
  const ejecutarPendientes = async (): Promise<void> => {
    while (tareas.size > 0) {
      const primera = tareas.entries().next().value;
      if (!primera) return;
      const [clave, ejecutar] = primera;
      tareas.delete(clave);
      await ejecutar();
    }
  };

  const armar = (): void => {
    limpiar();
    temporizador = window.setTimeout(() => {
      temporizador = null;
      // FRENO DE EDICIÓN DE TEXTO: si el operador está escribiendo el nombre de un
      // espacio, el reloj NO dispara el PUT. La respuesta repintaría el lienzo por
      // `innerHTML`, destruyendo el `<input>` con el texto a medio escribir. El
      // lote queda intacto y se ejecuta cuando termine (Enter, blur deliberado o
      // «💾 Guardar»).
      if (hayEdicionTextoActiva()) {
        armar();
        return;
      }
      void ejecutarPendientes();
    }, ms);
  };

  return {
    programar(clave: string, ejecutar: () => void | Promise<void>): void {
      tareas.set(clave, ejecutar);
      armar();
    },
    posponer(): void {
      if (tareas.size > 0) armar();
    },
    pendiente(): boolean {
      return tareas.size > 0;
    },
    async ejecutarYa(): Promise<void> {
      limpiar();
      await ejecutarPendientes();
    },
    descartar(clave: string): void {
      tareas.delete(clave);
      if (tareas.size === 0) limpiar();
    },
    cancelar(): void {
      limpiar();
      tareas.clear();
    },
  };
}

/**
 * INSTANCIA ÚNICA DEL EDITOR DE ESPACIOS: la comparten el arrastre, el resizing
 * y el perímetro elástico. Un solo reloj para todos los gestos del lienzo: si el
 * operador acomoda varias piezas seguidas, la red recibe UN lote consolidado y
 * nunca se dispara un guardado mientras el dedo está en pantalla.
 */
export const guardadoEditor = crearAgendadorGuardado();

// Red de seguridad: si el operador abandona la página con un lote pendiente, el
// guardado se dispara YA en lugar de esperar un reloj que nunca va a vencer.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    void guardadoEditor.ejecutarYa();
  });
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
