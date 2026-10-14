// =============================================================================
// CATÁLOGOS DEL FORMULARIO DE OBJETO (/objetos/nuevo y Paso 4 del tutorial)
// -----------------------------------------------------------------------------
// Módulo de CARGA DE CATÁLOGOS del Estok activo (auth centralizada):
//   · Usuarios → comboboxes de dueño original y beneficiario (LegadoTrazabilidad).
//                Avisa por el evento 'estok:usuariosCargados'.
//   · Categorías → las 11 oficiales de Mercado Libre en el combobox `categoria`.
//                Se recargan al escuchar 'categoriaCreada'.
//
// LA UBICACIÓN NO SE ELIGE ACÁ: la resuelve de forma canónica la PASARELA DE
// MINIMAPAS ELÁSTICOS UNIFICADOS (components/MinimapaModuloUnificado.astro en
// modo interactivo → lib/selectorMinimapaNuevoObjeto.ts), la MISMA que usa el
// Paso 4 del tutorial y la pantalla de edición de objeto. Los modales viejos de
// «Nueva Ubicación» / «Nuevo Contenedor» con combobox plano se DESMANTELARON
// (Lote 22) para que la interfaz sea IDÉNTICA en toda la aplicación.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../../services/auth';
import { refOpcional } from '../dom';

// =============================================================================
// CARGA DE CATÁLOGOS
// =============================================================================

/** Trae los usuarios del Estok y llena los comboboxes dueño/beneficiario. */
async function cargarUsuarios(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/usuarios/`, {
      headers: getAuthHeaders(),
    });
    if (response.ok) {
      const data = await response.json();
      const usuarios = data.results || data;
      const duenoSelect = refOpcional<HTMLSelectElement>('dueno_original');
      const benSelect = refOpcional<HTMLSelectElement>('beneficiario');
      if (!duenoSelect || !benSelect) return;
      usuarios.forEach((u: any) => {
        const opt1 = document.createElement('option');
        opt1.value = u.id;
        opt1.textContent = u.full_name || u.username || u.email;
        duenoSelect.appendChild(opt1);
        const opt2 = document.createElement('option');
        opt2.value = u.id;
        opt2.textContent = u.full_name || u.username || u.email;
        benSelect.appendChild(opt2);
      });
    }
  } catch (err) {
    console.error('Error cargando usuarios:', err);
  } finally {
    // El widget de Legado recalcula su aviso de votación cuando el padrón del
    // Estok ya está cargado en los comboboxes.
    window.dispatchEvent(new CustomEvent('estok:usuariosCargados'));
  }
}

/** Trae las categorías (11 oficiales de Mercado Libre) al combobox `categoria`. */
async function cargarCategorias(): Promise<void> {
  const select = refOpcional<HTMLSelectElement>('categoria');
  if (!select) return;
  try {
    const response = await fetch(`${API_BASE_URL}/categorias/`, {
      headers: getAuthHeaders(),
    });
    if (response.ok) {
      const data = await response.json();
      const categorias = data.results || data;
      // Preservar la opción «Sin categoría».
      select.innerHTML = '<option value="">Sin categoría</option>';
      categorias.forEach((c: any) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        // Guarda el ID de Mercado Libre de la categoría para que el autocompletado
        // de IA pueda seleccionarla por su ID oficial (MLAxxxxx).
        opt.dataset.meliId = c.mercadolibre_category_id ? String(c.mercadolibre_category_id) : '';
        opt.textContent = `${c.icono || '🏷️'} ${c.nombre}`;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Error cargando categorías:', err);
  }
}

// =============================================================================
// INICIALIZACIÓN
// =============================================================================

/** Inicializa la carga de catálogos del formulario de objeto. */
export function initObjetoCatalogos(): void {
  // La ubicación se resuelve con la pasarela de minimapas unificada, que se
  // autoinicializa dentro del componente (SelectorMinimapaUbicacion.astro).
  void cargarUsuarios();
  void cargarCategorias();

  // Recargar las categorías cuando se crea una nueva.
  window.addEventListener('categoriaCreada', () => {
    void cargarCategorias();
  });
}
