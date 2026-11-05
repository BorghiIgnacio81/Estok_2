// =============================================================================
// ADMIN GLOBAL · PESTAÑA «FEATURE FLAGS»
//
// Prende/apaga funcionalidades en caliente desde el panel centralizado, sin
// abrir /admin/inventario/featureflag/ en otra pestaña.
//
// Contrato backend (inventario/api/viewsets/admin_global.py):
//   GET   /api/admin/feature-flags/  → { results: [{ clave, nombre, descripcion,
//                                       activo_global, modo_promocional }] }
//   PATCH /api/admin/feature-flags/  → { clave, activo_global?, modo_promocional? }
//
// La evaluación real del flag vive en el backend
// (services/feature_flags.py): acá sólo se dibujan los interruptores.
// =============================================================================

import { apiGet, apiPatch } from '../api';

interface FeatureFlag {
  clave: string;
  nombre: string;
  descripcion: string;
  activo_global: boolean;
  modo_promocional: boolean;
}

let contenedor: HTMLElement | null = null;
let cargando = false;

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function interruptorHtml(
  flag: FeatureFlag,
  campo: 'activo_global' | 'modo_promocional',
  etiqueta: string,
  ayuda: string,
): string {
  const activo = Boolean(flag[campo]);
  return `
    <label class="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        data-god-flag="${esc(flag.clave)}"
        data-god-flag-campo="${campo}"
        ${activo ? 'checked' : ''}
        class="mt-0.5 h-4 w-4 accent-red-600 cursor-pointer"
      />
      <span>
        <span class="block text-xs font-semibold text-gray-800">${esc(etiqueta)}</span>
        <span class="block text-[11px] text-gray-500">${esc(ayuda)}</span>
      </span>
    </label>`;
}

function tarjetaHtml(flag: FeatureFlag): string {
  const estado = flag.activo_global
    ? flag.modo_promocional
      ? '<span class="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold">Activa para todos</span>'
      : '<span class="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-semibold">Sólo planes premium</span>'
    : '<span class="px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-600 text-[11px] font-semibold">Apagada</span>';

  return `
    <div class="rounded-lg border border-gray-200 bg-white p-3">
      <div class="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-gray-900">${esc(flag.nombre)}</p>
          <p class="text-[11px] text-gray-400"><code>${esc(flag.clave)}</code></p>
        </div>
        ${estado}
      </div>
      <p class="text-xs text-gray-600 mb-3">${esc(flag.descripcion || '')}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        ${interruptorHtml(flag, 'activo_global', 'Interruptor maestro', 'Apagado = nadie puede usarla')}
        ${interruptorHtml(flag, 'modo_promocional', 'Modo promocional', 'Encendido = gratis para todos')}
      </div>
    </div>`;
}

function mostrarEstado(texto: string, error = false): void {
  const aviso = document.getElementById('godFlagsAviso');
  if (!aviso) return;
  aviso.textContent = texto;
  aviso.className = error
    ? 'mb-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2'
    : 'mb-3 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2';
  window.setTimeout(() => {
    aviso.textContent = '';
    aviso.className = 'hidden';
  }, 4000);
}

/** Dibuja la lista de Feature Flags (GET). */
export async function cargarFeatureFlags(): Promise<void> {
  if (!contenedor || cargando) return;
  cargando = true;
  contenedor.innerHTML =
    '<p class="text-sm text-gray-400">Cargando Feature Flags...</p>';
  try {
    const data = await apiGet<{ results?: FeatureFlag[] }>('/admin/feature-flags/');
    const flags = Array.isArray(data?.results) ? data.results : [];
    contenedor.innerHTML =
      flags.length > 0
        ? `<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">${flags.map(tarjetaHtml).join('')}</div>`
        : '<p class="text-sm text-gray-400">No hay funcionalidades configuradas.</p>';
  } catch (err: any) {
    contenedor.innerHTML = `<p class="text-sm text-red-600">${esc(
      err?.error || 'Error al cargar los Feature Flags.',
    )}</p>`;
  } finally {
    cargando = false;
  }
}

async function alternarFlag(casilla: HTMLInputElement): Promise<void> {
  const clave = casilla.dataset.godFlag || '';
  const campo = casilla.dataset.godFlagCampo as
    | 'activo_global'
    | 'modo_promocional'
    | undefined;
  if (!clave || !campo) return;

  casilla.disabled = true;
  try {
    await apiPatch(`/admin/feature-flags/`, { clave, [campo]: casilla.checked });
    mostrarEstado('✅ Feature Flag actualizado.');
    await cargarFeatureFlags();
  } catch (err: any) {
    casilla.checked = !casilla.checked;
    casilla.disabled = false;
    mostrarEstado(err?.error || 'Error al actualizar el Feature Flag.', true);
  }
}

/** Cablea la pestaña (delegación de eventos: sobrevive a los re-render). */
export function initFeatureFlagsTab(): void {
  contenedor = document.getElementById('godFlagsLista');
  if (!contenedor || contenedor.dataset.godFlagBound === '1') return;
  contenedor.dataset.godFlagBound = '1';

  contenedor.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    const casilla = target?.closest<HTMLInputElement>('[data-god-flag]');
    if (casilla) void alternarFlag(casilla);
  });
}
