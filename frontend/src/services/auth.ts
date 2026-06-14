// =============================================================================
// SERVICIO DE AUTENTICACIÓN JWT - Estok Inventory System
// Maneja login, logout, token persistence y refresh
// =============================================================================

const API_BASE_URL = import.meta.env.PUBLIC_API_URL || 'http://127.0.0.1:8000/api';

// =============================================================================
// CONSTANTES
// =============================================================================

const TOKEN_KEY = 'estok_access_token';
const REFRESH_KEY = 'estok_refresh_token';
const USER_KEY = 'estok_user';

// =============================================================================
// INTERFACES
// =============================================================================

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface TokenResponse {
  access: string;
  refresh: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string | null;
  role_name: string;
  description: string;
  phone: string;
  is_active: boolean;
}

export interface AuthError {
  error: string;
  status?: number;
}

// =============================================================================
// GESTIÓN DE TOKENS
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
  localStorage.removeItem(USER_KEY);
}

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
// GESTIÓN DE USUARIO EN CACHE
// =============================================================================

export function getCachedUser(): AuthUser | null {
  try {
    const userData = localStorage.getItem(USER_KEY);
    return userData ? JSON.parse(userData) : null;
  } catch {
    return null;
  }
}

export function cacheUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// =============================================================================
// FUNCIONES DE AUTENTICACIÓN
// =============================================================================

/**
 * Inicia sesión con credenciales de usuario.
 * Realiza POST a /api/token/ y almacena los tokens JWT.
 */
export async function login(credentials: LoginCredentials): Promise<{ user: AuthUser; tokens: TokenResponse }> {
  const response = await fetch(`${API_BASE_URL}/token/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    let errorMsg = 'Credenciales inválidas';
    try {
      const errorData = await response.json();
      errorMsg = errorData.detail || errorData.error || Object.values(errorData).flat().join(', ') || errorMsg;
    } catch {
      // Usar mensaje por defecto
    }
    throw { error: errorMsg, status: response.status } as AuthError;
  }

  const tokens: TokenResponse = await response.json();
  setTokens(tokens.access, tokens.refresh);

  // Obtener datos del usuario autenticado
  const user = await fetchCurrentUser(tokens.access);
  cacheUser(user);

  return { user, tokens };
}

/**
 * Obtiene los datos del usuario autenticado desde el endpoint /api/usuarios/me/
 */
export async function fetchCurrentUser(token?: string): Promise<AuthUser> {
  const authToken = token || getToken();
  if (!authToken) {
    throw { error: 'No hay sesión activa' } as AuthError;
  }

  const response = await fetch(`${API_BASE_URL}/usuarios/me/`, {
    headers: {
      'Authorization': `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    throw { error: 'Error al obtener datos del usuario', status: response.status } as AuthError;
  }

  return response.json();
}

/**
 * Refresca el token de acceso usando el refresh token.
 */
export async function refreshToken(): Promise<string> {
  const refresh = getRefreshToken();
  if (!refresh) {
    throw { error: 'No hay refresh token disponible' } as AuthError;
  }

  const response = await fetch(`${API_BASE_URL}/token/refresh/`, {
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
 * Cierra la sesión del usuario.
 * Limpia tokens y datos de usuario del almacenamiento local.
 */
export function logout(): void {
  clearTokens();
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
// REGISTRO DE USUARIO
// =============================================================================

export async function register(data: {
  username: string;
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
}): Promise<AuthUser> {
  const response = await fetch(`${API_BASE_URL}/usuarios/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    let errorMsg = 'Error al registrar usuario';
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

// =============================================================================
// EXPORTACIÓN POR DEFECTO
// =============================================================================

const auth = {
  login,
  logout,
  register,
  getToken,
  getRefreshToken,
  getValidToken,
  isAuthenticated,
  getCachedUser,
  fetchCurrentUser,
  refreshToken,
};

export default auth;
