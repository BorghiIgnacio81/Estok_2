// =============================================================================
// EDICIÓN DE ESPACIO ACTIVA · CONGELACIÓN DEL VIEWPORT Y DE LOS RE-RENDERS
// -----------------------------------------------------------------------------
// Mientras el operador modifica el TAMAÑO (tirador elástico), las COORDENADAS
// (arrastre) o el NOMBRE (renombrado in-place) de un espacio del lienzo, el
// canvas NO puede repintarse: cada respuesta del backend emite
// `estok:espacios-cambiados`, los paneles se reconstruyen por `innerHTML` y el
// nodo bajo el dedo/cursor desaparece → salto de scroll, pérdida del foco y del
// cursor de texto.
//
// Este módulo centraliza DOS frenos que usan todos los consumidores:
//
//   1. `hayEdicionEspacioActiva()` → ¿hay una edición de espacio en curso o
//      recién terminada (ventana de calma)? Los refrescos pesados NO corren:
//      se reprograman (mismo patrón que los visores históricos).
//      Compone las banderas existentes (edición de texto, redimensión, gesto,
//      guardado diferido y calma post-gesto) MÁS el bloqueo explícito que abren
//      los editores con `iniciarEdicionEspacio()`.
//
//   2. `conservarViewport()` / `conservarViewportAsync()` → ejecutan la mutación
//      conservando la posición EXACTA del scroll, el elemento enfocado y la
//      posición del cursor de texto (caret), de modo que quien deba refrescar lo
//      haga sin mover la vista ni un píxel.
//
// Módulo de DOM puro: no hace fetch ni conoce el estado de ningún lienzo.
// Lo consumen lib/mapa/portales, lib/mapaCasitaNavegable, lib/visorHabitacion,
// lib/visorContenedorGrande y lib/almacenamientoBoard.
// =============================================================================

import { estaRedimensionando } from './bloqueoScrollGesto';
import { guardadoEditor } from './debounceGuardado';
import { hayEdicionTextoActiva } from './edicionTextoActiva';
import { hayGestoActivo, hayInteraccionReciente, marcarInteraccionEditor } from './pintorFrame';
import { reafirmarScroll } from './scrollPreservado';

/** Cantidad de bloqueos explícitos abiertos por los editores del lienzo. */
let bloqueos = 0;

/**
 * Abre un bloqueo EXPLÍCITO de edición de espacio.
 *
 * Debe llamarse al iniciar la edición y liberarse SIEMPRE en un `finally`
 * (Enter, blur, cancelación o fallo de red): un bloqueo filtrado dejaría los
 * paneles sin refrescarse nunca. La liberación devuelta es idempotente.
 */
export function iniciarEdicionEspacio(): () => void {
  bloqueos += 1;
  // Un gesto nuevo reinicia la ventana de calma posterior.
  marcarInteraccionEditor();
  let liberado = false;
  return (): void => {
    if (liberado) return;
    liberado = true;
    bloqueos = Math.max(0, bloqueos - 1);
  };
}

/**
 * ¿Hay una edición de espacio EN CURSO o el editor todavía no quedó quieto?
 *
 * `true` = ningún refresco pesado debe repintar el lienzo: el consumidor
 * reprograma su tarea (200-250 ms) y vuelve a consultar.
 */
export function hayEdicionEspacioActiva(): boolean {
  return (
    bloqueos > 0 ||
    hayEdicionTextoActiva() ||
    estaRedimensionando() ||
    hayGestoActivo() ||
    // PUT diferido pendiente: refrescar ahora repintaría la geometría VIEJA y
    // el espacio "saltaría" al llegar la respuesta.
    guardadoEditor.pendiente() ||
    hayInteraccionReciente()
  );
}


// =============================================================================
// CONSERVACIÓN DEL VIEWPORT: SCROLL + FOCO + CURSOR DE TEXTO
// =============================================================================

/** Estado previo del foco que se intenta reponer tras el re-render. */
interface FocoPrevisto {
  /** Selector CSS del campo (null = no había foco textual que conservar). */
  selector: string | null;
  /** Posición del caret al iniciar la mutación. */
  inicio: number | null;
  fin: number | null;
}

/** Escapa comillas/backslashes de un valor usado dentro de `[attr="..."]`. */
function escaparAtributo(valor: string): string {
  return valor.replace(/(["\\])/g, '\\$1');
}

/** Selector estable del campo enfocado (id, campo de objeto o data-id). */
function selectorDeFoco(el: HTMLElement | null): string | null {
  if (!el) return null;
  if (el.id) return `#${escaparAtributo(el.id)}`;
  const candidatos: Array<[string, string | undefined]> = [
    ['data-objeto-campo', el.dataset.objetoCampo],
    ['name', el.getAttribute('name') ?? undefined],
    [
      'data-inplace-renombrar',
      el.hasAttribute('data-inplace-renombrar') ? el.dataset.id : undefined,
    ],
    ['data-bandeja-dnd', el.dataset.bandejaDnd],
    ['data-id', el.dataset.id],
  ];
  for (const [atributo, valor] of candidatos) {
    if (valor) return `[${atributo}="${escaparAtributo(valor)}"]`;
  }
  return null;
}

/** ¿El nodo es un campo donde el operador escribe texto? */
function esCampoTexto(nodo: Element | null): nodo is HTMLInputElement | HTMLTextAreaElement {
  if (nodo instanceof HTMLTextAreaElement) return true;
  if (nodo instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes(
      nodo.type,
    );
  }
  return false;
}

/** Captura el foco textual vigente (nada si el foco no es un campo de texto). */
function capturarFoco(): FocoPrevisto {
  const activo = document.activeElement;
  if (!esCampoTexto(activo)) return { selector: null, inicio: null, fin: null };
  const selector = selectorDeFoco(activo);
  if (!selector) return { selector: null, inicio: null, fin: null };
  let inicio: number | null = null;
  let fin: number | null = null;
  try {
    inicio = activo.selectionStart;
    fin = activo.selectionEnd;
  } catch {
    // Inputs sin selección (type=email/number en algunos motores): se conserva
    // el foco aunque no se pueda reponer el caret.
    inicio = null;
    fin = null;
  }
  return { selector, inicio, fin };
}

/** Repone foco y caret SOLO si el re-render destruyó el campo original. */
function restaurarFoco(previo: FocoPrevisto): void {
  if (!previo.selector) return;
  const actual = document.activeElement;
  if (actual instanceof HTMLElement && actual.matches(previo.selector)) return;
  const destino = document.querySelector<HTMLElement>(previo.selector);
  if (!destino) return;
  // preventScroll: recuperar el foco no debe desplazar la página ni un píxel.
  destino.focus({ preventScroll: true });
  if (previo.inicio != null && esCampoTexto(destino)) {
    try {
      destino.setSelectionRange(previo.inicio, previo.fin ?? previo.inicio);
    } catch {
      /* el tipo de input no admite selección parcial: el foco ya quedó puesto */
    }
  }
}

/**
 * Ejecuta una mutación SÍNCRONA del DOM conservando scroll, foco y caret.
 * Pensado para re-renders por `innerHTML` disparados por un PUT.
 */
export function conservarViewport(mutacion: () => void): void {
  const x = window.scrollX;
  const y = window.scrollY;
  const foco = capturarFoco();
  mutacion();
  reafirmarScroll(x, y);
  restaurarFoco(foco);
}

/** Versión ASÍNCRONA (el re-render suele vivir después del `await`). */
export async function conservarViewportAsync(tarea: () => Promise<void>): Promise<void> {
  const x = window.scrollX;
  const y = window.scrollY;
  const foco = capturarFoco();
  await tarea();
  reafirmarScroll(x, y);
  restaurarFoco(foco);
}
