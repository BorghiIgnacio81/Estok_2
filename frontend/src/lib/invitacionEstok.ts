// =============================================================================
// ESTOK DE DESTINO DEL MODAL "INVITAR MIEMBROS" (cuentas multi-tenant)
// -----------------------------------------------------------------------------
// El código de invitación pertenece SIEMPRE a un Estok concreto, así que el
// modal necesita saber en cuál crearlo:
//
//   - 1 inquilinato → el combobox NO se muestra y su ID viaja automático.
//   - 2 o más      → se inyecta arriba de todo el combobox "Seleccionar Estok
//                    de destino", preseleccionado en el Estok activo.
//
// La lista NO se vuelve a pedir: se lee del estado global de sesión
// (getCachedUser().estoks), el MISMO origen que alimenta el dropdown "Mis
// Estoks" del Navbar, que BaseLayout refresca en cada carga contra
// /api/usuarios/me/. Así no hay doble request ni peso extra en el bundle.
//
// Módulo hermano de invitacionModal.ts: acá vive solo la lógica del selector
// (datos + HTML) para que el modal se mantenga bajo el límite de líneas.
// =============================================================================

import { getCachedUser } from '../services/auth';
import type { EstokInfo } from '../services/auth';

/** Escapa texto para inyectarlo en HTML (los nombres de Estok son editables). */
export function escaparHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Estoks (inquilinatos) a los que tiene acceso la cuenta logueada. */
export function estoksDelUsuario(): EstokInfo[] {
  return getCachedUser()?.estoks ?? [];
}

/** ID del Estok preseleccionado: el activo del Navbar cuando está en la lista. */
export function estokPreseleccionado(estoks: EstokInfo[], activo: string | null): string {
  const activoEsValido =
    Boolean(activo) && (estoks.length === 0 || estoks.some((e) => e.id === activo));
  if (activoEsValido) return activo as string;
  return estoks[0]?.id ?? activo ?? '';
}

/**
 * Combobox de Estok de destino. Devuelve cadena vacía con un solo inquilinato
 * (el ID se inyecta solo en el payload) para que la tarjeta no cambie.
 */
export function bloqueEstokHtml(estoks: EstokInfo[], seleccionado: string): string {
  if (estoks.length < 2) return '';

  const opciones = estoks
    .map(
      (e) =>
        `<option value="${escaparHtml(e.id)}"${e.id === seleccionado ? ' selected' : ''}>${escaparHtml(e.nombre)}</option>`
    )
    .join('');

  return `
        <!-- Estok de destino: solo para cuentas con 2 o más inquilinatos -->
        <div>
          <label for="invEstok" class="block text-sm font-medium text-gray-700 mb-1">Seleccionar Estok de destino</label>
          <select id="invEstok"
            class="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-base cursor-pointer">
            ${opciones}
          </select>
          <p class="mt-1.5 text-xs text-gray-500">El código quedará vinculado al Estok que elijas acá</p>
        </div>`;
}
