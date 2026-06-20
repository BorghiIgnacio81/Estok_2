/**
 * Utilidades compartidas de API para el frontend.
 * Centraliza getToken, getAuthHeaders y fetchWithAuth.
 */

const API_BASE = import.meta.env.PUBLIC_API_URL || 'http://localhost:8000/api';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function getAuthHeadersMultipart(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchWithAuth(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${API_BASE}${endpoint}`;
  const headers = getAuthHeaders();
  
  // Si es FormData, no poner Content-Type (el browser lo setea con boundary)
  if (options.body instanceof FormData) {
    const multipartHeaders = getAuthHeadersMultipart();
    return fetch(url, { ...options, headers: multipartHeaders });
  }
  
  return fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
}

export { API_BASE };
