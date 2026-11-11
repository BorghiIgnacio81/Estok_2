// =============================================================================
// LATIDO DE INVENTARIO (una sola puerta para «cambió un objeto»)
// -----------------------------------------------------------------------------
// `estok:objetos-cambiados` repinta las pantallas YA abiertas del mismo
// documento (listado de /objetos, canasta de «por ubicar», tarjetas de caja).
// Para que una reclasificación (`es_contenedor` true ⇄ false) se vea también en
// OTRA pestaña —donde el CustomEvent de `window` no llega— se publica además
// una marca en localStorage: el evento nativo `storage` la propaga a las demás
// pestañas, que re-consultan el árbol sin F5.
//
// Y al volver por el historial (bfcache del navegador) la página se restaura
// con el DOM viejo: `pageshow` con `persisted=true` fuerza la re-consulta para
// que la tarjeta aparezca en su sección correcta sin recarga completa.
//
// Auth y fetch siguen centralizados: este módulo sólo coordina eventos.
// =============================================================================

const EVENTO_OBJETOS = 'estok:objetos-cambiados';

/** Clave de localStorage que propaga el latido a las demás pestañas. */
export const CLAVE_LATIDO_OBJETOS = 'estok_objetos_version';

/**
 * Avisa que el inventario cambió: emite el evento local y publica la marca
 * cross-tab. `detalle` viaja intacto en el CustomEvent (payload del objeto
 * guardado, id borrado, etc.).
 */
export function notificarObjetosCambiados(detalle?: unknown): void {
  window.dispatchEvent(new CustomEvent(EVENTO_OBJETOS, { detail: detalle }));
  try {
    localStorage.setItem(CLAVE_LATIDO_OBJETOS, String(Date.now()));
  } catch {
    // Modo privado o cuota llena: el evento local ya se emitió, alcanza.
  }
}

/**
 * Conecta una pantalla al latido del inventario.
 *
 * `recargar` se invoca en los tres caminos que pueden dejar la vista vieja:
 *   1. Mutación en ESTA pestaña (evento `estok:objetos-cambiados`).
 *   2. Mutación en OTRA pestaña (evento `storage` de la marca compartida).
 *   3. Restauración desde bfcache al volver con Atrás/Adelante.
 */
export function escucharObjetosCambiados(recargar: () => void): void {
  window.addEventListener(EVENTO_OBJETOS, () => recargar());
  window.addEventListener('storage', (evento) => {
    if (evento.key === CLAVE_LATIDO_OBJETOS) recargar();
  });
  window.addEventListener('pageshow', (evento) => {
    if ((evento as PageTransitionEvent).persisted) recargar();
  });
}
