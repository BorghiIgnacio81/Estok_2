// =============================================================================
// CATÁLOGOS DEL ESTOK ACTIVO (usuarios y categorías) — FUENTE ÚNICA
// -----------------------------------------------------------------------------
// Lo consumen el formulario de objetos (comboboxes Dueño/Beneficiario y
// Categoría) y el panel de propiedades del espacio declarado como objeto.
// Así la carga de catálogos NO se duplica en cada módulo.
//
// Auth centralizada: getAuthHeaders()/API_BASE_URL/normalizarUrlApi SIEMPRE
// desde services/auth. Este módulo NUNCA define headers ni URLs propias.
//
// Caché en memoria por sesión de página: los catálogos cambian poco y el panel
// del espacio se repinta en cada nivel de la cascada. `forzar` refresca.
// =============================================================================

import {
  API_BASE_URL,
  getAuthHeaders,
  normalizarUrlApi,
} from '../services/auth';

export interface UsuarioEstok {
  id: string;
  /** Nombre visible (full_name, username o email). */
  nombre: string;
}

export interface CategoriaEstok {
  id: string;
  nombre: string;
  icono: string;
  /** ID oficial de Mercado Libre (MLAxxxxx) cuando existe. */
  meliId: string | null;
}

let cacheUsuarios: UsuarioEstok[] | null = null;
let cacheCategorias: CategoriaEstok[] | null = null;

/** GET paginado completo (sigue `next` de DRF con Auth centralizada). */
async function fetchTodos(url: string): Promise<Record<string, unknown>[]> {
  const todos: Record<string, unknown>[] = [];
  let siguiente: string | null = url;
  while (siguiente) {
    const res = await fetch(siguiente, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return todos;
    }
    if (!res.ok) return todos;
    const data = await res.json();
    const lote = Array.isArray(data) ? data : data?.results || [];
    todos.push(...lote);
    siguiente = normalizarUrlApi(data?.next);
  }
  return todos;
}

/** Usuarios miembros del Estok activo (para «Dueño / Propietario»). */
export async function cargarUsuariosEstok(forzar = false): Promise<UsuarioEstok[]> {
  if (cacheUsuarios && !forzar) return cacheUsuarios;
  const filas = await fetchTodos(`${API_BASE_URL}/usuarios/?page_size=1000`);
  cacheUsuarios = filas
    .map((u) => ({
      id: String(u.id ?? ''),
      nombre: String(u.full_name || u.username || u.email || 'Usuario'),
    }))
    .filter((u) => u.id);
  return cacheUsuarios;
}

/** Categorías del Estok activo (11 oficiales + personalizadas). */
export async function cargarCategoriasEstok(forzar = false): Promise<CategoriaEstok[]> {
  if (cacheCategorias && !forzar) return cacheCategorias;
  const filas = await fetchTodos(`${API_BASE_URL}/categorias/?page_size=1000`);
  cacheCategorias = filas
    .map((c) => ({
      id: String(c.id ?? ''),
      nombre: String(c.nombre ?? ''),
      icono: String(c.icono || '🏷️'),
      meliId: c.mercadolibre_category_id
        ? String(c.mercadolibre_category_id)
        : null,
    }))
    .filter((c) => c.id && c.nombre);
  return cacheCategorias;
}

/**
 * Categoría por defecto de un MUEBLE declarado como objeto.
 *
 * La taxonomía oficial usa el plural «Muebles» (MLA1574); se aceptan también
 * variantes con/sin plural y mayúsculas. Devuelve null si el Estok no la tiene.
 */
export function categoriaMueblePorDefecto(
  categorias: CategoriaEstok[],
): CategoriaEstok | null {
  const normalizar = (texto: string) =>
    texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  return (
    categorias.find((c) => {
      const nombre = normalizar(c.nombre);
      return nombre === 'mueble' || nombre === 'muebles';
    }) ?? null
  );
}
