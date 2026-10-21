// =============================================================================
// CAMPOS PATRIMONIALES DEL OBJETO — FUENTE ÚNICA (módulo PURO)
// -----------------------------------------------------------------------------
// Lista canónica de los datos patrimoniales adicionales de un Objeto y sus DOS
// presentaciones:
//   · `patrimonialesPanelHtml()`    → panel del espacio declarado / modal
//     (clases `.portal-objeto-campo`, atributo `data-objeto-campo`).
//   · `patrimonialesTailwindHtml()` → página de edición de objeto
//     (`id`/`name` para el FormData del formulario + clases Tailwind).
//
// Sin imports: puede usarse tanto en el cliente como en el frontmatter SSR de
// Astro sin arrastrar servicios de navegador.
// =============================================================================

/** Metadatos de un campo patrimonial del Objeto. */
export interface CampoPatrimonial {
  clave: string;
  etiqueta: string;
  placeholder: string;
  tipo?: string;
}

/** Campos patrimoniales adicionales (todos opcionales). */
export const CAMPOS_PATRIMONIALES: CampoPatrimonial[] = [
  { clave: 'material', etiqueta: 'Material', placeholder: 'Madera, metal, vidrio…' },
  { clave: 'color', etiqueta: 'Color', placeholder: 'Ej: Nogal' },
  { clave: 'marca', etiqueta: 'Marca', placeholder: 'Ej: Siemens' },
  { clave: 'modelo', etiqueta: 'Modelo', placeholder: 'Ej: KA92' },
  { clave: 'numero_serie', etiqueta: 'N.º de serie', placeholder: 'Serie del fabricante' },
  { clave: 'autor', etiqueta: 'Autor', placeholder: 'Autor o diseñador' },
  { clave: 'anio', etiqueta: 'Año', placeholder: '1998', tipo: 'number' },
  { clave: 'artista_fabricante', etiqueta: 'Artista / Fabricante', placeholder: 'Taller o artista' },
  { clave: 'tamano', etiqueta: 'Tamaño', placeholder: 'Ej: 180×90 cm' },
];

/**
 * Markup para el panel del espacio / modal (CSS `.portal-objeto-campo`).
 * El valor se lee y escribe por `data-objeto-campo`.
 */
export function patrimonialesPanelHtml(): string {
  return CAMPOS_PATRIMONIALES
    .map((c) => `<label class="portal-objeto-campo">
        <span>${c.etiqueta}</span>
        <input type="${c.tipo || 'text'}" data-objeto-campo="${c.clave}" placeholder="${c.placeholder}" />
      </label>`)
    .join('');
}

/**
 * Markup para la página de edición de objeto (clases Tailwind).
 * Usa `id`/`name` iguales a la clave del modelo, de modo que `FormData(form)`
 * los envía al PUT y `setFieldValue(clave, valor)` los precarga sin lógica
 * adicional.
 *
 * `excluir` permite omitir campos que la página ya renderiza por su cuenta
 * (p. ej. `color`, que vive en la sección Información Básica).
 */
export function patrimonialesTailwindHtml(excluir: string[] = []): string {
  return CAMPOS_PATRIMONIALES
    .filter((c) => !excluir.includes(c.clave))
    .map((c) => `<div>
        <label for="${c.clave}" class="block text-sm font-medium text-gray-700 mb-1">${c.etiqueta}</label>
        <input id="${c.clave}" name="${c.clave}" type="${c.tipo || 'text'}" placeholder="${c.placeholder}"
          class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-base text-base" />
      </div>`)
    .join('');
}
