// =============================================================================
// API UTILITY - Cliente HTTP genérico para Estok
// Centraliza fetch con autenticación, manejo de errores y tipado
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';

// =============================================================================
// TIPOS
// =============================================================================

export interface ApiError {
  error: string;
  status?: number;
  details?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// =============================================================================
// HELPERS
// =============================================================================

function buildUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
  }
  return url.toString();
}

function handleError(response: Response): Promise<ApiError> {
  return response.json().then(
    (data) => ({
      error: data.detail || data.error || Object.values(data).flat().join(', ') || `Error ${response.status}`,
      status: response.status,
      details: data,
    }),
    () => ({
      error: `Error del servidor (${response.status})`,
      status: response.status,
    })
  );
}

// =============================================================================
// MÉTODOS HTTP
// =============================================================================

export async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const response = await fetch(buildUrl(path, params), {
    headers: getAuthHeaders(),
  });
  if (response.status === 401) {
    window.location.href = '/login';
    throw { error: 'Sesión expirada', status: 401 } as ApiError;
  }
  if (!response.ok) throw await handleError(response);
  return response.json();
}

export async function apiPost<T>(path: string, body?: unknown, isFormData = false): Promise<T> {
  const headers: Record<string, string> = { ...getAuthHeaders() };
  if (!isFormData) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    window.location.href = '/login';
    throw { error: 'Sesión expirada', status: 401 } as ApiError;
  }
  if (!response.ok) throw await handleError(response);
  return response.json();
}

export async function apiPut<T>(path: string, body?: unknown, isFormData = false): Promise<T> {
  const headers: Record<string, string> = { ...getAuthHeaders() };
  if (!isFormData) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers,
    body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    window.location.href = '/login';
    throw { error: 'Sesión expirada', status: 401 } as ApiError;
  }
  if (!response.ok) throw await handleError(response);
  return response.json();
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    window.location.href = '/login';
    throw { error: 'Sesión expirada', status: 401 } as ApiError;
  }
  if (!response.ok) throw await handleError(response);
  return response.json();
}

export async function apiDelete(path: string): Promise<boolean> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (response.status === 401) {
    window.location.href = '/login';
    throw { error: 'Sesión expirada', status: 401 } as ApiError;
  }
  return response.ok || response.status === 204;
}

// =============================================================================
// PAGINACIÓN - Helper para cargar todas las páginas
// =============================================================================

export async function fetchAllPages<T>(path: string, params?: Record<string, string>): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = buildUrl(path, params);

  while (url) {
    const response = await fetch(url, { headers: getAuthHeaders() });
    if (!response.ok) throw await handleError(response);
    const data: PaginatedResponse<T> = await response.json();
    items.push(...data.results);
    url = data.next;
  }

  return items;
}
