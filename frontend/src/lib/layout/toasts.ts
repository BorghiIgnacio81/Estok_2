// =============================================================================
// TOASTS GLOBALES DEL LAYOUT
// Extraído de layouts/BaseLayout.astro (Fase A · refactor preventivo).
// Expone window.showToast / showSuccess / showError / showInfo / showWarning.
// =============================================================================


import { contenedorToastFijo } from '../toastFijo';


let toastCount = 0;


  const TOAST_ICONS: Record<string, string> = {
    success: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
    error: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
    info: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
    warning: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>`,
  };

  const TOAST_COLORS: Record<string, string> = {
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-blue-600 text-white',
    warning: 'bg-amber-500 text-white',
  };

  export function showToast(message: string, type: string = 'info', duration: number = 4000): string {
    // Contenedor FIJO (in-line position:fixed / z-index 9999 / pointer-events
    // none): la alerta no participa del flujo ni altera el layout del editor.
    const toastContainer = contenedorToastFijo('toastContainer', 'superior-derecha');
    const id = `toast-${++toastCount}`;
    const toast = document.createElement('div');
    toast.id = id;
    toast.setAttribute('role', 'status');
    // `pointer-events: none`: la alerta NUNCA intercepta toques del lienzo.
    // Sólo el botón de cierre recupera los eventos (área mínima).
    toast.style.pointerEvents = 'none';
    toast.className = `pointer-events-none flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg ${TOAST_COLORS[type] || TOAST_COLORS.info} transform translate-x-full opacity-0 transition-all duration-300 ease-out max-w-sm`;
    toast.innerHTML = `
      <span class="flex-shrink-0">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
      <span class="flex-1 text-sm font-medium">${message}</span>
      <button type="button" data-toast-cerrar class="pointer-events-auto flex-shrink-0 opacity-70 hover:opacity-100">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    `;
    // Cierre por listener (sin `onclick` inline ni foco: no mueve el viewport).
    toast
      .querySelector<HTMLButtonElement>('[data-toast-cerrar]')
      ?.addEventListener('click', () => toast.remove());
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-x-full', 'opacity-0');
    });

    if (duration > 0) {
      setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }

    return id;
  }

  // Exponer globalmente
  (window as any).showToast = showToast;
  (window as any).showSuccess = (msg: string) => showToast(msg, 'success');
  (window as any).showError = (msg: string) => showToast(msg, 'error');
  (window as any).showInfo = (msg: string) => showToast(msg, 'info');
  (window as any).showWarning = (msg: string) => showToast(msg, 'warning');
