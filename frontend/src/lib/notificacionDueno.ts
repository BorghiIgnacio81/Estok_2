// =============================================================================
// NOTIFICACIÓN AL DUEÑO (puente del 403) — pestaña "Decisiones"
// -----------------------------------------------------------------------------
// Cuando una decisión directa (Vender / Conservar / Tirar) sobre un objeto AJENO
// es rechazada por el backend con 403 ("No tienes permisos sobre este objeto"),
// se ofrece enviar por correo al DUEÑO una invitación para que decida a
// distancia. El markup del modal vive en components/ModalNotificarDueno.astro;
// acá solo la lógica (disciplina de modularidad del proyecto).
//
// Endpoint: POST /api/usuarios/notificar-dueno/   { objeto_id }
// Auth centralizada: getAuthHeaders() (JWT + X-Estok-Id). NUNCA se arma a mano.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { showToast } from './toast';

/** Mensaje EXACTO con el que el backend rechaza una decisión sobre objeto ajeno. */
export const MENSAJE_SIN_PERMISOS = 'No tienes permisos sobre este objeto.';

/** True si el error corresponde al 403 de objeto ajeno (dispara el puente). */
export function esErrorPermisoAjeno(mensaje: string): boolean {
  return (mensaje || '')
    .toLowerCase()
    .includes('no tienes permisos sobre este objeto');
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

let objetoPendienteId: string | null = null;
let enviando = false;

function cerrar(): void {
  el('modalNotificarDueno')?.classList.add('hidden');
  objetoPendienteId = null;
}

/** Abre el modal de confirmación para invitar por email al dueño del objeto. */
export function ofrecerNotificarDueno(objetoId: string): void {
  objetoPendienteId = objetoId;
  el('modalNotificarDueno')?.classList.remove('hidden');
}

/** Confirma y despacha la invitación por email (POST asíncrono). */
async function confirmar(): Promise<void> {
  if (!objetoPendienteId || enviando) return;
  enviando = true;
  const boton = el<HTMLButtonElement>('btnConfirmarNotificarDueno');
  if (boton) boton.disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/usuarios/notificar-dueno/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ objeto_id: objetoPendienteId }),
    });

    if (res.ok) {
      showToast('Invitación despachada al correo del propietario', 'success');
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(
        `❌ ${data.error || data.detail || 'No se pudo enviar la invitación.'}`,
        'error',
      );
    }
  } catch {
    showToast('❌ Error de conexión al enviar la invitación.', 'error');
  } finally {
    enviando = false;
    if (boton) boton.disabled = false;
    cerrar();
  }
}

/** Wiring idempotente de los botones del modal (se llama una vez por página). */
export function iniciarModalNotificarDueno(): void {
  const modal = el('modalNotificarDueno');
  if (!modal || modal.dataset.activo === 'true') return;
  modal.dataset.activo = 'true';

  el('btnConfirmarNotificarDueno')?.addEventListener('click', () => void confirmar());
  el('btnCancelarNotificarDueno')?.addEventListener('click', cerrar);
  el('cerrarModalNotificarDuenoBtn')?.addEventListener('click', cerrar);
}
