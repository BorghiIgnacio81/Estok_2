// =============================================================================
// NAVBAR · NAVEGACIÓN DE ESCRITORIO (auth + Estok activo)
// Extraído de layouts/BaseLayout.astro (Fase A · refactor preventivo).
// =============================================================================
import { getCachedUser, getEstokActivoId, cacheUser } from '../../services/auth';
import { abrirModalInvitacion } from '../invitacionModal';
import { getRoleBadgeClass } from './roles';
import { updateGodModeUI } from './godModeNav';


  // ===========================================================================
  // CONTROL DE AUTENTICACIÓN EN LA NAVEGACIÓN
  // ===========================================================================

  const authSection = document.getElementById('authSection')!;
  const loginLink = document.getElementById('loginLink')!;
  const userName = document.getElementById('userName')!;
  const logoutBtn = document.getElementById('logoutBtn')!;

  // Elementos del Estok activo
  const estokSection = document.getElementById('estokSection')!;
  const estokNombre = document.getElementById('estokNombre')!;
  const estokRoleBadge = document.getElementById('estokRoleBadge')!;
  const invitarBtn = document.getElementById('invitarBtn')!;

  // Elementos del dropdown de Estoks
  const estokDropdownBtn = document.getElementById('estokDropdownBtn')!;
  const estokDropdownMenu = document.getElementById('estokDropdownMenu')!;
  const estokDropdownList = document.getElementById('estokDropdownList')!;

  // ===========================================================================
  // LISTENER DELEGADO DE CAMBIO DE ESTOK (desktop) — RESTAURADO
  // Se vincula UNA sola vez sobre el contenedor de opciones, por lo que el
  // escuchador no se pierde aunque la lista se re-renderice al reabrir el
  // dropdown (patrón resistente a la pérdida de listeners por innerHTML).
  // Al seleccionar un Estok: persiste el UUID del nuevo tenant en localStorage
  // (clave 'estok_activo_id' vía cambiarEstokActivo()) y recarga la página
  // para refrescar las estadísticas del Dashboard con el Estok elegido.
  // ===========================================================================
  estokDropdownList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.estok-dropdown-item') as HTMLElement | null;
    if (!btn) return;
    const estokId = btn.dataset.estokId;
    if (!estokId) return;
    if (estokId === getEstokActivoId()) {
      cerrarDropdown();
      return;
    }
    void (async () => {
      try {
        const { cambiarEstokActivo } = await import('../../services/auth');
        await cambiarEstokActivo(estokId);
        cerrarDropdown();
        (window as any).showSuccess?.('✅ Estok cambiado');
        // Recargar la página para refrescar todos los datos del nuevo Estok
        window.location.reload();
      } catch (err: any) {
        (window as any).showError?.(err?.error || 'Error al cambiar de Estok');
      }
    })();
  });

  function renderEstokDropdown(estoks: any[], activoId: string | null) {
    // Contrato de datos (BACKEND /api/usuarios/me/ → user.estoks[]):
    //   { id: string, nombre: string, role: string | null, role_id: string | null }
    // Se itera la lista COMPLETA de inquilinatos del usuario (no solo el activo).
    estokDropdownList.innerHTML = estoks.map(e => {
      const esActivo = e.id === activoId;
      return `
        <button
          data-estok-id="${e.id}"
          title="Cambiar a ${e.nombre}"
          class="estok-dropdown-item flex items-center gap-3 w-full px-3 py-2.5 text-sm hover:bg-blue-50 transition-base text-left ${esActivo ? 'bg-blue-50 font-semibold text-blue-800' : 'text-gray-700'}"
        >
          <div class="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-sm flex-shrink-0">
            📋
          </div>
          <div class="flex-1 min-w-0">
            <div class="truncate ${esActivo ? 'font-semibold' : ''}">${e.nombre}</div>
            <span class="inline-block mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeClass(e.role)}">
              ${e.role || 'Sin rol'}
            </span>
          </div>
          ${esActivo ? '<svg class="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>' : ''}
        </button>
      `;
    }).join('');

  }

  async function abrirDropdown() {
    // Refrescar datos del usuario desde el backend para tener Estoks actualizados
    try {
      const { fetchCurrentUser } = await import('../../services/auth');
      const userFresco = await fetchCurrentUser();
      if (userFresco?.estoks) {
        // Sincronizar el usuario cacheado con la lista completa del backend:
        // el Navbar (botón + badge) y el dropdown muestran SIEMPRE los mismos
        // inquilinatos, incluso los agregados después del login.
        cacheUser(userFresco);
        const estokActivoId = getEstokActivoId();
        renderEstokDropdown(userFresco.estoks, estokActivoId);
      }
    } catch {
      // Fallback: usar datos cacheados
      const user = getCachedUser();
      const estokActivoId = getEstokActivoId();
      if (user?.estoks) {
        renderEstokDropdown(user.estoks, estokActivoId);
      }
    }
    estokDropdownMenu.classList.remove('hidden');
  }

  function cerrarDropdown() {
    estokDropdownMenu.classList.add('hidden');
  }

  function toggleDropdown() {
    if (estokDropdownMenu.classList.contains('hidden')) {
      abrirDropdown();
    } else {
      cerrarDropdown();
    }
  }

  // Cerrar dropdown al hacer clic fuera
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('#estokDropdown')) {
      cerrarDropdown();
    }
  });

  // Toggle dropdown al hacer clic en el botón
  estokDropdownBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  function updateEstokUI() {
    const user = getCachedUser();
    const estokActivoId = getEstokActivoId();

    if (!user || !estokActivoId) {
      estokSection.classList.add('hidden');
      return;
    }

    const estokActivo = user.estoks?.find((e: any) => e.id === estokActivoId);

    if (estokActivo) {
      estokSection.classList.remove('hidden');
      estokNombre.textContent = estokActivo.nombre;
      estokRoleBadge.textContent = estokActivo.role || '';

      // Mostrar botón Invitar solo si es Admin
      if (estokActivo.role === 'Admin') {
        invitarBtn.classList.remove('hidden');
      } else {
        invitarBtn.classList.add('hidden');
      }
    } else {
      estokSection.classList.add('hidden');
    }
  }

  export function updateAuthUI() {
    const token = localStorage.getItem('estok_access_token');
    const userData = localStorage.getItem('estok_user');

    if (token && userData) {
      try {
        const user = JSON.parse(userData);
        authSection.classList.remove('hidden');
        loginLink.classList.add('hidden');
        userName.textContent = user.first_name
          ? `${user.first_name} ${user.last_name || ''}`
          : user.username;
        updateEstokUI();
      } catch {
        authSection.classList.add('hidden');
        loginLink.classList.remove('hidden');
        estokSection.classList.add('hidden');
      }
    } else {
      authSection.classList.add('hidden');
      loginLink.classList.remove('hidden');
      estokSection.classList.add('hidden');
    }
    updateGodModeUI();
  }

  logoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('estok_access_token');
    localStorage.removeItem('estok_refresh_token');
    localStorage.removeItem('estok_user');
    window.location.href = '/login';
  });

  // Modal de invitación (misma tarjeta única que comparte el navbar móvil)
  invitarBtn?.addEventListener('click', abrirModalInvitacion);
