// =============================================================================
// DECISIÓN PATRIMONIAL EN LA FICHA DEL OBJETO (/objetos/<id>)
// -----------------------------------------------------------------------------
// Bloque «Decisión patrimonial» de la ficha, con la MISMA regla de propiedad que
// las tarjetas de /alertas-stock (lib/decisionesPropiedad.ts, fuente ÚNICA):
//
//   Caso A · el objeto es del usuario  → 💰 Vender / 🔄 Conservar / 🗑️ Tirar y Donar
//                                       (POST /api/objetos/{id}/tomar_decision/)
//   Caso B · objeto SIN propietario    → 🗳️ Iniciar votación (decisión compartida
//                                       del grupo familiar)
//   Caso C · objeto de OTRO usuario    → 📩 Avisar al propietario (aviso interno)
//
// El markup de los bloques vive en la página (ids `ownerAction*`); este módulo
// sólo lo muestra/oculta y ejecuta las acciones. Se sacó de la página para no
// seguir engordando un archivo de UI de más de 700 líneas (regla de
// modularidad del proyecto).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../services/auth';
import { modoDecisionObjeto } from '../decisionesPropiedad';
import { ofrecerNotificarDueno } from '../notificacionDueno';
import { showToast } from '../toast';

/** Etiquetas legibles de la decisión persistida en `owner_action`. */
const ETIQUETAS_DECISION: Record<string, string> = {
  vender: '💰 Vender',
  conservar: '🔄 Conservar',
  tirar: '🗑️ Tirar / Donar',
  mudar: '🚚 Mudar / Reclamar para mudanza',
};

/** Objeto mínimo de la ficha para las acciones del bloque de decisión. */
export interface ObjetoDecisionFicha {
  id?: string;
  nombre?: string | null;
  dueno_id?: string | null;
  dueno_original?: string | null;
  dueno_externo_nombre?: string | null;
  owner_action?: string | null;
}

interface OpcionesBloqueDecision {
  objetoId: string;
  /** Recarga el detalle (la página pasa su `cargarDetalle`). */
  recargar: () => void;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Último objeto dibujado: lo necesitan los botones (id + nombre del aviso). */
let objetoEnFicha: ObjetoDecisionFicha | null = null;

// -----------------------------------------------------------------------------
// Render del bloque
// -----------------------------------------------------------------------------

function mostrar(contenedorId: string, visible: boolean): void {
  el(contenedorId)?.classList.toggle('hidden', !visible);
}

/**
 * Pinta el bloque de decisión según quién es el propietario del objeto.
 * Se llama en cada carga del detalle (idempotente).
 */
export function renderDecisionDetalleObjeto(objeto: ObjetoDecisionFicha): void {
  objetoEnFicha = objeto;

  const seccion = el('ownerActionSection');
  if (!seccion) return;
  seccion.classList.remove('hidden');

  const modo = modoDecisionObjeto(objeto);
  const accion = objeto.owner_action || '';
  const decidido = Boolean(accion);

  mostrar('ownerActionPending', !decidido && modo === 'propietario');
  mostrar('ownerActionSinDueno', !decidido && modo === 'sin_dueno');
  mostrar('ownerActionAjeno', !decidido && modo === 'ajeno');

  const etiqueta = el('ownerActionLabel');
  if (etiqueta) {
    const texto = ETIQUETAS_DECISION[accion] || accion;
    etiqueta.textContent = modo === 'propietario'
      ? texto
      : `${texto} (decidido por el propietario)`;
  }
  mostrar('ownerActionDone', decidido);
  // «Limpiar decisión» es exclusivo del propietario: el backend responde 403 a
  // cualquier otro usuario que intente tocarla.
  mostrar('clearOwnerActionBtn', decidido && modo === 'propietario');
}

// -----------------------------------------------------------------------------
// Acciones
// -----------------------------------------------------------------------------

/** Caso A · decisión individual del propietario (endpoint blindado). */
async function tomarDecision(accion: string, opciones: OpcionesBloqueDecision): Promise<void> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/objetos/${opciones.objetoId}/tomar_decision/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ action: accion }),
      },
    );

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    // 202: el dueño es EXTERNO/fallecido y la decisión se derivó a la votación
    // del inquilinato (período FOMO). Se avisa para que nadie crea que el
    // objeto quedó marcado para vender.
    if (response.status === 202) {
      const data = await response.json().catch(() => ({}));
      showToast(
        `🗳️ ${data.mensaje || 'La decisión quedó derivada a la votación del inquilinato.'}`,
        'warning',
      );
      opciones.recargar();
      return;
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      showToast(`❌ ${err.error || err.detail || 'No se pudo registrar la decisión'}`, 'error');
      return;
    }

    opciones.recargar();
  } catch {
    showToast('❌ Error de conexión al registrar la decisión.', 'error');
  }
}

/** Limpia la decisión del propietario (vuelve a estado pendiente). */
async function limpiarDecision(opciones: OpcionesBloqueDecision): Promise<void> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/objetos/${opciones.objetoId}/clear_owner_action/`,
      { method: 'DELETE', headers: { ...getAuthHeaders() } },
    );

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      showToast(`❌ ${err.error || err.detail || 'No se pudo limpiar la decisión'}`, 'error');
      return;
    }

    opciones.recargar();
  } catch {
    showToast('❌ Error de conexión al limpiar la decisión.', 'error');
  }
}

/** Caso B · propone la decisión compartida al grupo familiar (votación). */
async function iniciarVotacion(opciones: OpcionesBloqueDecision): Promise<void> {
  const boton = el<HTMLButtonElement>('btnIniciarVotacionObjeto');
  if (boton) boton.disabled = true;

  try {
    const response = await fetch(
      `${API_BASE_URL}/objetos/${opciones.objetoId}/iniciar_votacion/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      },
    );

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      showToast(`❌ ${err.error || err.detail || 'No se pudo iniciar la votación'}`, 'error');
      return;
    }

    const data = await response.json().catch(() => ({}));
    showToast(`🗳️ ${data.mensaje || 'Votación abierta para todo el Estok.'}`, 'success');
    opciones.recargar();
  } catch {
    showToast('❌ Error de conexión al iniciar la votación.', 'error');
  } finally {
    if (boton) boton.disabled = false;
  }
}

/** Caso C · abre el modal del aviso interno al propietario. */
function avisarPropietario(): void {
  const objeto = objetoEnFicha;
  if (!objeto?.id) return;
  ofrecerNotificarDueno(objeto.id, objeto.nombre || '');
}

// -----------------------------------------------------------------------------
// Wiring
// -----------------------------------------------------------------------------

/** Enlaza los botones del bloque de decisión (idempotente, una vez por página). */
export function iniciarDecisionDetalleObjeto(opciones: OpcionesBloqueDecision): void {
  const seccion = el('ownerActionSection');
  if (!seccion || seccion.dataset.activo === 'true') return;
  seccion.dataset.activo = 'true';

  seccion.querySelectorAll<HTMLElement>('.owner-action-btn').forEach((boton) => {
    boton.addEventListener('click', () => {
      const accion = boton.getAttribute('data-action');
      if (accion) void tomarDecision(accion, opciones);
    });
  });

  el('clearOwnerActionBtn')?.addEventListener('click', () => void limpiarDecision(opciones));
  el('btnIniciarVotacionObjeto')?.addEventListener('click', () => void iniciarVotacion(opciones));
  el('btnAvisarPropietarioObjeto')?.addEventListener('click', avisarPropietario);
}
