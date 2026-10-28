// =============================================================================
// CAMPOS PATRIMONIALES DEL OBJETO — FUENTE ÚNICA (módulo PURO)
// -----------------------------------------------------------------------------
// Lista canónica de los datos patrimoniales adicionales de un Objeto y su
// presentación en el panel del espacio declarado / modal:
//   · `patrimonialesPanelHtml()` → markup con clases `.portal-objeto-campo` y
//     atributo `data-objeto-campo` (lectura/escritura por clave).
// La EDICIÓN de objetos ya no usa esta lista plana: filtra los atributos por
// categoría con lib/objetos/objetoCamposEspecificos.ts.
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

