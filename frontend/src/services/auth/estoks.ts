// =============================================================================
// GESTIÓN DE ESTOKS (multi-tenant)
// Crear Estok, unirse con código, roles, códigos de invitación.
// =============================================================================

import type { AuthError, EstokInfo, Role } from './types';
import { getToken } from './tokens';
import { getEstokActivoId, getCachedUser, cacheUser } from './session';
import { API_BASE_URL } from './apiBase';

/**
 * Mensaje legible de una respuesta de error de la API.
 *
 * Django REST Framework devuelve el detalle con formas distintas según el
 * origen: `{error}` (errores de negocio propios, ej. invitaciones que no
 * corresponden a ninguna cuenta), `{detail}` (autenticación/permisos) o
 * `{campo: [mensajes]}` (validación del serializer). Se normalizan TODAS para
 * que el modal muestre siempre el texto claro del backend y nunca un genérico
 * "no se pudo completar la operación".
 */
async function mensajeDeError(response: Response, porDefecto: string): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.error === 'string' && data.error) return data.error;
    if (typeof data?.detail === 'string' && data.detail) return data.detail;
    const plano = Object.values(data ?? {})
      .flat()
      .filter(Boolean)
      .join(', ');
    return plano || porDefecto;
  } catch {
    // Respuesta no-JSON (ej. HTML de un 500): se usa el mensaje por defecto.
    return porDefecto;
  }
}

// =============================================================================
// CREAR ESTOK
// =============================================================================

export interface CrearEstokOpciones {
  /** Respuesta a "¿Cuántas plantas (pisos) tiene su inmueble?" (1 = Planta Única). */
  cantidad_pisos?: number;
}

/**
 * Crea un nuevo Estok.
 * POST /api/estoks/ con {nombre, cantidad_pisos}
 * El backend automáticamente crea la Membresía Admin para el creador y deriva
 * el tipo_layout (CASA_2_PISOS si cantidad_pisos > 1, si no VISTA_PLANTA_UNICA).
 */
export async function crearEstok(nombre: string, opciones: CrearEstokOpciones = {}): Promise<EstokInfo> {
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
    body: JSON.stringify({
      nombre,
      ...(opciones.cantidad_pisos != null ? { cantidad_pisos: opciones.cantidad_pisos } : {}),
    }),
  });

  if (!response.ok) {
    throw {
      error: await mensajeDeError(response, 'Error al crear el Estok'),
      status: response.status,
    } as AuthError;
  }

  const data = await response.json();

  // =========================================================================
  // MAPEO EXACTO DEL ID DEL BACKEND (bug del "ID undefined"):
  // El serializer de creación puede devolver la clave según su versión
  // (`id`, `estok_id` o `uuid`). Se normaliza a `EstokInfo.id` para que el
  // Wizard del Mapa golpee SIEMPRE a /api/estoks/{id}/mapa/ con un UUID real.
  // =========================================================================
  const estok: EstokInfo = {
    id: data.id || data.estok_id || data.uuid || '',
    nombre: data.nombre || nombre,
    role: data.role || null,
    role_id: data.role_id || null,
  };

  if (!estok.id) {
    throw {
      error: 'El servidor no devolvió el ID del Estok recién creado. Reintentá la operación.',
      status: 502,
    } as AuthError;
  }

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
    throw {
      error: await mensajeDeError(response, 'Error al unirse al Estok'),
      status: response.status,
    } as AuthError;
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
    throw {
      error: await mensajeDeError(response, 'Error al obtener roles'),
      status: response.status,
    } as AuthError;
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
 * Límite de usos FIJO de todo código generado desde el modal "Invitar miembros".
 *
 * El backend invalida el código cuando `usos_actuales >= usos_maximos`
 * (ver CodigoInvitacion.es_valido), es decir: caduca en su cuarto uso.
 * El cartel informativo del modal muestra este mismo número, así que si se
 * cambia acá, hay que actualizar el texto visible en lib/invitacionModal.ts.
 */
export const USOS_MAXIMOS_INVITACION = 4;

/**
 * Opciones FIJAS de rol ofrecidas en el modal de invitación.
 * `nombreBackend` es el `Role.name` del RBAC dinámico (seed_data.py): el UUID
 * real se resuelve con fetchRoles() para no duplicar los roles del backend.
 */
export const ROLES_INVITACION = [
  { nombreBackend: 'Visualizador', etiqueta: 'Solo lectura' },
  { nombreBackend: 'Editor', etiqueta: 'Lectura y edición' },
] as const;

export interface OpcionesCodigoInvitacion {
  /** Usos antes de invalidarse (0 = sin límite). */
  usos_maximos?: number;
  fecha_expiracion?: string;
  /** Email o nombre de usuario del invitado: el backend acepta cualquiera de los dos. */
  invitado?: string;
  /** true cuando `invitado` es un nombre de usuario de Estok en vez de un email. */
  es_usuario_estok?: boolean;
  /** true para que el backend despache la invitación por SMTP. */
  enviar_email?: boolean;
}

export interface CodigoInvitacionCreado {
  id: string;
  codigo: string;
  /** Resultado del envío por SMTP (null/undefined si no se solicitó envío). */
  email_enviado?: boolean | null;
  /** Aviso legible cuando el envío por email no se pudo completar. */
  email_aviso?: string | null;
}

/**
 * Genera un código de invitación para un Estok.
 * POST /api/codigos-invitacion/ con
 * {role, usos_maximos?, fecha_expiracion?, invitado?, es_usuario_estok?, enviar_email?}
 * Requiere header X-Estok-Id.
 */
export async function generarCodigoInvitacion(
  estokId: string,
  roleId: string,
  opciones: OpcionesCodigoInvitacion = {}
): Promise<CodigoInvitacionCreado> {
  const token = getToken();
  if (!token) {
    throw { error: 'No hay sesión activa' } as AuthError;
  }

  const body: Record<string, unknown> = { role: roleId };
  if (opciones.usos_maximos !== undefined) body.usos_maximos = opciones.usos_maximos;
  if (opciones.fecha_expiracion) body.fecha_expiracion = opciones.fecha_expiracion;
  if (opciones.invitado) {
    body.invitado = opciones.invitado;
    body.es_usuario_estok = Boolean(opciones.es_usuario_estok);
  }
  if (opciones.enviar_email) body.enviar_email = true;

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
    throw {
      error: await mensajeDeError(response, 'Error al generar código de invitación'),
      status: response.status,
    } as AuthError;
  }

  return response.json();
}
