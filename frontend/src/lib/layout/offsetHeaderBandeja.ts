// =============================================================================
// OFFSET DE LA BARRA FLOTANTE LATERAL (anclaje bajo el header)
// -----------------------------------------------------------------------------
// La canasta «🧺 Elementos por ubicar» es un panel `position: fixed` del margen
// derecho. Su `top` NO puede ser 0: tapaba la barra de navegación superior (logo,
// nombre de usuario y menú). Este módulo mide el borde INFERIOR real del <nav>
// principal y lo publica en la variable CSS `--header-height`, que la hoja de
// estilos usa para `top` y `height`.
//
// Se acota a 0 (nunca negativo): cuando el operador scrollea y el header sale de
// pantalla, el panel ocupa desde el borde superior sin dejar un hueco muerto.
// Mediciones coalescidas por requestAnimationFrame: el listener de scroll es
// pasivo y no provoca reflows por evento.
// =============================================================================

/** Variable CSS compartida con styles/almacenamiento-escenas.css. */
const VARIABLE = '--header-height';

export function initOffsetHeaderBandeja(): void {
  const raiz = document.documentElement;
  const nav = document.querySelector<HTMLElement>('body > nav');
  let frame = 0;

  const medir = (): void => {
    frame = 0;
    const alto = nav ? nav.getBoundingClientRect().bottom : 0;
    raiz.style.setProperty(VARIABLE, `${Math.max(0, Math.round(alto))}px`);
  };

  const programar = (): void => {
    if (frame) return;
    frame = window.requestAnimationFrame(medir);
  };

  medir();
  window.addEventListener('scroll', programar, { passive: true });
  window.addEventListener('resize', programar);
  window.addEventListener('orientationchange', programar);
  // El header se hidrata en caliente (nombre del Estok, usuarios online, admin):
  // se vuelve a medir cuando cambia su alto real.
  if (typeof ResizeObserver !== 'undefined' && nav) {
    new ResizeObserver(programar).observe(nav);
  }
  window.addEventListener('load', programar);
  window.addEventListener('estok:pageshow', programar);
}
