// =============================================================================
// HEARTBEAT (PING) - Mantiene la sesión activa (ping cada 30 s)
// Extraído de layouts/BaseLayout.astro (Fase A · refactor preventivo).
// =============================================================================
import { getToken } from '../../services/auth';


  // ===========================================================================
  // HEARTBEAT (PING) - Enviar ping cada 30 segundos
  // ===========================================================================

  let heartbeatInterval: number | null = null;

  export async function startHeartbeat() {
    if (heartbeatInterval) return; // Ya iniciado
    const { ping } = await import('../../services/auth');
    // Enviar ping inmediatamente al iniciar
    ping();
    // Luego cada 30 segundos
    heartbeatInterval = window.setInterval(() => {
      ping();
    }, 30000);
  }

  export function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  // Iniciar heartbeat si el usuario está autenticado
  const token = getToken();
  if (token) {
    startHeartbeat();
  }
