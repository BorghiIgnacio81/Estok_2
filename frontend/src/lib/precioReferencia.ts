// =============================================================================
// PRESENTACIÓN DEL PRECIO DE REFERENCIA (MercadoLibre MLA / estimación IA)
// -----------------------------------------------------------------------------
// Fuente ÚNICA de verdad para interpretar la respuesta de
// GET /api/objetos/buscar_precio_referencia/ (inventario/services/
// precio_referencia_service.py + mercadolibre_busqueda.py).
//
// Por qué existe este módulo (bug real que corrige):
//   El backend migró la búsqueda a MercadoLibre ARGENTINA (site MLA) pineada y
//   su campo `fuente` pasó de "mercadolibre_scraping" a "mercadolibre_mla".
//   Las páginas comparaban ese literal a mano, así que un precio REAL de
//   MercadoLibre se mostraba como estimación de IA (morado/🤖) y se perdía el
//   enlace "Ver en MercadoLibre". Con el literal duplicado en dos páginas
//   (objetos/nuevo y objetos/[id]/editar) el arreglo se desincronizaba otra vez.
//
// Valores posibles de `fuente`:
//   mercadolibre_mla      → precio real de MLA (siempre en ARS).
//   mercadolibre_scraping → valor LEGADO (mismo significado), se acepta.
//   gemini_estimacion     → estimación de IA (sin match validado en MLA).
//
// Valores posibles de `fuente_error` (respuesta controlada, `encontrado=false`):
//   sin_coincidencia → MLA respondió pero ningún título coincide (no se inyecta
//                      el precio de un producto equivocado).
//   error_red        → timeout / bloqueo / falla de conexión.
//   error_interno    → excepción inesperada del viewset.
// =============================================================================

/** true si el precio viene de un resultado REAL de MercadoLibre Argentina. */
export function esFuenteMercadoLibre(fuente?: string | null): boolean {
  return fuente === 'mercadolibre_mla' || fuente === 'mercadolibre_scraping';
}

/**
 * Mensaje para mostrar cuando el backend devolvió `encontrado = false`.
 * Diferencia el error controlado (red caída / error interno) de la simple
 * ausencia de coincidencia confiable, en lugar de un texto genérico.
 */
export function mensajeSinPrecio(fuenteError?: string | null): string {
  if (fuenteError === 'error_red') {
    return '❌ No se pudo consultar MercadoLibre (problema de red o bloqueo temporal). Intentá de nuevo en unos minutos.';
  }
  if (fuenteError === 'error_interno') {
    return '❌ Error interno al buscar el precio de referencia. Intentá de nuevo.';
  }
  return '💡 No se encontró un precio de referencia confiable en MercadoLibre Argentina para este objeto.';
}
