// =============================================================================
// ESPACIOS VIRTUALES / DE SISTEMA Y GEOMETRÍA VÁLIDA DE PLANO
// -----------------------------------------------------------------------------
// FUENTE ÚNICA en el frontend del concepto «espacio virtual». Es el espejo de
// `inventario/services/mudanza_service.py` → NOMBRES_LIMBO:
//
//   · «En Tránsito» / «Zona de Mudanza» es una Ubicación VIRTUAL del tablero de
//     mudanzas (limbo), NO un ambiente físico del plano. Se crea con
//     `grid_filas=1`, `grid_columnas=1` y SIN geometría `ui_*` explícita, así
//     que el motor de minimapas le aplica una caja por defecto de 100%×24% que
//     TAPA el plano. Debe renderizarse FUERA del lienzo, como tarjeta propia.
//
//   · Cualquier otro espacio de sistema con coordenadas no asignadas tampoco
//     debe dibujarse: `tieneGeometriaPlano()` exige las CUATRO medidas `ui_*`
//     como porcentajes explícitos y válidos (width/height > 0).
//
// El backend expone además `es_espacio_virtual` en UbicacionSerializer, de modo
// que el criterio no depende sólo del nombre. El fallback por nombre cubre los
// payloads viejos y los catálogos cacheados antes de este cambio.
// =============================================================================

/** Nombres normalizados del limbo de mudanza (sin acentos, minúsculas). */
export const NOMBRES_ESPACIO_VIRTUAL = ['en transito', 'zona de mudanza'] as const;

/** Estructura mínima para clasificar un espacio (UbicacionPlano es compatible). */
export interface EspacioConGeometria {
  nombre?: string | null;
  /** Flag autoritativo del backend (UbicacionSerializer.es_espacio_virtual). */
  es_espacio_virtual?: boolean;
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
}

/** Normaliza un nombre para comparar sin acentos ni mayúsculas. */
function normalizarNombre(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * ¿Es un espacio VIRTUAL/de sistema que NUNCA debe dibujarse en un plano?
 * Prioriza el flag del backend y cae al nombre canónico del limbo.
 */
export function esEspacioVirtual(
  espacio: EspacioConGeometria | null | undefined,
): boolean {
  if (!espacio) return false;
  if (espacio.es_espacio_virtual === true) return true;
  const nombre = normalizarNombre(String(espacio.nombre ?? ''));
  return (NOMBRES_ESPACIO_VIRTUAL as readonly string[]).includes(nombre);
}

/**
 * Valor porcentual explícito de una medida `ui_*` (ej: '12%' → 12).
 * Devuelve null si el token NO es un porcentaje válido ('auto', '', '210px'
 * no son coordenadas físicas del canvas porcentual).
 */
export function pctExplicito(valor: string | null | undefined): number | null {
  const token = String(valor ?? '').trim();
  const match = /^(-?\d{1,3}(?:\.\d+)?)%$/.exec(token);
  if (!match) return null;
  const numero = parseFloat(match[1]);
  if (!Number.isFinite(numero)) return null;
  return Math.max(0, Math.min(100, numero));
}

/**
 * ¿El espacio tiene coordenadas FÍSICAS explícitas y válidas para el plano?
 * Se exigen las cuatro medidas porcentuales y un área mayor que cero. Un
 * espacio recién creado (ui_height 'auto' por defecto) NO cumple: el lienzo de
 * selección de objetos no debe inventarle una caja que tape a los ambientes
 * reales. Los editores de modelado siguen usando su propia cascada de defaults.
 */
export function tieneGeometriaPlano(
  espacio: EspacioConGeometria | null | undefined,
): boolean {
  if (!espacio) return false;
  const left = pctExplicito(espacio.ui_left);
  const top = pctExplicito(espacio.ui_top);
  const width = pctExplicito(espacio.ui_width);
  const height = pctExplicito(espacio.ui_height);
  return (
    left !== null &&
    top !== null &&
    width !== null &&
    height !== null &&
    width > 0 &&
    height > 0
  );
}

/** Habitación dibujable: ni virtual ni con geometría pendiente. */
export function esHabitacionDibujable(
  espacio: EspacioConGeometria | null | undefined,
): boolean {
  return !esEspacioVirtual(espacio) && tieneGeometriaPlano(espacio);
}

/**
 * Espacio virtual «En Tránsito» del Estok (limbo de mudanza), si está cargado.
 * Se usa para la tarjeta externa al plano y para restaurar una selección
 * guardada en el limbo.
 */
export function ubicacionVirtual<T extends EspacioConGeometria>(
  ubicaciones: T[] | null | undefined,
): T | null {
  return (ubicaciones ?? []).find((u) => esEspacioVirtual(u)) ?? null;
}
