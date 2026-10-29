// =============================================================================
// CATEGORÍA SELECCIONADA EN EL FORMULARIO DE OBJETO
// -----------------------------------------------------------------------------
// Fuente ÚNICA del valor `categoria` que se envía a
// GET /objetos/buscar_precio_referencia/. Se centraliza acá porque lo usan las
// DOS pantallas que cotizan (alta de objetos y edición) y ambas deben mandar
// exactamente el mismo valor: duplicar la lectura del combo fue el patrón que
// ya generó desincronizaciones en este proyecto.
//
// Por qué importa la categoría (bug real): sin ella, la búsqueda en Mercado
// Libre viajaba sólo con `q` y para objetos de «Ropa» devolvía listados
// irrelevantes o vacíos. El backend resuelve este valor al `category_id`
// oficial (inventario/services/mercadolibre_categorias.py) y, si la búsqueda
// filtrada no trae ítems, reintenta sin filtro.
//
// Precedencia del dato MÁS PRECISO disponible en el combo `#categoria`:
//   1. `data-meli-id` (MLA1430)   → alta de objetos (lib/objetos/objetoCatalogos).
//   2. `data-subtipo` (ropa, libro, tecnologia, mueble_arte) → ambos formularios.
//   3. el texto visible sin el icono («👕 Ropa» → «Ropa»).
// =============================================================================

/** Texto del combo sin iconos ni signos («👕 Ropa» → «Ropa»). */
function textoCategoriaLimpio(texto: string): string {
  return texto.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9\s]/g, '').trim();
}

/**
 * Categoría del combo `#categoria` lista para viajar como `categoria` en la
 * query string. Devuelve '' cuando no hay combo, no hay selección o la opción
 * es «Sin categoría» (el backend busca entonces sin filtro).
 */
export function categoriaSeleccionadaParaBusqueda(): string {
  const select = document.getElementById('categoria') as HTMLSelectElement | null;
  const opcion = select?.selectedOptions?.[0];
  if (!opcion) return '';

  const meliId = (opcion.dataset.meliId || '').trim();
  if (meliId) return meliId;

  const subtipo = (opcion.dataset.subtipo || '').trim();
  if (subtipo) return subtipo;

  return textoCategoriaLimpio(opcion.textContent || '');
}
