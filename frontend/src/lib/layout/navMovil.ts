// =============================================================================
// NAVBAR · NAVEGACIÓN MÓVIL (Estok activo + dropdown + barra mobile)
// Extraído de layouts/BaseLayout.astro (Fase A · refactor preventivo).
// =============================================================================
import { getCachedUser, getEstokActivoId, cacheUser } from '../../services/auth';
import { abrirModalInvitacion } from '../invitacionModal';
import { getRoleBadgeClass } from './roles';


  // ===========================================================================
  // ESTOK UI MÓVIL
  // ===========================================================================
  const estokSectionMobile = document.getElementById('estokSectionMobile')!;
  const estokNombreMobileBtn = document.getElementById('estokNombreMobileBtn')!;
  const estokRoleBadgeMobileBtn = document.getElementById('estokRoleBadgeMobileBtn')!;
  const invitarBtnMobile = document.getElementById('invitarBtnMobile')!;

  // Dropdown mobile
  const estokDropdownBtnMobile = document.getElementById('estokDropdownBtnMobile')!;
  const estokDropdownMenuMobile = document.getElementById('estokDropdownMenuMobile')!;
  const estokDropdownListMobile = document.getElementById('estokDropdownListMobile')!;

  // ===========================================================================
  // LISTENER DELEGADO DE CAMBIO DE ESTOK (mobile) — RESTAURADO
  // Mismo patrón que el desktop: se vincula una sola vez sobre el contenedor,
  // garantizando que el cambio de tenant siga funcionando tras re-renders.
  // ===========================================================================
  estokDropdownListMobile.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.estok-dropdown-item-mobile') as HTMLElement | null;
    if (!btn) return;
    const estokId = btn.dataset.estokId;
    if (!estokId) return;
    if (estokId === getEstokActivoId()) {
      cerrarDropdownMobile();
      return;
    }
    void (async () => {
      try {
        const { cambiarEstokActivo } = await import('../../services/auth');
        await cambiarEstokActivo(estokId);
        cerrarDropdownMobile();
        (window as any).showSuccess?.('✅ Estok cambiado');
        // Recargar la página para refrescar todos los datos del nuevo Estok
        window.location.reload();
      } catch (err: any) {
        (window as any).showError?.(err?.error || 'Error al cambiar de Estok');
      }
    })();
  });

  function renderEstokDropdownMobile(estoks: any[], activoId: string | null) {
    // Contrato de datos (BACKEND /api/usuarios/me/ → user.estoks[]):
    //   { id: string, nombre: string, role: string | null, role_id: string | null }
    // Se itera la lista COMPLETA de inquilinatos del usuario (no solo el activo).
    estokDropdownListMobile.innerHTML = estoks.map(e => {
      const esActivo = e.id === activoId;
      return `
        <button
          data-estok-id="${e.id}"
          title="Cambiar a ${e.nombre}"
          class="estok-dropdown-item-mobile flex items-center gap-3 w-full px-3 py-2.5 text-sm hover:bg-blue-50 transition-base text-left ${esActivo ? 'bg-blue-50 font-semibold text-blue-800' : 'text-gray-700'}"
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

  async function abrirDropdownMobile() {
    try {
      const { fetchCurrentUser } = await import('../../services/auth');
      const userFresco = await fetchCurrentUser();
      if (userFresco?.estoks) {
        // Sincronizar el usuario cacheado (misma regla que el dropdown desktop)
        cacheUser(userFresco);
        const estokActivoId = getEstokActivoId();
        renderEstokDropdownMobile(userFresco.estoks, estokActivoId);
      }
    } catch {
      const user = getCachedUser();
      const estokActivoId = getEstokActivoId();
      if (user?.estoks) {
        renderEstokDropdownMobile(user.estoks, estokActivoId);
      }
    }
    estokDropdownMenuMobile.classList.remove('hidden');
  }

  function cerrarDropdownMobile() {
    estokDropdownMenuMobile.classList.add('hidden');
  }

  function toggleDropdownMobile() {
    if (estokDropdownMenuMobile.classList.contains('hidden')) {
      abrirDropdownMobile();
    } else {
      cerrarDropdownMobile();
    }
  }

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('#estokDropdownMobile')) {
      cerrarDropdownMobile();
    }
  });

  estokDropdownBtnMobile?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdownMobile();
  });

  export function updateEstokUIMobile() {
    const user = getCachedUser();
    const estokActivoId = getEstokActivoId();

    if (!user || !estokActivoId) {
      estokSectionMobile.classList.add('hidden');
      return;
    }

    const estokActivo = user.estoks?.find((e: any) => e.id === estokActivoId);

    if (estokActivo) {
      estokSectionMobile.classList.remove('hidden');
      estokNombreMobileBtn.textContent = estokActivo.nombre;
      estokRoleBadgeMobileBtn.textContent = estokActivo.role || '';

      if (estokActivo.role === 'Admin') {
        invitarBtnMobile.classList.remove('hidden');
      } else {
        invitarBtnMobile.classList.add('hidden');
      }
    } else {
      estokSectionMobile.classList.add('hidden');
    }
  }

  // ===========================================================================
  // BARRA DE ESTOK ACTIVO (SOLO MOBILE)
  // ===========================================================================
  const estokBarMobile = document.getElementById('estokBarMobile')!;
  const estokBarNombre = document.getElementById('estokBarNombre')!;
  const estokBarRoleBadge = document.getElementById('estokBarRoleBadge')!;

  export function updateEstokBarMobile() {
    const user = getCachedUser();
    const estokActivoId = getEstokActivoId();

    if (!user || !estokActivoId) {
      estokBarMobile.classList.add('hidden');
      return;
    }

    const estokActivo = user.estoks?.find((e: any) => e.id === estokActivoId);
    if (estokActivo) {
      estokBarMobile.classList.remove('hidden');
      estokBarNombre.textContent = estokActivo.nombre;
      estokBarRoleBadge.textContent = estokActivo.role || '';
    } else {
      estokBarMobile.classList.add('hidden');
    }
  }

  // Invitar mobile (misma tarjeta única que el navbar desktop)
  invitarBtnMobile?.addEventListener('click', abrirModalInvitacion);
