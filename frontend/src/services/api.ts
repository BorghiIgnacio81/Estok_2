// =============================================================================
// SERVICIO DE API - Estok Inventory System
// Cliente HTTP con autenticación JWT automática
// =============================================================================

import { getToken, getValidToken, logout, getEstokActivoId } from './auth';

const API_BASE_URL = import.meta.env.PUBLIC_API_URL || 'http://127.0.0.1:8000/api';

// =============================================================================
// TIPOS DE RESPUESTA
// =============================================================================

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// =============================================================================
// CLIENTE HTTP BASE
// =============================================================================

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = await getValidToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Agregar Estok activo si existe
  const estokId = getEstokActivoId();
  if (estokId) {
    headers['X-Estok-Id'] = estokId;
  }

  return headers;
}

async function getMultipartHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  const token = await getValidToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Agregar Estok activo si existe
  const estokId = getEstokActivoId();
  if (estokId) {
    headers['X-Estok-Id'] = estokId;
  }

  return headers;
}

async function handleResponse<T>(response: Response): Promise<ApiResponse<T>> {
  if (response.status === 401) {
    // Token expirado o inválido - cerrar sesión
    logout();
    return { data: null, error: 'Sesión expirada. Inicia sesión nuevamente.', status: 401 };
  }

  if (!response.ok) {
    let errorMsg = `Error ${response.status}`;
    try {
      const errorData = await response.json();
      errorMsg = errorData.detail || errorData.error || JSON.stringify(errorData);
    } catch {
      errorMsg = response.statusText || errorMsg;
    }
    return { data: null, error: errorMsg, status: response.status };
  }

  try {
    const data = await response.json();
    return { data, error: null, status: response.status };
  } catch {
    return { data: null, error: 'Error al parsear la respuesta', status: response.status };
  }
}

// =============================================================================
// MÉTODOS HTTP
// =============================================================================

export async function get<T>(endpoint: string, params?: Record<string, string>): Promise<ApiResponse<T>> {
  let url = `${API_BASE_URL}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const headers = await getAuthHeaders();
  const response = await fetch(url, { headers });
  return handleResponse<T>(response);
}

export async function post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = await getAuthHeaders();
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(response);
}

export async function put<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = await getAuthHeaders();
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(response);
}

export async function patch<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = await getAuthHeaders();
  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(response);
}

export async function del<T>(endpoint: string): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = await getAuthHeaders();
  const response = await fetch(url, {
    method: 'DELETE',
    headers,
  });
  return handleResponse<T>(response);
}

// =============================================================================
// SUBIDA DE ARCHIVOS (MULTIPART)
// =============================================================================

export async function uploadFile<T>(
  endpoint: string,
  formData: FormData
): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = await getMultipartHeaders();
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });
  return handleResponse<T>(response);
}

// =============================================================================
// ENDPOINTS ESPECÍFICOS
// =============================================================================

// --- Roles ---
export const rolesApi = {
  list: () => get<PaginatedResponse<any>>('/roles/'),
  get: (id: string) => get<any>(`/roles/${id}/`),
  create: (data: any) => post<any>('/roles/', data),
  update: (id: string, data: any) => put<any>(`/roles/${id}/`, data),
  delete: (id: string) => del(`/roles/${id}/`),
};

// --- Usuarios ---
export const usuariosApi = {
  list: () => get<PaginatedResponse<any>>('/usuarios/'),
  get: (id: string) => get<any>(`/usuarios/${id}/`),
  me: () => get<any>('/usuarios/me/'),
  create: (data: any) => post<any>('/usuarios/', data),
  update: (id: string, data: any) => put<any>(`/usuarios/${id}/`, data),
  delete: (id: string) => del(`/usuarios/${id}/`),
};

// --- Ubicaciones ---
export const ubicacionesApi = {
  list: () => get<PaginatedResponse<any>>('/ubicaciones/'),
  get: (id: string) => get<any>(`/ubicaciones/${id}/`),
  create: (data: any) => post<any>('/ubicaciones/', data),
  update: (id: string, data: any) => put<any>(`/ubicaciones/${id}/`, data),
  delete: (id: string) => del(`/ubicaciones/${id}/`),
};

// --- Contenedores ---
export const contenedoresApi = {
  list: (params?: { ubicacion?: string }) => get<PaginatedResponse<any>>('/contenedores/', params),
  get: (id: string) => get<any>(`/contenedores/${id}/`),
  create: (data: any) => post<any>('/contenedores/', data),
  update: (id: string, data: any) => put<any>(`/contenedores/${id}/`, data),
  delete: (id: string) => del(`/contenedores/${id}/`),
  qrCode: (id: string) => get<any>(`/contenedores/${id}/qr_code/`),
  regenerarQr: (id: string) => post<any>(`/contenedores/${id}/regenerar_qr/`),
  escanear: (params: { qr_data?: string; contenedor_id?: string }) =>
    get<any>('/contenedores/escanear/', params),
};

// --- Objetos ---
export const objetosApi = {
  list: (params?: {
    tipo?: string;
    ubicacion?: string;
    contenedor?: string;
    estado?: string;
    estado_carga?: string;
    search?: string;
    incluir_eliminados?: string;
  }) => get<PaginatedResponse<any>>('/objetos/', params),
  get: (id: string) => get<any>(`/objetos/${id}/`),
  create: (data: any) => post<any>('/objetos/', data),
  update: (id: string, data: any) => put<any>(`/objetos/${id}/`, data),
  partialUpdate: (id: string, data: any) => patch<any>(`/objetos/${id}/`, data),
  delete: (id: string) => del(`/objetos/${id}/`),
  analizarConIa: (id: string) => post<any>(`/objetos/${id}/analizar_con_ia/`),
  analizarImagen: (data: { imagen_base64: string; ubicacion_id?: string; contenedor_id?: string }) =>
    post<any>('/objetos/analizar_imagen/', data),
  generarAnuncios: (id: string) => post<any>(`/objetos/${id}/generar_anuncios/`),
  publicarEn: (id: string, data: { plataforma: string }) =>
    post<any>(`/objetos/${id}/publicar_en/`, data),
  estadoPublicacion: (id: string) => get<any>(`/objetos/${id}/estado_publicacion/`),
  actualizarPrecio: (id: string, data: { valor_nuevo: number; motivo?: string }) =>
    post<any>(`/objetos/${id}/actualizar_precio/`, data),
  historialPrecios: (id: string) => get<any>(`/objetos/${id}/historial_precios/`),
  plusvalia: (id: string) => get<any>(`/objetos/${id}/plusvalia/`),
  crearAlertaStock: (id: string, data: { nivel_minimo: number; cantidad_actual: number }) =>
    post<any>(`/objetos/${id}/crear_alerta_stock/`, data),
  subirFoto: (id: string, formData: FormData) => uploadFile<any>(`/objetos/${id}/subir_foto/`, formData),
  softDelete: (id: string) => post<any>(`/objetos/${id}/soft_delete/`),
  restaurar: (id: string) => post<any>(`/objetos/${id}/restaurar/`),
};

// --- Fotos ---
export const fotosApi = {
  list: (params?: { objeto?: string }) => get<PaginatedResponse<any>>('/fotos/', params),
  get: (id: string) => get<any>(`/fotos/${id}/`),
  delete: (id: string) => del(`/fotos/${id}/`),
  hacerPrincipal: (id: string) => post<any>(`/fotos/${id}/hacer_principal/`),
};

// --- Historial de Precios ---
export const historialPreciosApi = {
  list: (params?: { objeto?: string }) => get<PaginatedResponse<any>>('/historial-precios/', params),
  get: (id: string) => get<any>(`/historial-precios/${id}/`),
};

// --- Alertas de Stock ---
export const alertasStockApi = {
  list: (params?: { objeto?: string; activas?: string; reponer?: string }) =>
    get<PaginatedResponse<any>>('/alertas-stock/', params),
  get: (id: string) => get<any>(`/alertas-stock/${id}/`),
  create: (data: any) => post<any>('/alertas-stock/', data),
  update: (id: string, data: any) => put<any>(`/alertas-stock/${id}/`, data),
  delete: (id: string) => del(`/alertas-stock/${id}/`),
  resumen: () => get<any>('/alertas-stock/resumen/'),
};

// =============================================================================
// EXPORTACIÓN POR DEFECTO
// =============================================================================

const api = {
  get,
  post,
  put,
  patch,
  del,
  uploadFile,
  rolesApi,
  usuariosApi,
  ubicacionesApi,
  contenedoresApi,
  objetosApi,
  fotosApi,
  historialPreciosApi,
  alertasStockApi,
};

export default api;
