// =============================================================================
// REDEPLOY BANNER - Detecta un nuevo deploy y ofrece recargar
// Extraído de layouts/BaseLayout.astro (Fase A · refactor preventivo).
// =============================================================================
import { getToken } from '../../services/auth';

const token = getToken();


  // ===========================================================================
  // REDEPLOY BANNER - Detectar si hay un nuevo deploy
  // ===========================================================================

  let redeployCheckInterval: number | null = null;
  let lastKnownVersion: string | null = localStorage.getItem('estok_version');

  async function checkForNewDeploy() {
    try {
      const { fetchVersion } = await import('../../services/auth');
      // forceRefresh=true para evitar caché HTTP y detectar cambios reales
      const versionInfo = await fetchVersion(true);
      // Usar deploy_timestamp (siempre cambia) + version como identificador único de deploy
      const currentVersion = versionInfo.deploy_timestamp || versionInfo.version || versionInfo.commit;

      if (!lastKnownVersion) {
        // Primera vez: guardar versión actual
        lastKnownVersion = currentVersion;
        localStorage.setItem('estok_version', currentVersion);
        return;
      }

      // Si la versión cambió, mostrar banner de redeploy
      if (currentVersion !== lastKnownVersion) {
        mostrarBannerRedeploy(versionInfo);
        lastKnownVersion = currentVersion;
        localStorage.setItem('estok_version', currentVersion);
      }
    } catch {
      // Silencioso
    }
  }

  function mostrarBannerRedeploy(versionInfo: { version: string; commit: string; deploy_timestamp: string | null }) {
    if (document.getElementById('redeployBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'redeployBanner';
    banner.className = 'fixed bottom-0 left-0 right-0 z-[9999] bg-blue-600 text-white px-4 py-3 shadow-2xl transform translate-y-full transition-transform duration-500 ease-out';
    banner.innerHTML = `
      <div class="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <svg class="w-6 h-6 flex-shrink-0 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <div>
            <p class="text-sm font-semibold">🚀 Nueva versión desplegada</p>
            <p class="text-xs text-blue-200">Versión ${versionInfo.version} — Se recomienda recargar para ver los cambios.</p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button id="redeployLaterBtn" class="text-xs text-blue-200 hover:text-white px-3 py-1.5 rounded-lg transition-base">
            Ahora no
          </button>
          <button id="redeployNowBtn" class="text-xs font-semibold bg-white text-blue-700 px-4 py-1.5 rounded-lg hover:bg-blue-50 transition-base shadow-sm">
            🔄 Recargar ahora
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    requestAnimationFrame(() => {
      banner.classList.remove('translate-y-full');
    });

    document.getElementById('redeployNowBtn')?.addEventListener('click', () => {
      window.location.reload();
    });

    document.getElementById('redeployLaterBtn')?.addEventListener('click', () => {
      banner.classList.add('translate-y-full');
      setTimeout(() => banner.remove(), 500);
    });
  }

  export function startRedeployCheck() {
    if (redeployCheckInterval) return;
    // Checkear cada 30 segundos para detectar cambios rápido
    checkForNewDeploy();
    redeployCheckInterval = window.setInterval(checkForNewDeploy, 30000);
  }

  export function stopRedeployCheck() {
    if (redeployCheckInterval) {
      clearInterval(redeployCheckInterval);
      redeployCheckInterval = null;
    }
  }

  if (token) {
    startRedeployCheck();
  }
