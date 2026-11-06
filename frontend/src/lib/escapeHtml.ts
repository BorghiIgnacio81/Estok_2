// =============================================================================
// ESCAPADO HTML — helper ÚNICO del frontend
// -----------------------------------------------------------------------------
// Todo texto que se interpola en plantillas HTML (tarjetas, listados, fichas,
// paneles del Admin Global, minimapas) viene de la base de datos y es editable
// por el usuario: SIEMPRE se escapa antes de inyectarse.
//
// Antes cada módulo declaraba su propia copia (`escapeHtml`, `escapar`,
// `escaparHtml`, `esc`) con el mismo cuerpo repetido en más de una docena de
// archivos. Ahora viven acá y los módulos importan (y, cuando su API pública lo
// expone, re-exportan con el nombre histórico para no tocar los consumidores).
//
// Módulo 100% puro y sin dependencias: sirve en cliente y en frontmatter SSR.
// =============================================================================

/**
 * Escapa `& < > " '` para interpolar el valor dentro de HTML (texto o atributo).
 * Un valor nulo/indefinido se convierte en cadena vacía (nunca «undefined»).
 */
export function escapeHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
