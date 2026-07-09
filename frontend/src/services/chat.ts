// =============================================================================
// SERVICIO DE CHAT INTERNO - Estok Inventory System
// Maneja mensajes entre miembros de un Estok
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from './auth';
import type { Mensaje } from '../types';

// =============================================================================
// OBTENER MENSAJES DEL ESTOK ACTIVO
// =============================================================================

export async function fetchMensajes(estokId?: string): Promise<Mensaje[]> {
  // Usamos solo el token de auth, SIN el header X-Estok-Id
  // para evitar inconsistencias si el localStorage está desactualizado.
  // El estokId se pasa exclusivamente como query param.
  const token = localStorage.getItem('estok_access_token');
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const params = estokId ? `?estok_id=${estokId}` : '';
  const response = await fetch(`${API_BASE_URL}/mensajes/${params}`, { headers });

  if (!response.ok) {
    throw new Error('Error al obtener mensajes');
  }

  return response.json();
}

// =============================================================================
// ENVIAR UN MENSAJE
// =============================================================================

export async function enviarMensaje(contenido: string, estokId?: string): Promise<Mensaje> {
  const headers = getAuthHeaders();
  headers['Content-Type'] = 'application/json';

  const params = estokId ? `?estok_id=${estokId}` : '';
  const response = await fetch(`${API_BASE_URL}/mensajes/${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contenido }),
  });

  if (!response.ok) {
    throw new Error('Error al enviar mensaje');
  }

  return response.json();
}

// =============================================================================
// MARCAR MENSAJE COMO LEÍDO
// =============================================================================

export async function marcarLeido(mensajeId: string): Promise<void> {
  const headers = getAuthHeaders();
  await fetch(`${API_BASE_URL}/mensajes/${mensajeId}/marcar_leido/`, {
    method: 'PATCH',
    headers,
  });
}

// =============================================================================
// OBTENER CANTIDAD DE MENSAJES NO LEÍDOS
// =============================================================================

export async function fetchNoLeidos(estokId?: string): Promise<number> {
  const headers = getAuthHeaders();
  const params = estokId ? `?estok_id=${estokId}` : '';
  const response = await fetch(`${API_BASE_URL}/mensajes/no_leidos/${params}`, { headers });

  if (!response.ok) {
    return 0;
  }

  const data = await response.json();
  return data.no_leidos || 0;
}

// =============================================================================
// PURGAR TODOS LOS MENSAJES DEL ESTOK (elimina del backend + cache)
// =============================================================================

export async function purgeMensajes(estokId?: string): Promise<{ eliminados: number }> {
  const headers = getAuthHeaders();
  const params = estokId ? `?estok_id=${estokId}` : '';
  const response = await fetch(`${API_BASE_URL}/mensajes/purge/${params}`, {
    method: 'DELETE',
    headers,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Error al purgar mensajes' }));
    throw new Error(err.error || 'Error al purgar mensajes');
  }

  return response.json();
}
