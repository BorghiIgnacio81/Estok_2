// =============================================================================
// NOTIFICACIONES (TOAST) - ÚNICO punto de invocación de las páginas de Objetos
// -----------------------------------------------------------------------------
// El toast global vive en layouts/BaseLayout.astro (window.showToast). Este
// módulo es el ÚNICO lugar donde la edición de objetos lo invoca: si el layout
// todavía no cargó, cae a un toast propio con los mismos estilos. No duplicar el
// fallback en las páginas ni en los módulos de comportamiento.
// =============================================================================

export type TipoToast = 'success' | 'error' | 'info';

/** Muestra una notificación efímera (delega en el toast global del layout). */
export function showToast(message: string, type: TipoToast = 'success'): void {
  const globalFn = (window as any).showToast;
  if (typeof globalFn === 'function') {
    globalFn(message, type);
    return;
  }

  // Fallback si BaseLayout no cargó (no debería ocurrir)
  const previous = document.getElementById('formToast');
  if (previous) previous.remove();

  const toast = document.createElement('div');
  toast.id = 'formToast';
  toast.className = `fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg text-white font-medium text-sm transition-all duration-300 ${
    type === 'error' ? 'bg-red-600' : 'bg-green-600'
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
