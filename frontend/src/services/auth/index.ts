// =============================================================================
// PUNTO DE ENTRADA DEL MÓDULO DE AUTENTICACIÓN
// Re-exporta todas las funciones para mantener compatibilidad total con
// los imports existentes: import { ... } from '../services/auth'
// =============================================================================

// Tipos compartidos
export type {
  LoginCredentials,
  TokenResponse,
  AuthUser,
  AuthError,
  VersionInfo,
  EstokInfo,
  Role,
} from './types';

// Gestión de tokens
export {
  getToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  isAuthenticated,
  refreshToken,
  getValidToken,
} from './tokens';

// Gestión de sesión
export {
  getCachedUser,
  cacheUser,
  getEstokActivoId,
  setEstokActivoId,
  getAuthHeaders,
  login,
  logout,
  register,
  fetchCurrentUser,
  cambiarEstokActivo,
} from './session';

// Gestión de Estoks (multi-tenant)
export {
  crearEstok,
  unirseConCodigo,
  fetchRoles,
  generarCodigoInvitacion,
} from './estoks';

// Presencia en tiempo real
export {
  ping,
  fetchOnlineUsers,
} from './presence';

// =============================================================================
// URL BASE DE LA API - ÚNICA FUENTE DE VERDAD
// =============================================================================

export const API_BASE_URL = import.meta.env.PUBLIC_API_URL || '/api';

// =============================================================================
// VERSIÓN DE LA APP
// =============================================================================

import type { VersionInfo } from './types';

/**
 * Obtiene la versión actual del deploy desde /api/version/
 * NO cachea el resultado para permitir detección de cambios de versión.
 * Usa un timestamp como cache buster para evitar caché HTTP del navegador.
 */
export async function fetchVersion(forceRefresh: boolean = false): Promise<VersionInfo> {
  try {
    const cacheBuster = forceRefresh ? `?_=${Date.now()}` : '';
    const response = await fetch(`${API_BASE_URL}/version/${cacheBuster}`);
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Silencioso
  }
  return { commit: 'unknown', deploy_timestamp: null, version: '0.0.0' };
}

// =============================================================================
// EXPORTACIÓN POR DEFECTO (objeto agrupado)
// =============================================================================

import {
  getToken as _getToken,
  getRefreshToken as _getRefreshToken,
  getValidToken as _getValidToken,
  isAuthenticated as _isAuthenticated,
  refreshToken as _refreshToken,
} from './tokens';

import {
  login as _login,
  logout as _logout,
  register as _register,
  getCachedUser as _getCachedUser,
  fetchCurrentUser as _fetchCurrentUser,
  getEstokActivoId as _getEstokActivoId,
  setEstokActivoId as _setEstokActivoId,
  cambiarEstokActivo as _cambiarEstokActivo,
} from './session';

import {
  ping as _ping,
  fetchOnlineUsers as _fetchOnlineUsers,
} from './presence';

const auth = {
  login: _login,
  logout: _logout,
  register: _register,
  getToken: _getToken,
  getRefreshToken: _getRefreshToken,
  getValidToken: _getValidToken,
  isAuthenticated: _isAuthenticated,
  getCachedUser: _getCachedUser,
  fetchCurrentUser: _fetchCurrentUser,
  refreshToken: _refreshToken,
  getEstokActivoId: _getEstokActivoId,
  setEstokActivoId: _setEstokActivoId,
  cambiarEstokActivo: _cambiarEstokActivo,
  ping: _ping,
  fetchOnlineUsers: _fetchOnlineUsers,
  fetchVersion,
};

export default auth;
