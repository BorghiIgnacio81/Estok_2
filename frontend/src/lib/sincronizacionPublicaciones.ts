// =============================================================================
// SINCRONIZACIÓN DEL ESTADO REAL DE LAS PUBLICACIONES (/alertas-stock)
// -----------------------------------------------------------------------------
// Al abrir la pestaña Decisiones se verifica contra la API de Mercado Libre el
// estado real de las publicaciones del Estok (GET /items/{id} en el backend) y,
// en la misma pasada, se consultan los ítems del vendedor
// (GET /users/{user_id}/items/search) para guardar la PERMALINK vigente de cada
// publicación. Las tarjetas de /alertas-stock usan esa permalink guardada en el
// botón «Ver publicación»: sin ella no se dibuja el botón (nunca un 404).
//
// CARGA EN SEGUNDO PLANO: el tablero se pinta primero y esta verificación
// corre detrás. Si algo cambió (estado o permalink), se emite el evento global
// de publicación y las islas recargan sus datos con el estado verdadero (sin F5).
// Auth 100% centralizada en services/mercadolibre + services/auth.
// =============================================================================

import { sincronizarEstadosML } from '../services/mercadolibre';
import { notificarPublicacionActualizada } from './eventosDecisiones';

let sincronizando = false;
let yaVerificado = false;

/**
 * Verifica el estado real de las publicaciones del Estok activo.
 *
 * Devuelve cuántas publicaciones cambiaron de estado o de permalink (0 si no
 * había nada que verificar o si Mercado Libre no respondió).
 */
export async function sincronizarEstadosPublicaciones(): Promise<number> {
  if (sincronizando || yaVerificado) return 0;
  sincronizando = true;
  try {
    const resultado = await sincronizarEstadosML();
    yaVerificado = true;
    const actualizados = Number(resultado?.actualizados || 0);
    // Una permalink nueva también obliga a repintar: el botón «Ver publicación»
    // se arma con la permalink guardada, no con una URL construida a mano.
    const permalinks = Number(resultado?.vendedor?.permalinks_actualizados || 0);
    const cambios = actualizados + permalinks;
    if (cambios > 0) {
      // Las tarjetas se vuelven a pedir al backend con el estado REAL.
      notificarPublicacionActualizada();
    }
    return cambios;
  } catch (error) {
    // Best-effort: sin conexión con Mercado Libre el tablero sigue funcionando
    // con el último estado conocido.
    console.warn(
      '[Publicaciones] No se pudo verificar el estado en Mercado Libre:',
      error,
    );
    return 0;
  } finally {
    sincronizando = false;
  }
}

/** Dispara la verificación una sola vez por carga de página (sin bloquear). */
export function iniciarSincronizacionPublicaciones(demoraMs = 800): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    void sincronizarEstadosPublicaciones();
  }, demoraMs);
}
