// =============================================================================
// ADMIN GLOBAL · PESTAÑAS INTERNAS DEL PANEL
//
// El panel se abre con el ÚNICO botón «Administración Global» del navbar
// (solo ygumy44). Sus secciones son pestañas INTERNAS: se muestran/ocultan en el
// mismo documento, sin abrir pestañas ni ventanas del navegador hacia /admin/.
//
// Contrato del DOM (components/dashboard/AdminGlobalPanel.astro):
//   - Botón:  [data-god-tab="<id>"]
//   - Panel:  [data-god-panel="<id>"]
//
// Cada pestaña puede registrar un cargador (`alActivar`) que se ejecuta al
// mostrarla: así la matriz de permisos y los Feature Flags se piden sólo cuando
// el Admin los mira, no al cargar el Dashboard.
// =============================================================================

type CargadorTab = () => void | Promise<void>;

const cargadores: Record<string, CargadorTab> = {};
let inicializado = false;

const CLASE_ACTIVA =
  'px-3 py-2 text-sm font-semibold rounded-t-lg bg-white text-red-800 border-b-2 border-red-600';
const CLASE_INACTIVA =
  'px-3 py-2 text-sm font-medium rounded-t-lg text-gray-600 hover:text-red-700 hover:bg-red-50 border-b-2 border-transparent';

function botones(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-god-tab]'));
}

function paneles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-god-panel]'));
}

/** Registra el cargador de una pestaña (se llama cada vez que se activa). */
export function registrarCargadorTab(id: string, cargador: CargadorTab): void {
  cargadores[id] = cargador;
}

/** Muestra la pestaña `id` y oculta el resto. */
export function activarTabAdminGlobal(id: string): void {
  let encontrada = false;

  paneles().forEach((panel) => {
    const esLaBuscada = panel.dataset.godPanel === id;
    panel.classList.toggle('hidden', !esLaBuscada);
    if (esLaBuscada) encontrada = true;
  });

  if (!encontrada) return;

  botones().forEach((btn) => {
    const activo = btn.dataset.godTab === id;
    btn.className = activo ? CLASE_ACTIVA : CLASE_INACTIVA;
    btn.setAttribute('aria-selected', activo ? 'true' : 'false');
  });

  const cargador = cargadores[id];
  if (cargador) {
    try {
      void cargador();
    } catch {
      // Un fallo al cargar una pestaña nunca debe romper el resto del panel.
    }
  }
}

/** Cablea los botones de pestaña. Idempotente (se puede llamar varias veces). */
export function initAdminGlobalTabs(): void {
  if (inicializado) return;
  if (botones().length === 0) return;
  inicializado = true;

  botones().forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const id = btn.dataset.godTab;
      if (id) activarTabAdminGlobal(id);
    });
  });

  activarTabAdminGlobal('usuarios');
}
