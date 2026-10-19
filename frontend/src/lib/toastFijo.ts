// =============================================================================
// TOASTS FIJOS - CERO LAYOUT SHIFT (móvil / iOS Safari)
// -----------------------------------------------------------------------------
// Única fábrica de contenedores de notificación flotantes del proyecto.
// Contrato ESTRICTO:
//   · `position: fixed` con `z-index: 9999` y `pointer-events: none`;
//   · estilos INLINE (no dependen de que Tailwind genere la clase);
//   · el nodo vive en <body> y NUNCA participa del flujo: mostrarlo, apilarlo
//     o quitarlo no cambia el alto/ancho del lienzo ni la posición del scroll;
//   · sin foco, sin `tabindex`, sin `scrollIntoView`: la alerta jamás mueve el
//     viewport ni roba el foco del elemento que se acaba de editar.
// Lo consumen el toast del editor (mapa/mapaQueries.ts), el del tablero
// (almacenamientoBoard.ts) y los toasts globales del layout (layout/toasts.ts).
// =============================================================================

/** Esquina donde se apila la notificación (nunca altera el layout). */
export type PosicionToast = 'inferior-derecha' | 'superior-derecha';

/** Opciones del mensaje efímero. */
export interface OpcionesToastFijo {
  /** Clases del globo (color/tipografía). No afectan el layout de la página. */
  claseMensaje?: string;
  /** Tiempo visible antes del fundido (ms). 0 = permanente. */
  duracionMs?: number;
}

/** Aplica el contrato fijo a un contenedor (nuevo o preexistente). */
function fijarContenedor(cont: HTMLElement, posicion: PosicionToast): void {
  cont.style.position = 'fixed';
  cont.style.zIndex = '9999';
  cont.style.pointerEvents = 'none';
  cont.style.display = 'flex';
  cont.style.flexDirection = 'column';
  cont.style.gap = '8px';
  cont.style.margin = '0';
  cont.style.padding = '0';
  cont.style.maxWidth = 'min(360px, calc(100vw - 32px))';
  // Aísla el subárbol: sus cambios internos jamás invalidan el layout externo.
  cont.style.contain = 'layout style';
  if (posicion === 'superior-derecha') {
    cont.style.top = 'calc(16px + env(safe-area-inset-top, 0px))';
    cont.style.right = '16px';
    cont.style.bottom = '';
  } else {
    cont.style.bottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
    cont.style.right = '16px';
    cont.style.top = '';
  }
}

/**
 * Devuelve (o crea) el contenedor fijo con el id indicado. Si el nodo ya existe
 * (`#toastContainer` del layout) se le reaplican los estilos inline: la
 * garantía de cero layout shift no depende de las clases generadas.
 */
export function contenedorToastFijo(
  id: string,
  posicion: PosicionToast = 'inferior-derecha',
): HTMLElement {
  let cont = document.getElementById(id);
  if (!cont) {
    cont = document.createElement('div');
    cont.id = id;
    // `aria-live` anuncia el mensaje SIN mover el foco del elemento editado.
    cont.setAttribute('role', 'status');
    cont.setAttribute('aria-live', 'polite');
    document.body.appendChild(cont);
  }
  fijarContenedor(cont, posicion);
  return cont;
}

/**
 * Agrega un mensaje efímero DENTRO de un contenedor fijo. El globo tampoco
 * captura punteros ni recibe foco; desaparece solo.
 */
export function mostrarToastFijo(
  contenedor: HTMLElement,
  mensaje: string,
  opts: OpcionesToastFijo = {},
): HTMLElement {
  const el = document.createElement('div');
  if (opts.claseMensaje) el.className = opts.claseMensaje;
  el.textContent = mensaje;
  el.style.pointerEvents = 'none';
  contenedor.appendChild(el);
  const duracion = opts.duracionMs ?? 2600;
  if (duracion > 0) {
    window.setTimeout(() => {
      el.style.transition = 'opacity 300ms ease';
      el.style.opacity = '0';
      window.setTimeout(() => el.remove(), 350);
    }, duracion);
  }
  return el;
}
