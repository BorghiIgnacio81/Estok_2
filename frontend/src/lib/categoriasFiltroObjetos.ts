// =============================================================================
// COMBOBOX DE CATEGORÍAS DE LA BARRA DE FILTROS (/objetos)
// -----------------------------------------------------------------------------
// Responsabilidades de esta capa (extraída del controlador del listado para
// sostener el límite de 400 líneas por archivo de UI):
//   1. POBLAR el <select> «Categoría» con TODAS las categorías del Estok activo
//      (GET /api/categorias/).
//   2. REFRESCARLO EN CALIENTE cuando el modal «Nueva Categoría»
//      (CategoriaCreator.astro) crea o elimina una categoría: los eventos
//      `categoriaCreada` / `categoriaEliminada` se reflejan sin F5.
//
// El <select> se recibe por parámetro: este módulo no conoce el estado del
// listado. Auth centralizada: getAuthHeaders() desde src/services/auth.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { escapeHtml } from './escapeHtml';

/** Categoría mínima que publica /api/categorias/ (y el evento de alta). */
export interface CategoriaFiltro {
  id?: string;
  nombre?: string;
  icono?: string;
}

/** Puebla el combobox con TODAS las categorías del Estok activo. */
export async function cargarCategoriasFiltro(
  select: HTMLSelectElement | null,
): Promise<void> {
  if (!select) return;
  try {
    const res = await fetch(API_BASE_URL + '/categorias/', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const categorias: CategoriaFiltro[] = data.results || data || [];
    let html = '<option value="">Todas</option>';
    for (const c of categorias) {
      html += '<option value="' + escapeHtml(c.id) + '">'
        + escapeHtml(c.icono || '🏷️') + ' ' + escapeHtml(c.nombre) + '</option>';
    }
    select.innerHTML = html;
  } catch {
    // El árbol se carga igual sin el desplegable de categorías.
  }
}

/**
 * Inserta EN CALIENTE la categoría recién creada en el combobox de filtros, SIN
 * recargar la página (elimina el F5 manual). El modal CategoriaCreator dispara el
 * evento `categoriaCreada` tras el 201/200 del backend; acá se refleja al toque en
 * el DOM del <select>. Si la opción ya existiera, no se duplica.
 */
export function agregarCategoriaFiltro(
  select: HTMLSelectElement | null,
  categoria: CategoriaFiltro | null,
): void {
  if (!select || !categoria || !categoria.id || !categoria.nombre) return;
  const id = String(categoria.id);
  const yaExiste = Array.from(select.options).some((opt) => opt.value === id);
  if (yaExiste) return;
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = (categoria.icono || '🏷️') + ' ' + String(categoria.nombre);
  select.appendChild(opt);
}
