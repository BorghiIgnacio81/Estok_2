// =============================================================================
// ADMIN GLOBAL · COLUMNA «PLAN DE SUSCRIPCIÓN» DE LA TABLA DE USUARIOS
//
// La tabla de usuarios (lib/godMode.ts) muestra un combobox por fila que cambia
// el plan EN CALIENTE contra
// POST /api/usuarios/{id}/cambiar_plan/ → `services/suscripcion.aplicar_plan_usuario()`
// (única fuente de verdad: alinea es_premium, limite_objetos y publicidad).
//
// La lista de planes vive en lib/adminGlobal/planes.ts (espejo de
// `services/suscripcion.PLANES_ETIQUETAS`): no se hardcodea acá.
// =============================================================================

import { apiPost } from '../api';
import { etiquetaPlan, opcionesPlanHtml } from './planes';

/** Fila mínima del endpoint global de usuarios que usa esta columna. */
export interface UsuarioConPlan {
  id: string;
  username?: string;
  display_name?: string;
  plan_suscripcion?: string;
  es_premium?: boolean;
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Celda `<td>` lista para la columna «Plan de Suscripción». */
export function celdaPlanHtml(
  usuario: UsuarioConPlan,
  display: string,
): string {
  const planActual = String(usuario.plan_suscripcion || 'free').toLowerCase();
  const premium = Boolean(usuario.es_premium);
  return `<div class="flex flex-col gap-0.5">
      <select data-god-plan-select data-uid="${esc(usuario.id)}"
        data-user="${esc(display)}" data-plan-previo="${esc(planActual)}"
        class="text-[11px] px-1.5 py-1 border border-gray-300 rounded-md bg-white text-gray-700 max-w-[150px]"
        title="Cambiar el plan de suscripción">
        ${opcionesPlanHtml(planActual)}
      </select>
      <span class="text-[10px] ${premium ? 'text-emerald-600' : 'text-gray-400'}">
        ${premium ? 'Premium · sin publicidad' : 'Con publicidad'}
      </span>
    </div>`;
}

/**
 * Aplica el plan elegido en el combobox.
 *
 * Devuelve el mensaje de éxito ya formateado o lanza el error del backend. Si
 * falla, el `<select>` vuelve al valor anterior para no mentirle al Admin.
 */
export async function cambiarPlanUsuario(
  select: HTMLSelectElement,
  recargar: () => Promise<void>,
): Promise<string> {
  const uid = select.dataset.uid || '';
  const anterior = select.dataset.planPrevio || 'free';
  const display = select.dataset.user || 'usuario';
  const plan = select.value;

  select.disabled = true;
  try {
    await apiPost(`/usuarios/${uid}/cambiar_plan/`, { plan });
    await recargar();
    return `✅ Plan de ${display} actualizado a «${etiquetaPlan(plan)}».`;
  } catch (err) {
    select.value = anterior;
    select.disabled = false;
    throw err;
  }
}
