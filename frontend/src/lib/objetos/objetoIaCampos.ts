// =============================================================================
// MAPEO DE CAMPOS DEVUELTOS POR GEMINI → FORMULARIO DEL OBJETO
// -----------------------------------------------------------------------------
// Módulo compartido por las dos pantallas que autocompletan un objeto con IA:
//   · lib/objetos/objetoAutocompletarIa.ts → /objetos/nuevo (POST analizar_imagen)
//   · lib/editarObjetoIa.ts                → /objetos/<id>/editar (POST analizar_con_ia)
// Centralizar el mapeo evita duplicar la lista de claves y las etiquetas en dos
// flujos distintos (regla de código limpio: una sola fuente de verdad).
//
// El mapeo es DEFENSIVO multi-key: soporta las claves del backend optimizado
// (nombre, descripcion, precio_estimado_mercado, meli_category_id) y sus alias
// (titulo, description, price, categoria_id).
// =============================================================================

/** Etiquetas legibles por clave del payload de IA (para toasts y resumen). */
const ETIQUETAS_CAMPOS: Record<string, string> = {
  nombre: 'Nombre',
  titulo: 'Nombre',
  descripcion: 'Descripción',
  description: 'Descripción',
  categoria: 'Categoría',
  categoria_id: 'Categoría',
  meli_category_id: 'Categoría',
  estado_conservacion: 'Estado',
  color: 'Color',
  precio_estimado_mercado: 'Valor estimado',
  precio: 'Valor estimado',
  price: 'Valor estimado',
  autor: 'Autor',
  marca: 'Marca',
  editorial: 'Editorial',
  idioma: 'Idioma',
  isbn_issn: 'ISBN',
  edicion: 'Edición',
  nombre_serie: 'Serie',
  titulo_tomo: 'Tomo',
  numero_tomo: 'N° de tomo',
  anio: 'Año',
};

/** Claves técnicas que NO son campos del formulario. */
const CLAVES_IGNORADAS = new Set([
  'raw_response',
  'confianza_general',
  'campos_pendientes',
  'motor_utilizado',
]);

/**
 * EQUIVALENCIA TAXONOMÍA LEGADA → NOMBRE OFICIAL de la categoría.
 *
 * El prompt del backend pide `categoria` con la taxonomía histórica
 * (libro|tecnologia|mueble|ropa|arte|computacion|otro) y, además, el
 * `meli_category_id` oficial. Cuando el motor de respaldo no devuelve el ID
 * oficial, la sugerencia debe seguir apareciendo en el combobox: se traduce el
 * token legado al NOMBRE de la categoría sembrada (siempre presente porque el
 * alta del Estok siembra las categorías base).
 */
const CATEGORIA_LEGADA_A_NOMBRE: Record<string, string> = {
  libro: 'Libros',
  tecnologia: 'Electrónica',
  computacion: 'Computación',
  mueble: 'Muebles',
  arte: 'Arte',
  ropa: 'Ropa',
};

/**
 * Vuelca en el formulario los campos devueltos por Gemini.
 * `datos` proviene de `result.datos_ia || result` (alta) o `result.datos`
 * (edición). Los elementos ausentes se omiten sin lanzar errores.
 */
export function aplicarCamposIa(datos: any): void {
  if (!datos || typeof datos !== 'object') return;

  // Nombre
  const nombreInput = document.querySelector<HTMLInputElement>('[name="nombre"]');
  const nombreValor = datos.titulo || datos.nombre || '';
  if (nombreInput && nombreValor) {
    nombreInput.value = nombreValor;
    nombreInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Descripción
  const descripcionInput = document.querySelector<HTMLTextAreaElement>('[name="descripcion"]');
  const descripcionValor = datos.descripcion || datos.description || '';
  if (descripcionInput && descripcionValor) {
    descripcionInput.value = descripcionValor;
    descripcionInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Estado de conservación (solo si la opción existe en el select)
  const estadoSelect = document.querySelector<HTMLSelectElement>('[name="estado_conservacion"]');
  if (estadoSelect && datos.estado_conservacion) {
    if ([...estadoSelect.options].some((o) => o.value === datos.estado_conservacion)) {
      estadoSelect.value = datos.estado_conservacion;
      estadoSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // Color
  const colorInput = document.querySelector<HTMLInputElement>('[name="color"]');
  if (colorInput && datos.color) {
    colorInput.value = datos.color;
    colorInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Categoría (combobox dinámico): el backend puede devolver 'categoria_id'
  // (UUID), 'meli_category_id' (MLAxxxxx) o 'categoria' (nombre). Se selecciona
  // la opción y se dispara 'change' para que el formulario actualice cualquier
  // dependencia del select.
  const categoriaId =
    datos.categoria_id ||
    datos.meli_category_id ||
    (typeof datos.categoria === 'object' && datos.categoria ? datos.categoria.id : null);
  const categoriaNombre =
    typeof datos.categoria === 'string' && datos.categoria.trim()
      ? datos.categoria.trim()
      : null;
  // Si la IA respondió con la taxonomía legada («mueble», «tecnologia»…) se
  // traduce al NOMBRE oficial para que la sugerencia caiga en una opción real.
  const categoriaEquivalente = categoriaNombre
    ? CATEGORIA_LEGADA_A_NOMBRE[categoriaNombre.toLowerCase()] ?? categoriaNombre
    : null;
  if (categoriaId || categoriaEquivalente) {
    const categoriaSelect = document.querySelector<HTMLSelectElement>('[name="categoria"]');
    if (categoriaSelect) {
      const targetId = String(categoriaId ?? '');
      const buscado = categoriaEquivalente?.toLowerCase() ?? '';
      const opt = [...categoriaSelect.options].find(
        (o) =>
          (targetId && (o.value === targetId || o.dataset.meliId === targetId)) ||
          (buscado && o.textContent?.trim().toLowerCase().includes(buscado)),
      );
      if (opt) {
        categoriaSelect.value = opt.value;
        categoriaSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  // Precio estimado de mercado
  const precioInput = document.querySelector<HTMLInputElement>('[name="valor_estimado"]');
  const precioValor = datos.precio_estimado_mercado ?? datos.precio ?? datos.price ?? '';
  if (precioInput && precioValor !== '' && precioValor != null) {
    precioInput.value = String(precioValor);
    precioInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Campos específicos (libros, electrónica, música, etc.).
  const camposEspecificos: Array<[string, unknown]> = [
    ['autor', datos.autor],
    ['marca', datos.marca],
    ['nombre_serie', datos.nombre_serie],
    ['titulo_tomo', datos.titulo_tomo],
    ['numero_tomo', datos.numero_tomo],
    ['editorial', datos.editorial],
    ['idioma', datos.idioma],
    ['isbn_issn', datos.isbn_issn],
    ['edicion', datos.edicion],
  ];
  camposEspecificos.forEach(([nombre, valor]) => {
    if (valor) {
      const el = document.querySelector<HTMLInputElement>(`[name="${nombre}"]`);
      if (el) el.value = String(valor);
    }
  });
}

/** Etiquetas (sin duplicados) de los campos que la IA sí completó. */
export function listarCamposCompletados(datos: any): string[] {
  if (!datos || typeof datos !== 'object') return [];

  const vistos = new Set<string>();
  const etiquetas: string[] = [];

  Object.entries(datos).forEach(([clave, valor]) => {
    if (CLAVES_IGNORADAS.has(clave)) return;
    if (valor === null || valor === undefined || valor === '') return;

    const etiqueta = ETIQUETAS_CAMPOS[clave];
    if (!etiqueta || vistos.has(etiqueta)) return;

    vistos.add(etiqueta);
    etiquetas.push(etiqueta);
  });

  return etiquetas;
}

/** Resumen corto para el toast: «Nombre, Categoría, Estado y 2 más». */
export function resumenCamposCompletados(datos: any, maximo = 6): string {
  const etiquetas = listarCamposCompletados(datos);
  if (etiquetas.length === 0) return '';
  if (etiquetas.length <= maximo) return etiquetas.join(', ');
  return `${etiquetas.slice(0, maximo).join(', ')} y ${etiquetas.length - maximo} más`;
}
