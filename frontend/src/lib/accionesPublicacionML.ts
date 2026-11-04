// =============================================================================
// ACCIÓN RÁPIDA · PAUSAR / REACTIVAR LA PUBLICACIÓN EN MERCADO LIBRE
// -----------------------------------------------------------------------------
// Botón ÚNICO que comparten la TARJETA del tablero de Decisiones
// (/alertas-stock) y el BLOQUE DE PUBLICACIÓN de la ficha del objeto
// (/objetos/<id>):
//
//   · publicación ACTIVA  → «⏸ Pausar publicación»     → status "paused"
//   · publicación PAUSADA → «▶️ Reactivar publicación» → status "active"
//
// El backend ejecuta la llamada real a Mercado Libre
// (PUT /items/{item_id} {"status": ...}) y persiste el estado que devuelve la
// API; la respuesta se usa para repintar la insignia EN CALIENTE (sin F5):
//   1. el botón se re-etiqueta para la acción inversa,
//   2. se emite EVENTO_PUBLICACION_ACTUALIZADA, que hace que las islas del
//      tablero (ventas destacadas y bloques 3/4/5) recarguen sus tarjetas con
//      el estado REAL recién guardado.
//
// Auth 100% centralizada en services/auth a través de services/mercadolibre.
// =============================================================================

import { cambiarEstadoPublicacionML } from '../services/mercadolibre';
import type { EstadoPublicacionML } from '../services/mercadolibre';
import { escaparHtml } from './invitacionEstok';
import { notificarPublicacionActualizada } from './eventosDecisiones';
import { showToast } from './toast';

/** Estado NATIVO de Mercado Libre que fija el botón. */
export type EstadoNativoPublicacion = 'paused' | 'active';

/** Estados canónicos (backend) en los que se ofrece la acción rápida. */
const ESTADOS_CON_ACCION = ['publicado', 'pausada'];

const ESTILO_PAUSAR = 'bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-200';
const ESTILO_REACTIVAR = 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border-emerald-200';

/** Clases base del botón (semántica compartida tarjeta ↔ ficha). */
const CLASES_BASE =
  'inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg '
  + 'border text-xs font-semibold transition-base cursor-pointer '
  + 'disabled:opacity-60 disabled:cursor-wait';

export interface OpcionesBotonPublicacion {
  /** UUID del objeto dueño de la publicación. */
  objetoId: string;
  /** Estado canónico del backend: 'publicado' | 'pausada' | 'finalizada' | … */
  estado?: string | null;
  /** Clases extra del consumidor (ancho completo en la tarjeta, etc.). */
  clases?: string;
}

/**
 * Botón «⏸ Pausar publicación» / «▶️ Reactivar publicación».
 *
 * Devuelve '' cuando el objeto no tiene una publicación vigente (sin publicar,
 * finalizada o eliminada en Mercado Libre): no hay nada que pausar.
 */
export function botonEstadoPublicacionHtml(opciones: OpcionesBotonPublicacion): string {
  const estado = String(opciones.estado || '').trim().toLowerCase();
  const objetoId = String(opciones.objetoId || '').trim();
  if (!objetoId || !ESTADOS_CON_ACCION.includes(estado)) return '';

  const destino: EstadoNativoPublicacion = estado === 'publicado' ? 'paused' : 'active';
  const etiqueta = destino === 'paused' ? '⏸ Pausar publicación' : '▶️ Reactivar publicación';
  const estilo = destino === 'paused' ? ESTILO_PAUSAR : ESTILO_REACTIVAR;
  const clases = [CLASES_BASE, estilo, opciones.clases].filter(Boolean).join(' ');

  return `<button type="button" data-ml-estado="${destino}"`
    + ` data-objeto-id="${escaparHtml(objetoId)}"`
    + ` class="${clases}"`
    + ` title="${etiqueta} en Mercado Libre"`
    + `>${etiqueta}</button>`;
}

/** Re-etiqueta el botón para la acción inversa (feedback inmediato). */
function pintarBoton(boton: HTMLElement, destino: EstadoNativoPublicacion): void {
  boton.dataset.mlEstado = destino;
  boton.textContent = destino === 'paused'
    ? '⏸ Pausar publicación'
    : '▶️ Reactivar publicación';
  const añadir = destino === 'paused' ? ESTILO_PAUSAR : ESTILO_REACTIVAR;
  const quitar = destino === 'paused' ? ESTILO_REACTIVAR : ESTILO_PAUSAR;
  quitar.split(' ').forEach((clase) => boton.classList.remove(clase));
  añadir.split(' ').forEach((clase) => boton.classList.add(clase));
}

/**
 * Ejecuta el cambio de estado pedido por el botón.
 *
 * Se comparte entre la tarjeta (delegación global) y la ficha del objeto, así
 * la lógica de «deshabilitar → llamar → repintar → avisar» vive en UN solo
 * lugar. Devuelve el estado persistido, o null si falló.
 */
export async function ejecutarCambioEstadoPublicacion(
  boton: HTMLElement,
): Promise<EstadoPublicacionML | null> {
  const objetoId = String(boton.dataset.objetoId || '').trim();
  const destino = String(boton.dataset.mlEstado || '').trim() as EstadoNativoPublicacion;
  if (!objetoId || (destino !== 'paused' && destino !== 'active')) return null;
  if (boton.dataset.procesando === 'true') return null;

  const etiquetaPrevia = boton.textContent || '';
  boton.dataset.procesando = 'true';
  boton.setAttribute('disabled', 'disabled');
  boton.textContent = destino === 'paused' ? '⏸ Pausando…' : '▶️ Reactivando…';

  try {
    const estado = await cambiarEstadoPublicacionML(objetoId, destino);
    // El botón pasa a ofrecer la acción inversa y el tablero recarga sus
    // tarjetas con el estado real que acaba de persistirse en Estok.
    pintarBoton(boton, destino === 'paused' ? 'active' : 'paused');
    boton.removeAttribute('disabled');
    showToast(
      destino === 'paused'
        ? '⏸️ Publicación pausada en Mercado Libre.'
        : '▶️ Publicación reactivada en Mercado Libre.',
      'success',
    );
    notificarPublicacionActualizada();
    return estado;
  } catch (error) {
    boton.textContent = etiquetaPrevia;
    boton.removeAttribute('disabled');
    const mensaje = error instanceof Error && error.message
      ? error.message
      : 'No se pudo cambiar el estado de la publicación.';
    showToast(`❌ ${mensaje}`, 'error');
    return null;
  } finally {
    boton.dataset.procesando = 'false';
  }
}

let delegacionEnlazada = false;

/**
 * Habilita la acción rápida en las TARJETAS de /alertas-stock.
 *
 * Delegación en el documento: funciona también con las tarjetas que las islas
 * vuelven a inyectar en caliente (filtros, refrescos, cambios de decisión).
 * El clic NO navega a la ficha: el botón está excluido de la navegación de
 * tarjetas (SELECTOR_ACCION_PROPIA de decisionesTarjeta.ts).
 */
export function iniciarAccionesEstadoPublicacion(): void {
  if (delegacionEnlazada || typeof document === 'undefined') return;
  delegacionEnlazada = true;

  document.addEventListener('click', (evento) => {
    const objetivo = evento.target as HTMLElement | null;
    const boton = objetivo?.closest?.<HTMLElement>('[data-ml-estado]');
    if (!boton) return;
    evento.preventDefault();
    void ejecutarCambioEstadoPublicacion(boton);
  });
}

