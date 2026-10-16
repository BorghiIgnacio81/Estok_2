// =============================================================================
// USUARIOS ONLINE - Indicador de presencia (polling cada 30 s)
// Extraído de layouts/BaseLayout.astro (Fase A · refactor preventivo).
// =============================================================================
import { getToken } from '../../services/auth';

const token = getToken();


  // ===========================================================================
  // USUARIOS ONLINE - Actualizar cada 30 segundos
  // ===========================================================================

  const onlineUsersIndicator = document.getElementById('onlineUsersIndicator')!;
  const onlineCount = document.getElementById('onlineCount')!;
  const onlineUsersBtn = document.getElementById('onlineUsersBtn')!;
  const onlineUsersTooltip = document.getElementById('onlineUsersTooltip')!;
  const onlineUsersList = document.getElementById('onlineUsersList')!;

  let onlineUsersInterval: number | null = null;

  export async function updateOnlineUsers() {
    if (!token) {
      onlineUsersIndicator.classList.add('hidden');
      return;
    }
    try {
      const { fetchOnlineUsers, getEstokActivoId } = await import('../../services/auth');
      const estokId = getEstokActivoId();
      const users = await fetchOnlineUsers(estokId || undefined);
      if (users.length > 0) {
        onlineUsersIndicator.classList.remove('hidden');
        onlineCount.textContent = String(users.length);
        onlineUsersList.innerHTML = users.map(u => `
          <div class="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700">
            <span class="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span>
            <span class="truncate">${u.display_name}</span>
          </div>
        `).join('');
      } else {
        onlineUsersIndicator.classList.add('hidden');
      }
    } catch {
      // Silencioso
    }
  }

  export function startOnlineUsersPolling() {
    if (onlineUsersInterval) return;
    updateOnlineUsers();
    onlineUsersInterval = window.setInterval(updateOnlineUsers, 30000);
  }

  export function stopOnlineUsersPolling() {
    if (onlineUsersInterval) {
      clearInterval(onlineUsersInterval);
      onlineUsersInterval = null;
    }
  }

  // Toggle tooltip
  onlineUsersBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    onlineUsersTooltip?.classList.toggle('hidden');
  });

  // Cerrar tooltip al hacer clic fuera
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('#onlineUsersIndicator')) {
      onlineUsersTooltip?.classList.add('hidden');
    }
  });

  if (token) {
    startOnlineUsersPolling();
  }
