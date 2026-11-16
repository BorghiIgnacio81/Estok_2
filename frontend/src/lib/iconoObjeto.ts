// =============================================================================
// ICONO CANÓNICO DE UN OBJETO SEGÚN SU CATEGORÍA (fuente única)
// -----------------------------------------------------------------------------
// Regla visual ÚNICA de las listas y de los paneles de la app:
//   · /fluffy-objeto.webp → OBJETOS GENERALES / SUELTOS: cualquier ítem cuya
//     categoría NO pertenezca a la familia «Muebles».
//   · /mueble.webp        → ÚNICAMENTE los ítems de categoría «Muebles»
//     («Muebles», «Muebles y Estructuras Móviles» y sus variantes).
//
// El criterio replica inventario/services/categorias_clasificacion.py
// (`es_categoria_mueble`), fuente única del backend: normalización a
// minúsculas, sin tildes y con espacios colapsados. La API ya expone
// `categoria_slug` con ESA MISMA normalización; cuando viene se usa tal cual y
// sólo se normaliza `categoria_nombre` como respaldo.
// =============================================================================

import { ASSET_FOTO_OBJETO, ASSET_MUEBLE } from './assetsUi';

/** Nombres normalizados de la familia «Muebles» (espejo del backend). */
const NOMBRES_CATEGORIA_MUEBLE = new Set([
  'muebles',
  'mueble',
  'muebles y estructuras moviles',
  'muebles y estructura movil',
  'mueble y estructuras moviles',
  'mueble y estructura movil',
]);

/** Nombre de categoría normalizado: minúsculas, sin tildes y espacios colapsados. */
export function normalizarCategoria(nombre: string | null | undefined): string {
  return String(nombre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .join(' ');
}

/** ¿La categoría pertenece a la familia «Muebles»? */
export function esCategoriaMueble(
  categoriaNombre: string | null | undefined,
  categoriaSlug: string | null | undefined = null,
): boolean {
  return NOMBRES_CATEGORIA_MUEBLE.has(normalizarCategoria(categoriaSlug || categoriaNombre));
}

/**
 * Imagen canónica del ícono de un OBJETO:
 *   · categoría «Muebles» → /mueble.webp
 *   · cualquier otra      → /fluffy-objeto.webp
 */
export function iconoDeObjeto(
  categoriaNombre: string | null | undefined,
  categoriaSlug: string | null | undefined = null,
): string {
  return esCategoriaMueble(categoriaNombre, categoriaSlug) ? ASSET_MUEBLE : ASSET_FOTO_OBJETO;
}
