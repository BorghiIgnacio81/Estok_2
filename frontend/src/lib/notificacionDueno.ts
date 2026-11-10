// =============================================================================
// NOTIFICACIÓN AL PROPIETARIO (Caso C de la tarjeta de Decisiones)
// -----------------------------------------------------------------------------
// Cuando el objeto pertenece a OTRO usuario del Estok, la tarjeta y la ficha NO
// ofrecen los botones de decisión individual: ofrecen «Avisar al propietario».
// Al confirmar se envía un aviso interno (chat del Estok) con el texto:
//
//     «El usuario <Nombre> te solicita tomar una decisión sobre el objeto
//      "<Nombre Objeto>".»
//
// El mismo modal sigue cubriendo el puente del 403: si el backend rechaza una
// decisión directa sobre un objeto ajeno, se ofrece este aviso en vez de un
// error seco. El markup vive en components/ModalNotificarDueno.astro; acá solo
// la lógica (disciplina de modularidad del proyecto).
//
// Endpoint: POST /api/objetos/{id}/avisar_propietario/
// Auth centralizada: getAuthHeaders() (JWT + X-Estok-Id). NUNCA se arma a mano.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { nombreUsuarioActual } from './decisionesPropiedad';
import { showToast } from './toast';

/**
 * True si el error corresponde al 403 patrimonial (objeto de otro usuario).
 * Cubre los dos textos posibles del backend: el histórico «No tienes permisos
 * sobre este objeto» y el del endpoint de decisión «No tienes permisos para
 * decidir sobre un objeto propiedad de otro usuario».
 */
export function esErrorPermisoAjeno(mensaje: string): boolean {
  return (mensaje || '').toLowerCase().includes('no tienes permisos');
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Objeto sobre el que se está por enviar el aviso (id + nombre para el texto). */
let objetoPendiente: { id: string; nombre: string } | null = null;
let enviando = false;

/** Texto EXACTO del aviso (el backend registra el mismo mensaje en el chat). */
export function textoAvisoPropietario(nombreObjeto: string): string {
  const objeto = (nombreObjeto || '').trim() || 'este objeto';
  return `El usuario ${nombreUsuarioActual()} te solicita tomar una decisión sobre el objeto "${objeto}".`;
}

function cerrar(): void {
  el('modalNotificarDueno')?.classList.add('hidden');
  objetoPendiente = null;
}

/**
 * Abre el modal de confirmación del aviso al propietario.
 *
 * @param objetoId     UUID del objeto ajeno.
 * @param nombreObjeto Nombre legible para el texto del aviso.
 */
export function ofrecerNotificarDueno(objetoId: string, nombreObjeto = ''): void {
  objetoPendiente = { id: objetoId, nombre: nombreObjeto };
  const preview = el('avisoPropietarioTexto');
  if (preview) preview.textContent = textoAvisoPropietario(nombreObjeto);
  el('modalNotificarDueno')?.classList.remove('hidden');
}

/** Confirma y despacha el aviso interno (POST asíncrono). */
async function confirmar(): Promise<void> {
  if (!objetoPendiente || enviando) return;
  enviando = true;
  const boton = el<HTMLButtonElement>('btnConfirmarNotificarDueno');
  if (boton) boton.disabled = true;

  try {
    const res = await fetch(
      `${API_BASE_URL}/objetos/${objetoPendiente.id}/avisar_propietario/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      },
    );

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(`📩 ${data.mensaje || 'Aviso enviado al propietario.'}`, 'success');
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(
        `❌ ${data.error || data.detail || 'No se pudo enviar el aviso.'}`,
        'error',
      );
    }
  } catch {
    showToast('❌ Error de conexión al enviar el aviso.', 'error');
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
  // Clic en el fondo oscuro: cierra sin enviar (mismo patrón que el resto).
  modal.addEventListener('click', (evento) => {
    if (evento.target === modal) cerrar();
  });
}
