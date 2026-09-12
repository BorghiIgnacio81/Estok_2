// =============================================================================
// UTILIDADES DE MODAL COMPARTIDAS (overlay + formularios de las tarjetas)
// -----------------------------------------------------------------------------
// Toolkit reutilizado por los micro-modales Mover y Editar de las tarjetas de
// contenedor. Extraído de cajaOperativa.ts para mantener cada archivo por debajo
// de las 400 líneas (disciplina de modularidad). No conoce el dominio: solo crea
// el overlay, muestra errores, arma botones/campos y gestiona el submit.
// =============================================================================

import { escapeHtml } from './mapaJerarquico';
import type { ApiError } from './api';

const ID_OVERLAY = 'cajaOperativaOverlay';

export const CLASE_CONTROL = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-100 disabled:text-gray-400';

function alPresionarEscape(evento: KeyboardEvent): void {
  if (evento.key === 'Escape') cerrarOverlay();
}

export function cerrarOverlay(): void {
  document.getElementById(ID_OVERLAY)?.remove();
  document.removeEventListener('keydown', alPresionarEscape);
}

/** Crea el overlay + el <form> y devuelve ambos nodos listos para hidratar. */
export function abrirOverlay(titulo: string): { overlay: HTMLElement; form: HTMLFormElement } {
  cerrarOverlay();

  const overlay = document.createElement('div');
  overlay.id = ID_OVERLAY;
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50';
  overlay.innerHTML =
    '<div class="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">'
    + '<div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">'
    + '<h3 class="text-sm font-bold text-gray-900">' + escapeHtml(titulo) + '</h3>'
    + '<button type="button" class="js-cerrar-overlay text-gray-400 hover:text-gray-700 cursor-pointer" aria-label="Cerrar">✕</button>'
    + '</div>'
    + '<p class="js-overlay-error hidden mx-4 mt-3 text-xs font-medium text-red-600"></p>'
    + '<form class="js-overlay-form p-4 pt-3 space-y-3" novalidate></form>'
    + '</div>';

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (evento) => {
    const target = evento.target as HTMLElement | null;
    if (evento.target === overlay || (target && target.closest && target.closest('.js-cerrar-overlay'))) {
      cerrarOverlay();
    }
  });
  document.addEventListener('keydown', alPresionarEscape);

  return {
    overlay,
    form: overlay.querySelector('.js-overlay-form') as HTMLFormElement,
  };
}

function mostrarErrorOverlay(overlay: HTMLElement, mensaje: string): void {
  const el = overlay.querySelector('.js-overlay-error') as HTMLElement | null;
  if (!el) return;
  el.textContent = mensaje;
  el.classList.remove('hidden');
}

function limpiarErrorOverlay(overlay: HTMLElement): void {
  const el = overlay.querySelector('.js-overlay-error') as HTMLElement | null;
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

export function botonesModal(textoGuardar: string): string {
  return '<div class="flex items-center justify-end gap-2 pt-1">'
    + '<button type="button" class="js-cerrar-overlay px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 cursor-pointer">Cancelar</button>'
    + '<button type="submit" class="js-guardar px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 cursor-pointer">'
    + escapeHtml(textoGuardar) + '</button>'
    + '</div>';
}

export function campoTexto(
  label: string,
  nombre: string,
  opts: { value?: string; required?: boolean; placeholder?: string } = {},
): string {
  return '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">' + escapeHtml(label) + '</span>'
    + '<input type="text" name="' + nombre + '" value="' + escapeHtml(opts.value || '') + '"'
    + (opts.required ? ' required' : '')
    + (opts.placeholder ? ' placeholder="' + escapeHtml(opts.placeholder) + '"' : '')
    + ' class="' + CLASE_CONTROL + '" /></label>';
}

/** Input numérico de dimensiones físicas (cm). */
export function campoNumero(label: string, nombre: string, valor: string): string {
  return '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">' + escapeHtml(label) + '</span>'
    + '<input type="number" step="0.01" min="0" name="' + nombre + '" value="' + escapeHtml(valor) + '" class="' + CLASE_CONTROL + '" /></label>';
}

/** Input de archivo con miniatura de la fotografía actual del contenedor. */
export function campoFoto(fotoActual: string): string {
  const miniatura = fotoActual
    ? '<img src="' + escapeHtml(fotoActual) + '" alt="Foto actual" class="h-20 w-20 rounded-xl object-cover border border-gray-200 bg-slate-50" />'
    : '<span class="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-slate-50 text-[10px] text-gray-400 text-center px-1">Sin foto</span>';
  return '<label class="block"><span class="block text-xs font-semibold text-gray-600 mb-1">Fotografía física</span>'
    + '<div class="flex items-center gap-3">'
    + '<span class="js-foto-preview shrink-0">' + miniatura + '</span>'
    + '<span class="flex-1 min-w-0">'
    + '<input type="file" name="foto" accept="image/*" class="js-foto-input block w-full text-xs text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer" />'
    + '<span class="block text-[10px] text-gray-400 mt-1">Sube o reemplaza la foto física del contenedor (JPG/PNG).</span>'
    + '</span></div></label>';
}

/** Enlaza el submit con bloqueo del botón, feedback de error y cierre al éxito. */
export function enlazarGuardado(
  overlay: HTMLElement,
  form: HTMLFormElement,
  guardar: () => Promise<void>,
): void {
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    limpiarErrorOverlay(overlay);
    const btn = form.querySelector('.js-guardar') as HTMLButtonElement | null;
    const original = btn ? btn.textContent || 'Guardar' : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Guardando…';
    }
    guardar().catch((err: unknown) => {
      const apiErr = err as ApiError;
      const mensaje = apiErr && apiErr.error ? apiErr.error : 'No se pudo guardar. Reintentá.';
      mostrarErrorOverlay(overlay, '⚠️ ' + mensaje);
      if (btn) {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });
}

