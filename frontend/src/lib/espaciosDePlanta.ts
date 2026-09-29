// =============================================================================
// ESPACIOS DE PLANTA - MAPEO CANÓNICO DE DIVISIONES ⇄ HABITACIONES
// -----------------------------------------------------------------------------
// Derivaciones PURAS del árbol espacial del Estok activo. Es el ÚNICO lugar
// donde se decide el mapeo iterativo que alimenta los planos:
//
//   1) DIVISIÓN de planta  → `esDivisionUbicacion` (lib/mapaJerarquico.ts):
//                            `parent_grid_row` definido Y sin `parent_ubicacion`.
//   2) HABITACIÓN          → el resto de las Ubicaciones del Estok activo.
//   3) PLANTAS del inmueble→ filas REALES con estructura o ambientes (nunca
//                            cajones vacíos inventados).
//   4) AMBIENTES de la planta `f`:
//        - ENCASTADAS: `parent_ubicacion === division.id` (relación padre real,
//          `parent_grid_row = f` en la división),
//        - SUELTAS legacy: `parent_ubicacion` nulo y `parent_grid_row === f`,
//      ordenadas por (fila, columna) — EXACTAMENTE como el lienzo central.
//
// FÍSICA ÚNICA: la geometría nativa (`ui_left`/`ui_top`/`ui_width`/`ui_height`
// persistidos en PostgreSQL) de esos ambientes la consume el motor global de
// minimapas (lib/sectoresMinimapa.ts → sectoresDeItems), tanto en Almacenamiento
// como en el alta/edición de Objetos. Por eso el plano del formulario de objetos
// es IDÉNTICO al de la sección central, con las mismas líneas divisorias negras
// y el ambiente actual en NARANJA (#f97316).
//
// Espejo canónico de: lib/mapaCasitaNavegable.ts (cargarDatos /
// habitacionesDePlanta / apartamentoDePlantaUnica / roomsDePlantaUnica) y
// lib/visorHabitacion.ts (cargarDivisionesIniciales / habitacionesDeDivision).
//
// DEUDA TÉCNICA (no tocar sin pedido explícito): mapaCasitaNavegable.ts conserva
// copias locales equivalentes de estas derivaciones. Migrarlas a este módulo es
// una tarea de limpieza independiente: este cambio NO altera Almacenamiento.
//
// 100% puro: no dibuja, no hace fetch y no toca el DOM.
// =============================================================================

import { esDivisionUbicacion, ETIQUETAS_PISO, PISO_PRIMERO, PISO_BAJA } from './mapaJerarquico';
import type { EstokConfig, UbicacionPlano } from './mapaJerarquico';

/** Planta navegable del inmueble: fila 1-based + división real (si existe). */
export interface PlantaDisponible {
  /** Fila de la planta (1-based): clave canónica de `parent_grid_row`. */
  fila: number;
  /** Nombre real de la división de esa fila, o etiqueta genérica si no hay. */
  etiqueta: string;
  /** División (Ubicación con `parent_grid_row`) que estructura la planta. */
  division: UbicacionPlano | null;
}

/** Partición canónica de las Ubicaciones del Estok activo. */
export interface EspaciosEstok {
  /** Divisiones de primer nivel (plantas). */
  divisiones: UbicacionPlano[];
  /** Habitaciones: encastradas en una división + sueltas legacy. */
  habitaciones: UbicacionPlano[];
}

/** Fila (1-based) de la división: `parent_grid_row` acotado a 1+. */
function filaDe(ubicacion: UbicacionPlano | null | undefined): number {
  const n = Math.floor(Number(ubicacion?.parent_grid_row));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Divisiones (plantas) y habitaciones del Estok: partición canónica 1:1. */
export function dividirEspacios(
  ubicaciones: UbicacionPlano[] | null | undefined,
): EspaciosEstok {
  const lista = ubicaciones ?? [];
  return {
    divisiones: lista.filter((u) => esDivisionUbicacion(u)).sort((a, b) => filaDe(a) - filaDe(b)),
    habitaciones: lista.filter((u) => !esDivisionUbicacion(u)),
  };
}


/** Nombre de la planta `fila`: división real o etiqueta genérica de piso. */
export function etiquetaDeFila(divisiones: UbicacionPlano[], fila: number): string {
  const div = divisiones.find((d) => filaDe(d) === fila);
  if (div) return div.nombre;
  if (fila === 1) return ETIQUETAS_PISO[PISO_PRIMERO];
  if (fila === 2) return ETIQUETAS_PISO[PISO_BAJA];
  return `División ${fila}`;
}

/**
 * Fila de la planta a la que pertenece una Ubicación: la de su DIVISIÓN padre si
 * está encastrada, o su propia `parent_grid_row` si es una habitación suelta.
 */
export function filaDeUbicacion(
  divisiones: UbicacionPlano[],
  habitacion: UbicacionPlano | null | undefined,
): number {
  if (!habitacion) return 1;
  if (habitacion.parent_ubicacion) {
    const div = divisiones.find((d) => String(d.id) === String(habitacion.parent_ubicacion));
    return div ? filaDe(div) : filaDe(habitacion);
  }
  return filaDe(habitacion);
}

/**
 * AMBIENTES de una planta: habitaciones encastradas en su división + sueltas
 * legacy de esa fila, ordenadas por (fila, columna). Misma física que el lienzo
 * central de Almacenamiento (mapaCasitaNavegable → habitacionesDePlanta).
 */
export function habitacionesDeFila(espacios: EspaciosEstok, fila: number): UbicacionPlano[] {
  const division = espacios.divisiones.find((d) => filaDe(d) === fila);
  const divisionId = division ? String(division.id) : '__sin_division__';
  const encastradas = espacios.habitaciones.filter(
    (h) => String(h.parent_ubicacion || '') === divisionId,
  );
  const sueltas = espacios.habitaciones.filter((h) => !h.parent_ubicacion && filaDe(h) === fila);
  return [...encastradas, ...sueltas].sort(
    (a, b) =>
      filaDe(a) - filaDe(b) ||
      (Math.floor(Number(a.parent_grid_col)) || 0) - (Math.floor(Number(b.parent_grid_col)) || 0),
  );
}

/**
 * Plantas navegables REALES del inmueble (fila + división + etiqueta).
 *
 * Solo se listan las filas que tienen estructura o ambientes: nunca se inventa un
 * cajón vacío «1er piso» / «Planta 2» sin contenido. La fila 1 siempre existe
 * como clave de arranque para que el componente tenga una planta activa válida.
 */
export function plantasDe(
  estok: EstokConfig | null,
  ubicaciones: UbicacionPlano[] | null | undefined,
): PlantaDisponible[] {
  const espacios = dividirEspacios(ubicaciones);
  const filas = new Set<number>();

  espacios.divisiones.forEach((d) => filas.add(filaDe(d)));
  espacios.habitaciones.forEach((h) => filas.add(filaDeUbicacion(espacios.divisiones, h)));

  // `grid_filas` del Estok solo aporta la fila 1 cuando aún no hay nada cargado.
  if (!filas.size) filas.add(Math.max(1, Math.floor(Number(estok?.grid_filas)) || 1));

  return [...filas].sort((a, b) => a - b).map((fila) => ({
    fila,
    etiqueta: etiquetaDeFila(espacios.divisiones, fila),
    division: espacios.divisiones.find((d) => filaDe(d) === fila) ?? null,
  }));
}
