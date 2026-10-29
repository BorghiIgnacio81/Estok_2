// =============================================================================
// DOMINIO DEL LIENZO «MAPA ESTOK» (derivaciones PURAS)
// -----------------------------------------------------------------------------
// Funciones PURAS: reciben el estado por parámetro y devuelven derivaciones.
// Ninguna toca el DOM, hace fetch ni conoce Tailwind (límite < 400 líneas).
// =============================================================================

import { ETIQUETAS_PISO, PISO_PRIMERO, PISO_BAJA } from '../mapaJerarquico';
import type { EstokConfig, UbicacionPlano } from '../mapaJerarquico';
// Espacios VIRTUALES de sistema (limbo «En Tránsito»): nunca son habitaciones.
import { esEspacioVirtual } from '../ubicacionesVirtuales';

/**
 * Cantidad de PLANTAS REGISTRADAS en el Estok activo: divisiones raíz reales del
 * macro-plano (una por planta). Es la fuente de verdad de la bifurcación del
 * modelador y NO depende del campo individual `cantidad_pisos`, que puede quedar
 * desincronizado cuando el inmueble suma plantas después del alta.
 */
export function plantasRegistradas(divisiones: UbicacionPlano[]): number {
  return divisiones.filter((d) => !esEspacioVirtual(d)).length;
}

/**
 * Total de plantas del inmueble: máximo entre la grilla del Estok, la fila más
 * alta dibujada y la CANTIDAD REAL de divisiones registradas (si la estructura
 * tiene más plantas que las declaradas, la silueta las muestra igual).
 */
export function totalPlantas(estok: EstokConfig | null, divisiones: UbicacionPlano[]): number {
  const desdeDatos = divisiones.reduce(
    (max, d) => Math.max(max, d.parent_grid_row || 1),
    1,
  );
  return Math.max(
    estok?.grid_filas || desdeDatos,
    desdeDatos,
    plantasRegistradas(divisiones),
  );
}

/**
 * ¿El Estok activo es de 1 sola planta? → Modo Planta Única (sin techo).
 *
 * REGRESIÓN CORREGIDA (cartel «Planta Única»): la decisión se toma por el TOTAL
 * DE PLANTAS REGISTRADAS. Con 2 o más divisiones reales (caso «Casa Federación»)
 * el lienzo entra SIEMPRE en Modo Casa y el panel izquierdo muestra el
 * selector/minimapa de plantas, aunque el campo individual `cantidad_pisos` /
 * `tipo_layout` diga 1. Sólo con 0 o 1 planta registrada se cae al dato del
 * Estok (0 = todavía sin estructura, se respeta el modo declarado).
 */
export function esPlantaUnica(
  estok: EstokConfig | null,
  divisiones: UbicacionPlano[] = [],
): boolean {
  if (plantasRegistradas(divisiones) > 1) return false;
  if (!estok) return false;
  const cantidad = Number(estok.cantidad_pisos) || 0;
  if (cantidad > 0) return cantidad <= 1;
  return estok.tipo_layout !== 'CASA_2_PISOS';
}

/** División contenedora del departamento (la planta 1 del macro-plano). */
export function apartamentoDePlantaUnica(divisiones: UbicacionPlano[]): UbicacionPlano | null {
  return divisiones.find((d) => d.parent_grid_row === 1) ?? divisiones[0] ?? null;
}

/** Espacios libres inyectados dentro del contenedor del departamento. */
export function roomsDePlantaUnica(
  divisiones: UbicacionPlano[],
  habitaciones: UbicacionPlano[],
): UbicacionPlano[] {
  const apartamento = apartamentoDePlantaUnica(divisiones);
  if (!apartamento) return [];
  return habitaciones.filter(
    (h) => h.parent_ubicacion === apartamento.id && !esEspacioVirtual(h),
  );
}

/** Nombre de una planta (nombre real de su división o etiqueta canónica de piso). */
export function nombreDePlanta(divisiones: UbicacionPlano[], fila: number): string {
  const div = divisiones.find((d) => d.parent_grid_row === fila);
  if (div) return div.nombre;
  if (fila === 1) return ETIQUETAS_PISO[PISO_PRIMERO];
  if (fila === 2) return ETIQUETAS_PISO[PISO_BAJA];
  return `División ${fila}`;
}

/** Habitaciones de una planta: encastradas en su división + sueltas legacy. */
export function habitacionesDePlanta(
  divisiones: UbicacionPlano[],
  habitaciones: UbicacionPlano[],
  fila: number,
): UbicacionPlano[] {
  const div = divisiones.find((d) => d.parent_grid_row === fila);
  const divisionId = div?.id ?? '__sin_division__';
  const reales = habitaciones.filter((h) => !esEspacioVirtual(h));
  const encastradas = reales.filter((h) => h.parent_ubicacion === divisionId);
  const sueltas = reales.filter((h) => !h.parent_ubicacion && h.parent_grid_row === fila);
  return [...encastradas, ...sueltas].sort((a, b) => {
    const ra = a.parent_grid_row || 0;
    const rb = b.parent_grid_row || 0;
    const ca = a.parent_grid_col || 0;
    const cb = b.parent_grid_col || 0;
    return ra - rb || ca - cb;
  });
}
