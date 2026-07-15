// =============================================================================
// GESTIÓN DE SESIÓN
// Login, logout, registro, fetchCurrentUser y caché de usuario.
// =============================================================================

import type { AuthUser, AuthError, LoginCredentials, TokenResponse } from './types';
import { getToken, setTokens, clearTokens } from './tokens';

// =============================================================================
// URL BASE DE LA API
// =============================================================================

const API_BASE_URL = import.meta.env.PUBLIC_API_URL || '/api';

// =============================================================================
// CONSTANTES DE CACHÉ
// =============================================================================

const USER_KEY = 'estok_user';
const ESTOK_ACTIVO_KEY = 'estok_activo_id';

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
// GESTIÓN DE ESTOK ACTIVO
// =============================================================================

export function getEstokActivoId(): string | null {
  return localStorage.getItem(ESTOK_ACTIVO_KEY);
}

export function setEstokActivoId(estokId: string | null): void {
  if (estokId) {
    localStorage.setItem(ESTOK_ACTIVO_KEY, estokId);
  } else {
    localStorage.removeItem(ESTOK_ACTIVO_KEY);
  }
}

// =============================================================================
// HEADERS DE AUTENTICACIÓN (centralizado)
// =============================================================================

/**
 * Construye los headers HTTP necesarios para requests autenticados.
 * Incluye Authorization (JWT) y X-Estok-Id si hay un estok activo.
 */
export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const estokId = getEstokActivoId();
  if (estokId) {
    headers['X-Estok-Id'] = estokId;
  }
  return headers;
}

// =============================================================================
// LOGIN
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

  // Si no tiene Estok activo pero tiene estoks, usar el primero como default
  if (!user.ultimo_estok_activo_id && user.estoks && user.estoks.length > 0) {
    const primerEstok = user.estoks[0];
    try {
      await cambiarEstokActivo(primerEstok.id, tokens.access);
      user.ultimo_estok_activo_id = primerEstok.id;
    } catch {
      // Si falla, continuar sin estok activo
    }
  }

  // Cachear copia local del estok activo
  if (user.ultimo_estok_activo_id) {
    setEstokActivoId(user.ultimo_estok_activo_id);
  }

  cacheUser(user);

  return { user, tokens };
}

// =============================================================================
// LOGOUT
// =============================================================================

/**
 * Cierra la sesión del usuario.
 * Limpia tokens y datos de usuario del almacenamiento local.
 */
export function logout(): void {
  clearTokens();
}

// =============================================================================
// REGISTRO
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
// FETCH CURRENT USER
// =============================================================================

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

// =============================================================================
// CAMBIAR ESTOK ACTIVO
// =============================================================================

import type { EstokInfo } from './types';

/**
 * Cambia el Estok activo del usuario autenticado.
 * Llama al backend para persistir el cambio y actualiza la copia local.
 */
export async function cambiarEstokActivo(estokId: string, token?: string): Promise<EstokInfo> {
  const authToken = token || getToken();
  if (!authToken) {
    throw { error: 'No hay sesión activa' } as AuthError;
  }

  const response = await fetch(`${API_BASE_URL}/cambiar-estok-activo/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ estok_id: estokId }),
  });

  if (!response.ok) {
    let errorMsg = 'Error al cambiar Estok activo';
    try {
      const errorData = await response.json();
      errorMsg = errorData.error || errorMsg;
    } catch {
      // Usar mensaje por defecto
    }
    throw { error: errorMsg, status: response.status } as AuthError;
  }

  const estokInfo: EstokInfo = await response.json();

  // Actualizar copia local
  setEstokActivoId(estokInfo.id);

  // Actualizar también el usuario cacheado
  const cachedUser = getCachedUser();
  if (cachedUser) {
    cachedUser.ultimo_estok_activo_id = estokInfo.id;
    cacheUser(cachedUser);
  }

  return estokInfo;
}
