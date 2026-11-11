// =============================================================================
// CIERRE DEL CICLO DE UNA DECISIÓN (Sección 1 de /alertas-stock)
// -----------------------------------------------------------------------------
// La Sección 1 («✅ Decisiones tomadas (En proceso)») muestra los objetos con
// decisión tomada hasta que su ciclo termina. Este módulo aporta:
//
//   · 💰 «Marcar como Vendido»      → POST /api/objetos/{id}/marcar_vendido/
//     El objeto sale del Estok activo (histórico/archivado) y el backend
//     registra el INGRESO FINANCIERO con el usuario que lo vendió
//     (`usuario_vendedor_id` de VentaObjeto).
//   · 🗑️ «Marcar como Tirado/Donado» → POST /api/objetos/{id}/marcar_tirado/
//     El objeto abandona el Estok activo (baja lógica). Se bloquea mientras el
//     período de gracia siga vigente: en ese lapso todavía puede reclamarse.
//
// La regla de QUIÉN puede cerrar es la misma de la tarjeta patrimonial
// (lib/decisionesPropiedad.ts): el propietario del objeto o, si el objeto no
// tiene dueño registrado, la decisión del grupo. Los objetos de OTROS usuarios
// no ofrecen el cierre (sólo «Avisar al propietario»).
//
// Auth 100% centralizada en services/auth (getAuthHeaders).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { escapar } from './decisionesTarjeta';
import type { ObjetoDecision } from './decisionesTarjeta';
import { modoDecisionObjeto } from './decisionesPropiedad';
import { notificarDecisionCambiada } from './eventosDecisiones';

/** Resultado de un intento de cierre (cancelado por el usuario vs. ejecutado). */
export interface ResultadoCierre {
  cancelado: boolean;
  mensaje: string;
}

/** True si el usuario autenticado puede cerrar el ciclo de este objeto. */
export function puedeCerrarCiclo(obj: ObjetoDecision): boolean {
  const modo = modoDecisionObjeto(obj);
  return modo === 'propietario' || modo === 'sin_dueno';
}

/**
 * Canal de venta a registrar en el asiento financiero.
 *
 * Se deduce de las plataformas donde el objeto está publicado; sin
 * publicación se registra «venta directa».
 */
function canalDe(obj: ObjetoDecision): string {
  const plataformas = (obj.plataformas_publicadas || []).map((p) => String(p).toLowerCase());
  if (plataformas.includes('mercadolibre')) return 'mercadolibre';
  if (plataformas.includes('facebook')) return 'facebook';
  if (plataformas.includes('instagram')) return 'instagram';
  return 'directo';
}

/** POST autenticado del cierre: devuelve el mensaje legible del backend. */
async function postCierre(
  objetoId: string,
  accion: 'marcar_vendido' | 'marcar_tirado',
  cuerpo: Record<string, unknown> = {},
): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/objetos/${objetoId}/${accion}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(cuerpo),
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesión expirada.');
  }
  const data = (await res.json().catch(() => ({}))) as {
    mensaje?: string;
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(
      data.error || data.detail || `Error ${res.status} al cerrar el ciclo del objeto.`,
    );
  }
  return data.mensaje || 'Listo.';
}

// -----------------------------------------------------------------------------
// Confirmaciones (diálogo nativo del navegador, igual que el resto del módulo)
// -----------------------------------------------------------------------------

/** Pide el precio final y cierra la venta (registra el ingreso financiero). */
export async function confirmarVenta(obj: ObjetoDecision): Promise<ResultadoCierre> {
  const sugerido = String(obj.valor_estimado ?? '');
  const entrada = window.prompt(
    `💰 ¿Confirmar la venta de "${obj.nombre}"?\n\n` +
      'Precio final de venta (dejalo vacío para registrar el valor estimado):',
    sugerido,
  );

  // null = el usuario canceló el diálogo: no se toca nada.
  if (entrada === null) return { cancelado: true, mensaje: '' };

  const precio = entrada.trim();
  if (precio && !/^\d+([.,]\d{1,2})?$/.test(precio)) {
    throw new Error('El precio ingresado no es válido (ejemplos: 150 o 150.50).');
  }

  const mensaje = await postCierre(obj.id, 'marcar_vendido', {
    precio_venta: precio ? precio.replace(',', '.') : null,
    moneda: 'USD',
    canal: canalDe(obj),
  });
  return { cancelado: false, mensaje };
}

/** Confirma el descarte definitivo y saca el objeto del Estok activo. */
export async function confirmarTirado(obj: ObjetoDecision): Promise<ResultadoCierre> {
  if (obj.en_periodo_gracia) {
    throw new Error(
      'El período de gracia sigue vigente: el objeto todavía puede reclamarse.',
    );
  }
  const aviso = window.confirm(
    `🗑️ ¿Confirmar que "${obj.nombre}" ya fue tirado o donado?\n\n` +
      'El objeto saldrá del Estok activo y quedará archivado en el histórico.',
  );
  if (!aviso) return { cancelado: true, mensaje: '' };

  const mensaje = await postCierre(obj.id, 'marcar_tirado');
  return { cancelado: false, mensaje };
}

// -----------------------------------------------------------------------------
// Markup de los botones de cierre
// -----------------------------------------------------------------------------

/**
 * Botón de cierre de la tarjeta según el tipo de decisión.
 *
 * Devuelve cadena vacía cuando el objeto pertenece a OTRO usuario (no se puede
 * decidir por él) o cuando el botón no corresponde a esa decisión.
 */
export function accionesCierreHtml(obj: ObjetoDecision, tipo: 'vender' | 'tirar'): string {
  if (!puedeCerrarCiclo(obj)) return '';

  if (tipo === 'vender') {
    return `
      <button type="button" data-marcar-vendido="${escapar(obj.id)}"
        title="Confirmar la venta: el objeto sale del Estok activo y el ingreso queda registrado"
        class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-base disabled:opacity-40 disabled:cursor-not-allowed">
        <span aria-hidden="true">✅</span>Marcar como Vendido
      </button>`;
  }

  // 🗑️ El descarte definitivo espera el fin del período de reclamo: mientras
  // esté vigente, el botón queda deshabilitado (el backend también lo rechaza).
  if (obj.en_periodo_gracia) {
    return `
      <button type="button" disabled title="Se habilita cuando vence el período de reclamo"
        class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-gray-500 bg-gray-100 rounded-lg cursor-not-allowed">
        <span aria-hidden="true">⏳</span>En período de reclamo
      </button>`;
  }

  return `
    <button type="button" data-marcar-tirado="${escapar(obj.id)}"
      title="Confirmar que el objeto ya fue tirado o donado: sale del Estok activo"
      class="inline-flex items-center justify-center gap-1 px-2 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg shadow-sm transition-base disabled:opacity-40 disabled:cursor-not-allowed">
      <span aria-hidden="true">🗑️</span>Marcar como Tirado/Donado
    </button>`;
}

// -----------------------------------------------------------------------------
// Manejo del clic (delegado desde el tablero de decisiones)
// -----------------------------------------------------------------------------

/**
 * Ejecuta el cierre si el clic cayó en un botón de este módulo.
 *
 * Devuelve true cuando el evento YA fue atendido (el tablero no debe procesarlo
 * como otra acción). `buscar` resuelve el objeto por id y `avisar` es el canal
 * de mensajes del tablero (evita el import circular con decisionesGrupos).
 */
export async function manejarClickCierre(
  evento: Event,
  buscar: (id?: string) => ObjetoDecision | undefined,
  avisar: (mensaje: string, exito?: boolean) => void,
): Promise<boolean> {
  const objetivo = evento.target as HTMLElement | null;
  const botonVender = objetivo?.closest<HTMLButtonElement>('[data-marcar-vendido]');
  const botonTirar = objetivo?.closest<HTMLButtonElement>('[data-marcar-tirado]');
  const boton = botonVender || botonTirar;
  if (!boton) return false;

  const id = botonVender?.dataset.marcarVendido ?? botonTirar?.dataset.marcarTirado;
  const obj = buscar(id);
  if (!obj) return true;

  boton.disabled = true;
  try {
    const resultado = botonVender
      ? await confirmarVenta(obj)
      : await confirmarTirado(obj);

    if (resultado.cancelado) {
      boton.disabled = false;
      return true;
    }

    avisar(resultado.mensaje, true);
    // El objeto ya salió del Estok activo: se recargan el tablero, la sección
    // de venta y las votaciones sin esperar a un refresh manual.
    notificarDecisionCambiada();
  } catch (error) {
    avisar(
      error instanceof Error ? error.message : 'No se pudo cerrar el ciclo del objeto.',
      false,
    );
    boton.disabled = false;
  }
  return true;
}
