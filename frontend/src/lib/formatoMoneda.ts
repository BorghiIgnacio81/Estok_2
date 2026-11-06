// =============================================================================
// FORMATEO DE MONEDA — helper ÚNICO del frontend
// -----------------------------------------------------------------------------
// Los importes del backend llegan como decimales en string («1234.56») o como
// number. Todas las pantallas muestran el MISMO formato es-AR: «$1.234,56».
//
// Antes cada módulo (tarjetas de Decisiones, escáner QR, modal de publicación)
// repetía su propio formateador con pequeñas variantes. Ahora viven acá y los
// módulos importan (re-exportando con su nombre histórico cuando lo exponían).
//
// Módulo 100% puro y sin dependencias: sirve en cliente y en frontmatter SSR.
// =============================================================================

/** Valor sin importe (nulo, vacío o no numérico) que muestran las tarjetas. */
export const SIN_VALOR_MONETARIO = '—';

/**
 * Importe con formato es-AR («$1.234,56») o el guion de «sin valor».
 *
 * - `null` / `undefined` / `''` → `—`
 * - valor no numérico            → `—`
 * - el resto                     → `$` + separador de miles + 2 decimales
 */
export function formatearMoneda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return SIN_VALOR_MONETARIO;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return SIN_VALOR_MONETARIO;
  return `$${numero.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}
