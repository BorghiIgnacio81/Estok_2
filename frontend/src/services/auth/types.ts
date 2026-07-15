// =============================================================================
// TIPOS COMPARTIDOS DEL MÓDULO DE AUTENTICACIÓN
// =============================================================================

import type { EstokInfo, Role } from '../../types';

// =============================================================================
// INTERFACES DE AUTENTICACIÓN
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

export interface VersionInfo {
  commit: string;
  deploy_timestamp: string | null;
  version: string;
}

// Re-exportamos tipos externos para que los consumidores no tengan
// que importar desde dos lugares distintos
export type { EstokInfo, Role };
