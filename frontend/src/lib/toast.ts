// =============================================================================
// NOTIFICACIONES (TOAST) - ÚNICO punto de invocación de las páginas de Objetos
// -----------------------------------------------------------------------------
// El toast global vive en layouts/BaseLayout.astro (window.showToast). Este
// módulo es el ÚNICO lugar donde la edición de objetos lo invoca: si el layout
// todavía no cargó, cae a un toast propio con los mismos estilos. No duplicar el
// fallback en las páginas ni en los módulos de comportamiento.
// =============================================================================

import { contenedorToastFijo, mostrarToastFijo } from './toastFijo';

export type TipoToast = 'success' | 'error' | 'info' | 'warning';

/**
 * Muestra una notificación efímera (delega en el toast global del layout).
 *
 * El fallback también usa el contenedor FIJO compartido: `position: fixed`,
 * `z-index: 9999` y `pointer-events: none` inline. Mostrar u ocultar la alerta
 * no altera el layout ni desplaza el viewport.
 */
export function showToast(message: string, type: TipoToast = 'success'): void {
  const globalFn = (window as any).showToast;
  if (typeof globalFn === 'function') {
    globalFn(message, type);
    return;
  }

  // Fallback si BaseLayout no cargó (no debería ocurrir).
  const cont = contenedorToastFijo('formToast', 'superior-derecha');
  cont.replaceChildren();
  const colorFondo =
    type === 'error' ? 'bg-red-600' : type === 'warning' ? 'bg-amber-500' : 'bg-green-600';
  mostrarToastFijo(cont, message, {
    claseMensaje: `px-6 py-3 rounded-lg shadow-lg text-white font-medium text-sm ${colorFondo}`,
    duracionMs: 4000,
  });
}

