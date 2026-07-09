// =============================================================================
// SERVICIO DE AUTENTICACIÓN JWT - Estok Inventory System
// Maneja login, logout, token persistence y refresh
// =============================================================================

import type { EstokInfo, Role } from '../types';

// =============================================================================
// URL BASE DE LA API - ÚNICA FUENTE DE VERDAD
// Todos los archivos deben importar esta constante desde auth.ts
// =============================================================================
export const API_BASE_URL = import.meta.env.PUBLIC_API_URL || '/api';

// =============================================================================
// CONSTANTES
// =============================================================================

const TOKEN_KEY = 'estok_access_token';
const REFRESH_KEY = 'estok_refresh_token';
const USER_KEY = 'estok_user';
const ESTOK_ACTIVO_KEY = 'estok_activo_id';

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
  description: string;
  phone: string;
  is_active: boolean;
  estoks: EstokInfo[];
  ultimo_estok_activo_id: string | null;
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
  localStorage.removeItem(ESTOK_ACTIVO_KEY);
  // Limpiar foto persistente de la pagina de nuevo objeto
  try { sessionStorage.removeItem('nuevo_objeto_foto'); } catch (e) {}
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
// GESTIÓN DE ESTOK ACTIVO
// =============================================================================


/**
 * Obtiene el ID del Estok activo desde la copia local (localStorage).
 * La fuente de verdad es el backend (CustomUser.ultimo_estok_activo),
 * esta es solo una caché para no tener que leer el header en cada request.
 */
export function getEstokActivoId(): string | null {
  return localStorage.getItem(ESTOK_ACTIVO_KEY);
}

/**
 * Actualiza la copia local del Estok activo.
 * Esto debe llamarse después de que el backend confirme el cambio.
 */
export function setEstokActivoId(estokId: string | null): void {
  if (estokId) {
    localStorage.setItem(ESTOK_ACTIVO_KEY, estokId);
  } else {
    localStorage.removeItem(ESTOK_ACTIVO_KEY);
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

// =============================================================================
// GESTIÓN DE ESTOKS
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
// HEARTBEAT / USUARIOS ONLINE
// =============================================================================

import type { OnlineUser } from '../types';

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

/**
 * Obtiene los usuarios online.
 * GET /api/usuarios/online/
 */
export async function fetchOnlineUsers(): Promise<OnlineUser[]> {
  const token = getToken();
  if (!token) return [];
  try {
    const response = await fetch(`${API_BASE_URL}/usuarios/online/`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

// =============================================================================
// VERSIÓN DE LA APP
// =============================================================================

export interface VersionInfo {
  commit: string;
  deploy_timestamp: string | null;
  version: string;
}

let cachedVersion: VersionInfo | null = null;

/**
 * Obtiene la versión actual del deploy desde /api/version/
 */
export async function fetchVersion(): Promise<VersionInfo> {
  if (cachedVersion) return cachedVersion;
  try {
    const response = await fetch(`${API_BASE_URL}/version/`);
    if (response.ok) {
      cachedVersion = await response.json();
      return cachedVersion!;
    }
  } catch {
    // Silencioso
  }
  return { commit: 'unknown', deploy_timestamp: null, version: '0.0.0' };
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
  getEstokActivoId,
  setEstokActivoId,
  cambiarEstokActivo,
  ping,
  fetchOnlineUsers,
  fetchVersion,
};

export default auth;
