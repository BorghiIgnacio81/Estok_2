// =============================================================================
// TAXONOMÍA DE CONTENEDORES (cliente) - única fuente de la clasificación
// -----------------------------------------------------------------------------
// Espejo en TypeScript de `inventario/services/taxonomia_contenedor.py`.
// Separa sin ambigüedad las tres naturalezas físicas del almacenamiento:
//
//   - MUEBLE  → estructura grande (raíz o mueble inmueble fijo): DUEÑA de su
//               cuadrícula de divisiones.
//   - CAJA    → contenedor pequeño MÓVIL: CONTENIDO del inventario. Nunca una
//               división estructural del mueble que lo guarda.
//   - ESTANTE → división/cajón interno: estructura PURA Y EXCLUSIVA del mueble
//               que la contiene (mapea coordenadas y resalta el minimapa).
//
// REGLA DE ORO (espejo del backend): una CAJA móvil soltada dentro de un mueble
// o de una de sus divisiones se guarda como CONTENIDO hijo dentro de la
// división/estante seleccionado y JAMÁS altera la cuadrícula de divisiones del
// mueble, ni se dibuja como un bloque divisorio extra.
// =============================================================================

/** Campos mínimos para clasificar cualquier contenedor (payload de la API). */
export interface PiezaTaxonomica {
  tipo?: string | null;
  es_inmueble?: boolean | null;
}

const TIPO_CAJA = 'CAJA';

/** Tipo normalizado a mayúsculas (tolerante a payloads parciales o legacy). */
function tipoDeContenedor(pieza: PiezaTaxonomica | null | undefined): string {
  return String(pieza?.tipo || '').toUpperCase();
}

/**
 * CAJA móvil: contenido puro del inventario.
 *
 * `tipo='CAJA'` y `es_inmueble=false`. Es el ÚNICO filtro que decide que una
 * pieza NO es una división estructural de un mueble: su Drop nunca escribe
 * coordenadas de casillero y su render nunca ocupa una celda de la cuadrícula.
 */
export function esCajaMovil(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoDeContenedor(pieza) === TIPO_CAJA && !pieza?.es_inmueble;
}
