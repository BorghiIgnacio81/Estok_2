// =============================================================================
// GESTIÓN DE TOKENS JWT
// Maneja almacenamiento local, refresh y validación de tokens.
// =============================================================================

import type { AuthError } from './types';

// =============================================================================
// CONSTANTES
// =============================================================================

const TOKEN_KEY = 'estok_access_token';
const REFRESH_KEY = 'estok_refresh_token';

// =============================================================================
// LECTURA / ESCRITURA DE TOKENS
// =============================================================================

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem('estok_user');
  localStorage.removeItem('estok_activo_id');
  // Limpiar foto persistente de la pagina de nuevo objeto
  try { sessionStorage.removeItem('nuevo_objeto_foto'); } catch (e) {}
}

// =============================================================================
// VALIDACIÓN DE TOKENS
// =============================================================================

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;

  // Verificar si el token ha expirado
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const now = Math.floor(Date.now() / 1000);
    return payload.exp > now;
  } catch {
    return false;
  }
}

// =============================================================================
// REFRESH DE TOKEN
// =============================================================================

/**
 * Refresca el token de acceso usando el refresh token.
 */
export async function refreshToken(): Promise<string> {
  const refresh = getRefreshToken();
  if (!refresh) {
    throw { error: 'No hay refresh token disponible' } as AuthError;
  }

  const response = await fetch(`${getApiBaseUrl()}/token/refresh/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh }),
  });

  if (!response.ok) {
    clearTokens();
    throw { error: 'Sesión expirada. Inicia sesión nuevamente.', status: response.status } as AuthError;
  }

  const data = await response.json();
  localStorage.setItem(TOKEN_KEY, data.access);
  return data.access;
}

/**
 * Obtiene el token de acceso, refrescándolo si es necesario.
 */
export async function getValidToken(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;

  // Verificar si el token está por expirar (menos de 5 minutos)
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = payload.exp - now;

    // Si expira en menos de 5 minutos, refrescar
    if (expiresIn < 300) {
      try {
        return await refreshToken();
      } catch {
        return null;
      }
    }

    return token;
  } catch {
    return null;
  }
}

// =============================================================================
// HELPERS INTERNOS
// =============================================================================

function getApiBaseUrl(): string {
  return import.meta.env.PUBLIC_API_URL || '/api';
}
