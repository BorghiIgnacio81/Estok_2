// =============================================================================
// PRESERVACIÓN DE SCROLL EN EL RE-RENDERIZADO DE LOS LIENZOS
// -----------------------------------------------------------------------------
// Los refrescos asíncronos de los planos (arrastrar, redimensionar o editar una
// habitación/mueble → PUT al backend → re-lectura → innerHTML nuevo) pueden
// reposicionar el scroll del navegador y producir un salto visual brusco de
// arriba a abajo. Este helper captura la posición vigente de `window.scrollY` y
// la REAFIRMA tras la mutación del DOM (sincrónicamente y en los frames
// siguientes), de modo que el usuario nunca pierda su ubicación mientras modela.
//
// Regla de diseño: NO reemplaza a un `scrollIntoView`/foco DESEADO (navegación
// explícita). Solo neutraliza los saltos NO pedidos, por eso su uso es seguro en
// cualquier refresco de lienzo disparado por un gesto de edición.
// =============================================================================

/** Reafirma el scroll en `(x, y)` ahora y en los frames siguientes del re-flow. */
export function reafirmarScroll(x: number, y: number): void {
  const aplicar = (): void => {
    if (window.scrollX === x && window.scrollY === y) return;
    // `instant` ANULA el `scroll-behavior: smooth` global (styles/global.css):
    // sin animación el re-render no produce la "vibración" que en iOS Safari
    // se percibía al encadenar varios gestos de edición.
    try {
      window.scrollTo({ left: x, top: y, behavior: 'instant' });
    } catch {
      // Navegadores viejos sin `behavior: instant`: se anula el smooth inline.
      const raiz = document.documentElement;
      const previo = raiz.style.scrollBehavior;
      raiz.style.scrollBehavior = 'auto';
      window.scrollTo(x, y);
      raiz.style.scrollBehavior = previo;
    }
  };
  aplicar();
  requestAnimationFrame(aplicar);
  window.setTimeout(aplicar, 60);
  window.setTimeout(aplicar, 200);
}

/**
 * Ejecuta `mutacion` conservando la posición de scroll actual de la ventana.
 * Pensado para envolver un re-render SÍNCRONO (innerHTML + re-enlace).
 */
export function preservarScroll(mutacion: () => void): void {
  const x = window.scrollX;
  const y = window.scrollY;
  mutacion();
  reafirmarScroll(x, y);
}

/**
 * Envuelve una tarea de refresco ASÍNCRONA: captura el scroll antes de correrla
 * y lo reafirma al terminar (el re-render suele vivir después del `await`).
 */
export async function preservarScrollAsync(tarea: () => Promise<void>): Promise<void> {
  const x = window.scrollX;
  const y = window.scrollY;
  await tarea();
  reafirmarScroll(x, y);
}
