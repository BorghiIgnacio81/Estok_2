// =============================================================================
// PRESENCIA EN TIEMPO REAL
// Heartbeat (ping) y consulta de usuarios online.
// =============================================================================

import type { OnlineUser } from '../../types';
import { getToken } from './tokens';

// =============================================================================
// URL BASE DE LA API
// =============================================================================

const API_BASE_URL = import.meta.env.PUBLIC_API_URL || '/api';

// =============================================================================
// HEARTBEAT
// =============================================================================

/**
 * Envía un ping al backend para actualizar ultima_actividad.
 * POST /api/usuarios/ping/
 */
export async function ping(): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE_URL}/usuarios/ping/`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
  } catch {
    // Silencioso - no romper la UI si falla el ping
  }
}

// =============================================================================
// USUARIOS ONLINE
// =============================================================================

/**
 * Obtiene los usuarios online de un Estok específico.
 * GET /api/usuarios/online/?estok_id=<uuid>
 * Si no se pasa estok_id, usa el ultimo_estok_activo del usuario autenticado.
 */
export async function fetchOnlineUsers(estokId?: string): Promise<OnlineUser[]> {
  const token = getToken();
  if (!token) return [];
  try {
    const params = estokId ? `?estok_id=${encodeURIComponent(estokId)}` : '';
    const response = await fetch(`${API_BASE_URL}/usuarios/online/${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}
