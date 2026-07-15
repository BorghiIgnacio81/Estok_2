// =============================================================================
// GESTIÓN DE ESTOKS (multi-tenant)
// Crear Estok, unirse con código, roles, códigos de invitación.
// =============================================================================

import type { AuthError, EstokInfo, Role } from './types';
import { getToken } from './tokens';
import { getEstokActivoId, getCachedUser, cacheUser } from './session';

// =============================================================================
// URL BASE DE LA API
// =============================================================================

const API_BASE_URL = import.meta.env.PUBLIC_API_URL || '/api';

// =============================================================================
// CREAR ESTOK
// =============================================================================

/**
 * Crea un nuevo Estok.
 * POST /api/estoks/ con {nombre}
 * El backend automáticamente crea la Membresía Admin para el creador.
 */
export async function crearEstok(nombre: string): Promise<EstokInfo> {
  const token = getToken();
  if (!token) {
    throw { error: 'No hay sesión activa' } as AuthError;
  }

  const response = await fetch(`${API_BASE_URL}/estoks/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ nombre }),
  });

  if (!response.ok) {
    let errorMsg = 'Error al crear el Estok';
    try {
      const errorData = await response.json();
      errorMsg = errorData.error || Object.values(errorData).flat().join(', ') || errorMsg;
    } catch {
      // Usar mensaje por defecto
    }
    throw { error: errorMsg, status: response.status } as AuthError;
  }

  const estok: EstokInfo = await response.json();

  // Actualizar el usuario cacheado para que incluya el nuevo Estok
  const cachedUser = getCachedUser();
  if (cachedUser) {
    cachedUser.estoks = [...(cachedUser.estoks || []), estok];
    cacheUser(cachedUser);
  }

  return estok;
}

// =============================================================================
// UNIRSE CON CÓDIGO
// =============================================================================

/**
 * Se une a un Estok usando un código de invitación.
 * POST /api/estoks/unirse/ con {codigo}
 */
export async function unirseConCodigo(codigo: string): Promise<{ mensaje: string; estok: EstokInfo }> {
  const token = getToken();
  if (!token) {
    throw { error: 'No hay sesión activa' } as AuthError;
  }

  const response = await fetch(`${API_BASE_URL}/estoks/unirse/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ codigo }),
  });

  if (!response.ok) {
    let errorMsg = 'Error al unirse al Estok';
    try {
      const errorData = await response.json();
      errorMsg = errorData.error || errorMsg;
    } catch {
      // Usar mensaje por defecto
    }
    throw { error: errorMsg, status: response.status } as AuthError;
  }

  return response.json();
}

// =============================================================================
// ROLES
// =============================================================================

/**
 * Obtiene la lista de roles disponibles.
 * GET /api/roles/
 */
export async function fetchRoles(): Promise<Role[]> {
  const token = getToken();
  if (!token) {
    throw { error: 'No hay sesión activa' } as AuthError;
  }

  const estokId = getEstokActivoId();
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
  };
  if (estokId) {
    headers['X-Estok-Id'] = estokId;
  }

  const response = await fetch(`${API_BASE_URL}/roles/`, {
    headers,
  });

  if (!response.ok) {
    throw { error: 'Error al obtener roles', status: response.status } as AuthError;
  }

  const data = await response.json();
  // DRF devuelve paginado: {count, next, previous, results}
  // Extraemos el array para que el caller siempre reciba un array iterable
  return data.results || data;
}

// =============================================================================
// CÓDIGOS DE INVITACIÓN
// =============================================================================

/**
 * Genera un código de invitación para un Estok.
 * POST /api/codigos-invitacion/ con {role, usos_maximos?, fecha_expiracion?}
 * Requiere header X-Estok-Id.
 */
export async function generarCodigoInvitacion(
  estokId: string,
  roleId: string,
  opciones?: { usos_maximos?: number; fecha_expiracion?: string }
): Promise<{ codigo: string; id: string }> {
  const token = getToken();
  if (!token) {
    throw { error: 'No hay sesión activa' } as AuthError;
  }

  const body: Record<string, unknown> = { role: roleId };
  if (opciones?.usos_maximos !== undefined) body.usos_maximos = opciones.usos_maximos;
  if (opciones?.fecha_expiracion) body.fecha_expiracion = opciones.fecha_expiracion;

  const response = await fetch(`${API_BASE_URL}/codigos-invitacion/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Estok-Id': estokId,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMsg = 'Error al generar código de invitación';
    try {
      const errorData = await response.json();
      errorMsg = errorData.error || Object.values(errorData).flat().join(', ') || errorMsg;
    } catch {
      // Usar mensaje por defecto
    }
    throw { error: errorMsg, status: response.status } as AuthError;
  }

  return response.json();
}
