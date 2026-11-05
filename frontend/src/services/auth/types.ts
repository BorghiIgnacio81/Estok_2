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
  tiene_clave_temporal: boolean;
  // Estado de monetización (lo agrega GET /api/usuarios/me/ desde
  // plan_acceso.estado_plan_usuario): el frontend lo usa para destruir el
  // espacio publicitario. Opcionales para no romper la caché vieja de
  // localStorage ni los endpoints que devuelven el usuario sin plan.
  es_premium?: boolean;
  ocultar_publicidad?: boolean;
  // Plan de suscripción (choices de CustomUser.plan_suscripcion). La lista
  // canónica vive en el backend (services/suscripcion.PLANES_ETIQUETAS).
  plan_suscripcion?: 'free' | 'pro' | 'familiar' | 'empresas' | 'personalizado';
  limite_objetos?: number | null;
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
