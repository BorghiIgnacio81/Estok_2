// =============================================================================
// TAXONOMÍA FÍSICA DE CONTENEDORES (cliente) - única fuente de la clasificación
// -----------------------------------------------------------------------------
// Espejo EXACTO en TypeScript de `inventario/services/taxonomia_contenedor.py`.
// Separa sin ambigüedad las CINCO naturalezas físicas del almacenamiento:
//
//   - CONJUNTO        → conjunto/estructura interna de un mueble (estante,
//                       cajonera, cajón). Estructura pura: NUNCA se lista como
//                       objeto suelto por ubicar.
//   - MUEBLE_INMUEBLE → mueble FIJO adherido a su cuarto (ropero empotrado, PC
//                       Setup, cama cucheta fija). Anclado: no se muda.
//   - MUEBLE_MOVIL    → mueble mudable (ropero espejo, archivador, cama
//                       cucheta). Es un MUEBLE CONTENEDOR: se dibuja como tal
//                       en el lienzo, pero NO es un objeto suelto por ubicar.
//   - CAJA            → contenedor móvil de inventario (caja pequeña). Siempre
//                       movible, contenedora y contenida (ej: «Caja 01»).
//   - OBJETO          → ítem fino suelto, contenido directamente en una
//                       habitación sin mueble (ej: «Cortadora de césped»).
//
// REGLA HERMÉTICA DE LA BANDEJA «por ubicar»: SOLO CAJAS móviles y OBJETOS
// sueltos. Toda estructura fija (CONJUNTO / MUEBLE_INMUEBLE) y todo mueble
// (MUEBLE_MOVIL) queda TERMINANTEMENTE EXCLUIDO, aunque no tenga casillero.
//
// COMPATIBILIDAD LEGACY: los payloads viejos podían traer `tipo='MUEBLE'` o
// `tipo='ESTANTE'`. Se normalizan en vivo para no romper ni una vista:
// 'MUEBLE' → MUEBLE_INMUEBLE si `es_inmueble`, si no MUEBLE_MOVIL; 'ESTANTE' →
// CONJUNTO.
// =============================================================================

export const TIPO_CONJUNTO = 'CONJUNTO';
export const TIPO_MUEBLE_INMUEBLE = 'MUEBLE_INMUEBLE';
export const TIPO_MUEBLE_MOVIL = 'MUEBLE_MOVIL';
export const TIPO_CAJA = 'CAJA';
export const TIPO_OBJETO = 'OBJETO';

/** Los 5 tipos canónicos (whitelist). */
export const TIPOS_FISICOS = [
  TIPO_CONJUNTO,
  TIPO_MUEBLE_INMUEBLE,
  TIPO_MUEBLE_MOVIL,
  TIPO_CAJA,
  TIPO_OBJETO,
] as const;

/** Muebles de la taxonomía (móviles o inmuebles): dueños de su cuadrícula. */
export const TIPOS_MUEBLE = [TIPO_MUEBLE_MOVIL, TIPO_MUEBLE_INMUEBLE] as const;

/** Campos mínimos para clasificar cualquier pieza (payload de la API o local). */
export interface PiezaTaxonomica {
  tipo?: string | null;
  es_inmueble?: boolean | null;
  parent_contenedor?: string | null;
  subcontenedores_count?: number | null;
}

/**
 * Tipo físico normalizado (mayúsculas) tolerando payloads legacy o parciales.
 *
 * `null`/vacío → 'CAJA' (mismo default del modelo `Contenedor`).
 * 'MUEBLE' → MUEBLE_INMUEBLE si `es_inmueble`, si no MUEBLE_MOVIL.
 * 'ESTANTE' → CONJUNTO.
 */
export function tipoFisico(pieza: PiezaTaxonomica | null | undefined): string {
  const crudo = String(pieza?.tipo || '').toUpperCase();
  if (crudo === 'MUEBLE') {
    return pieza?.es_inmueble ? TIPO_MUEBLE_INMUEBLE : TIPO_MUEBLE_MOVIL;
  }
  if (crudo === 'ESTANTE') return TIPO_CONJUNTO;
  return crudo || TIPO_CAJA;
}

/** CAJA móvil: contenido puro del inventario (`tipo='CAJA'` y es_inmueble=false). */
export function esCajaMovil(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoFisico(pieza) === TIPO_CAJA && !pieza?.es_inmueble;
}

/** OBJETO fino suelto: ítem contenido directamente en la habitación o caja. */
export function esObjetoFisico(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoFisico(pieza) === TIPO_OBJETO;
}

/** CONJUNTO: estructura interna de un mueble (estante/cajonera/cajón). */
export function esConjunto(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoFisico(pieza) === TIPO_CONJUNTO;
}

/** MUEBLE (móvil o inmueble): dueño de su cuadrícula de casilleros. */
export function esMueble(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoFisico(pieza) === TIPO_MUEBLE_MOVIL
    || tipoFisico(pieza) === TIPO_MUEBLE_INMUEBLE
    || pieza?.es_inmueble === true;
}

/** MUEBLE inmueble fijo (ropero empotrado, PC Setup, cama fija). */
export function esMuebleInmueble(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoFisico(pieza) === TIPO_MUEBLE_INMUEBLE || pieza?.es_inmueble === true;
}

/**
 * MUEBLE MÓVIL (mudable): ropero espejo, archivador, cama cucheta. Es un mueble
 * CONTENEDOR mudable —el único tipo de mueble admitido en la bandeja lateral de
 * «Elementos por ubicar»— y nunca una estructura fija.
 */
export function esMuebleMovil(pieza: PiezaTaxonomica | null | undefined): boolean {
  return tipoFisico(pieza) === TIPO_MUEBLE_MOVIL && pieza?.es_inmueble !== true;
}

/**
 * ANCLADA: estructura fija que nunca se muda (CONJUNTO o MUEBLE_INMUEBLE).
 * Espejo de `services.taxonomia_contenedor.es_anclado`.
 */
export function esAnclado(pieza: PiezaTaxonomica | null | undefined): boolean {
  if (pieza?.es_inmueble) return true;
  const t = tipoFisico(pieza);
  return t === TIPO_CONJUNTO || t === TIPO_MUEBLE_INMUEBLE;
}

/**
 * ESTRUCTURA INGRESABLE (navegable hacia adentro): un mueble (móvil o inmueble),
 * un CONJUNTO o cualquier contenedor que ya tenga sub-divisiones. Es el criterio
 * con el que el lienzo ABRE el interior de una pieza en vez de tratarla como hoja
 * del inventario (permite bajar de nivel en «PC Setup», «Zona Indoor», etc.).
 */
export function esEstructuraIngresable(pieza: PiezaTaxonomica | null | undefined): boolean {
  return esMueble(pieza)
    || esConjunto(pieza)
    || Number(pieza?.subcontenedores_count) > 0;
}

/**
 * ELEMENTO «POR UBICAR» admisible en la bandeja inferior de Almacenamiento.
 *
 * SOLO cajas móviles y objetos sueltos: ninguna estructura fija, ningún CONJUNTO
 * y ningún mueble (ni móvil ni inmueble) puede aparecer acá, aunque esté sin
 * casillero. El registro espejo (Objeto) de un mueble mudable se excluye aparte
 * por tener `contenedor` asignado.
 */
export function esPiezaPorUbicar(pieza: PiezaTaxonomica | null | undefined): boolean {
  return esCajaMovil(pieza) || esObjetoFisico(pieza);
}

