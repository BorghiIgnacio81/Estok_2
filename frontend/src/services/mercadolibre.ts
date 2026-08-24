const API_BASE_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:8000/api';

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
  const token = localStorage.getItem('estok_access_token');
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
      'Authorization': `Bearer ${token}`,
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