import { API_BASE_URL, getAuthHeaders, getToken } from './auth';

export interface PublicarMLParams {
  objetoId: number | string;
  titulo: string;
  precio: number;
  descripcion: string;
  fotoUrl?: string;
  categoryId?: string; // Permitir pasar la categoría real seleccionada desde la BD
}

export async function predecirCategoriaML(titulo: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.mercadolibre.com/sites/MLA/domain_discovery/search?q=${encodeURIComponent(titulo)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0]?.category_id || null;
  } catch (e) {
    console.warn("Error al predecir categoría en Mercado Libre:", e);
    return null;
  }
}

export async function publicarEnMercadoLibre(params: PublicarMLParams) {
  const token = getToken();
  if (!token) throw new Error("No hay sesión activa.");

  // Si no viene categoría asignada, intentamos predecir o requerir una al usuario
  let categoriaFinal = params.categoryId;
  if (!categoriaFinal) {
    categoriaFinal = (await predecirCategoriaML(params.titulo)) || undefined;
  }

  if (!categoriaFinal) {
    throw new Error("No se pudo determinar una categoría válida de Mercado Libre para este producto.");
  }

  const body = {
    objeto_id: params.objetoId,
    title: params.titulo,
    price: params.precio,
    description: params.descripcion,
    currency_id: 'ARS',
    category_id: categoriaFinal,
    ...(params.fotoUrl && { foto_url: params.fotoUrl }),
  };

  const response = await fetch(`${API_BASE_URL}/mercadolibre/publicar_item/`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error || result.ml_response?.message || `Error (${response.status})`);
  }

  return result;
}

// =============================================================================
// CONTROL DE VINCULACIÓN OMNICANAL (Mercado Libre)
// Estado de conexión, URL de OAuth y desconexión.
// Todas las llamadas usan getAuthHeaders(): inyecta JWT + X-Estok-Id del
// inquilinato activo para mantener el aislamiento multi-tenant estricto.
// =============================================================================

export interface EstadoMercadoLibre {
  conectado: boolean;
  ml_user_id?: string | number;
  nickname?: string;
  nombre?: string;
  apellido?: string;
  email?: string;
  error?: string;
}

/** GET /api/mercadolibre/status/ → estado de la cuenta ML vinculada. */
export async function obtenerEstadoML(): Promise<EstadoMercadoLibre> {
  const response = await fetch(`${API_BASE_URL}/mercadolibre/status/`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

/** GET /api/mercadolibre/auth-url/ → URL de OAuth para conectar la cuenta. */
export async function obtenerAuthUrlML(): Promise<{ auth_url: string }> {
  const response = await fetch(`${API_BASE_URL}/mercadolibre/auth-url/`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

/** DELETE /api/mercadolibre/disconnect/ → desvincula la cuenta ML del usuario. */
export async function desconectarCuentaML(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/mercadolibre/disconnect/`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
