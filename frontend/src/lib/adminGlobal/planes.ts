// =============================================================================
// ADMIN GLOBAL · CATÁLOGO DE PLANES DE SUSCRIPCIÓN
//
// Espejo del backend (`services/suscripcion.PLANES_ETIQUETAS` → GET
// /api/admin/planes/). El backend es la fuente de verdad: al abrir el panel se
// refresca por API y estas constantes sólo actúan de respaldo para que la tabla
// de usuarios pinte el combobox al instante, sin esperar la petición.
//
// ÚNICO lugar del frontend donde vive la lista de planes: la usan el combobox
// de la tabla de usuarios (lib/godMode.ts) y el selector del panel de permisos
// (lib/adminGlobal/permisosBotones.ts). No duplicar.
// =============================================================================

import { apiGet } from '../api';
// ESCAPADO HTML: helper ÚNICO del frontend (lib/escapeHtml).
import { escapeHtml as esc } from '../escapeHtml';

export interface PlanSuscripcion {
  valor: string;
  etiqueta: string;
}

export const PLANES_RESPALDO: PlanSuscripcion[] = [
  { valor: 'free', etiqueta: 'Gratuito (Free)' },
  { valor: 'pro', etiqueta: 'Pro Individual' },
  { valor: 'familiar', etiqueta: 'Plan Familiar' },
  { valor: 'empresas', etiqueta: 'Plan Empresas' },
  { valor: 'personalizado', etiqueta: 'Personalizado' },
];

let catalogo: PlanSuscripcion[] = PLANES_RESPALDO;

/** Planes disponibles ahora mismo (caché refrescada desde el backend). */
export function planesDisponibles(): PlanSuscripcion[] {
  return catalogo;
}

/** Etiqueta legible de un plan (el valor crudo si no está en el catálogo). */
export function etiquetaPlan(valor: string | null | undefined): string {
  const buscado = String(valor || 'free').toLowerCase();
  return catalogo.find((p) => p.valor === buscado)?.etiqueta || buscado;
}

/** Refresca el catálogo con `GET /api/admin/planes/`. Nunca rompe la UI. */
export async function cargarPlanes(): Promise<PlanSuscripcion[]> {
  try {
    const data = await apiGet<{ planes?: PlanSuscripcion[] }>('/admin/planes/');
    if (Array.isArray(data?.planes) && data.planes.length > 0) {
      catalogo = data.planes.map((p) => ({
        valor: String(p.valor),
        etiqueta: String(p.etiqueta || p.valor),
      }));
    }
  } catch {
    // Sin conexión / 403: se mantiene el respaldo local (la UI sigue usable).
  }
  return catalogo;
}

/** `<option>` de un `<select>` de planes, marcando el plan actual. */
export function opcionesPlanHtml(planActual: string | null | undefined): string {
  const actual = String(planActual || 'free').toLowerCase();
  return catalogo
    .map(
      (p) =>
        `<option value="${esc(p.valor)}"${p.valor === actual ? ' selected' : ''}>${esc(p.etiqueta)}</option>`,
    )
    .join('');
}
