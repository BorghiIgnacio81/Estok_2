// =============================================================================
// BLOQUEO TOTAL DEL SCROLL DURANTE UNA REDIMENSIÓN (móvil / iOS Safari)
// -----------------------------------------------------------------------------
// Mientras el dedo está sobre un tirador de tamaño la página debe quedar 100%
// inmóvil: ni scroll, ni rebote elástico, ni pinch-to-zoom. Este módulo expone:
//
//   - `iniciarBloqueoResize()` → activa la bandera `isResizing` y agrega la
//     clase `estok-resize-lock` en <html> (overflow:hidden + overscroll:none,
//     ver styles/global.css). Devuelve la liberación idempotente que cada motor
//     llama en pointerup / pointercancel.
//   - `estaRedimensionando()` → estado consultable por cualquier consumidor
//     (equivalente a `hayGestoActivo()` para el arrastre).
//
// El bloqueo es REENTRANTE (contador): si dos tiradores conviven en una misma
// ráfaga, la clase recién se retira al soltar el último. NO se usa
// `position: fixed` en el body: recolocar el documento al iniciar el gesto
// produciría justamente el salto visual que se intenta eliminar.
// =============================================================================

/** Clase que congela el documento (declarada en styles/global.css). */
const CLASE_BLOQUEO = 'estok-resize-lock';

/** Cantidad de gestos de redimensión activos (bandera `isResizing`). */
let gestosActivos = 0;

/** Posición del documento al iniciar el gesto (se restaura al soltar). */
let scrollX = 0;
let scrollY = 0;

/** ¿Hay una redimensión en curso AHORA MISMO? (bandera tipo `isResizing`). */
export function estaRedimensionando(): boolean {
  return gestosActivos > 0;
}

/** Restaura la posición exacta del documento sin animación (`scroll-behavior`). */
function restaurarScroll(): void {
  if (window.scrollX === scrollX && window.scrollY === scrollY) return;
  // global.css declara `scroll-behavior: smooth` en <html>: se anula un instante
  // para que la restauración sea instantánea (nunca se ve un desplazamiento).
  const raiz = document.documentElement;
  const previo = raiz.style.scrollBehavior;
  raiz.style.scrollBehavior = 'auto';
  window.scrollTo(scrollX, scrollY);
  raiz.style.scrollBehavior = previo;
}

/**
 * Congela el documento durante un gesto de redimensión.
 * Debe llamarse en el `pointerdown` del tirador (después de validar el gesto)
 * y liberarse SIEMPRE en `pointerup` / `pointercancel`.
 */
export function iniciarBloqueoResize(): () => void {
  if (gestosActivos === 0) {
    scrollX = window.scrollX;
    scrollY = window.scrollY;
    document.documentElement.classList.add(CLASE_BLOQUEO);
    document.body?.classList.add(CLASE_BLOQUEO);
  }
  gestosActivos += 1;
  let liberado = false;
  return (): void => {
    if (liberado) return;
    liberado = true;
    gestosActivos = Math.max(0, gestosActivos - 1);
    if (gestosActivos > 0) return;
    document.documentElement.classList.remove(CLASE_BLOQUEO);
    document.body?.classList.remove(CLASE_BLOQUEO);
    // iOS puede colapsar el offset al aplicar overflow:hidden: se repone la
    // posición original (sin esto la pantalla "saltaría" al soltar).
    restaurarScroll();
  };
}
