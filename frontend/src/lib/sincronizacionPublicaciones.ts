// =============================================================================
// SINCRONIZACIÓN DEL ESTADO REAL DE LAS PUBLICACIONES (/alertas-stock)
// -----------------------------------------------------------------------------
// Al abrir la pestaña Decisiones se verifica contra la API de Mercado Libre el
// estado real de las publicaciones del Estok (GET /items/{id} en el backend):
// si el usuario pausó, finalizó o eliminó un ítem desde la web de Mercado
// Libre, Estok lo refleja y las tarjetas dejan de decir «Publicado».
//
// CARGA EN SEGUNDO PLANO: el tablero se pinta primero y esta verificación
// corre detrás. Si algo cambió, se emite el evento global de publicación y las
// islas recargan sus datos con el estado verdadero (sin F5).
// Auth 100% centralizada en services/mercadolibre + services/auth.
// =============================================================================

import { sincronizarEstadosML } from '../services/mercadolibre';
import { notificarPublicacionActualizada } from './eventosDecisiones';

let sincronizando = false;
let yaVerificado = false;

/**
 * Verifica el estado real de las publicaciones del Estok activo.
 *
 * Devuelve cuántas publicaciones cambiaron de estado (0 si no había nada que
 * verificar o si Mercado Libre no respondió).
 */
export async function sincronizarEstadosPublicaciones(): Promise<number> {
  if (sincronizando || yaVerificado) return 0;
  sincronizando = true;
  try {
    const resultado = await sincronizarEstadosML();
    yaVerificado = true;
    const actualizados = Number(resultado?.actualizados || 0);
    if (actualizados > 0) {
      // Las tarjetas se vuelven a pedir al backend con el estado REAL.
      notificarPublicacionActualizada();
    }
    return actualizados;
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
