// =============================================================================
// SECTORES DE MINIMAPA A PARTIR DE GEOMETRÍA REAL (ui_*)
// -----------------------------------------------------------------------------
// Traduce una lista de espacios (habitaciones de una planta, muebles de una
// habitación, estantes de un mueble) a los sectores proporcionales que consume
// minimapaSectoresSvg: cada sector conserva su ANCHO/ALTO real expresado en % del
// lienzo (ui_width/ui_height), de modo que el minimapa no dibuje celdas idénticas.
//
// Los valores por defecto replican EXACTAMENTE la cascada de `geoDe`
// (mapaPlantaUnica.ts) para que un espacio todavía sin geometría persistida se
// ubique igual en el lienzo y en el minimapa. 100% puro (sin estado ni DOM).
// =============================================================================

import { pctValor } from './mapaPlantaUnica';
import type { SectorMinimapa } from './minimapa';

/** Geometría mínima que necesita un ítem para posicionarse en un minimapa. */
export interface ItemGeometria {
  id?: string | null;
  /** Nombre legible del ítem (tooltip / icono contextual). */
  nombre?: string | null;
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
}

const ANCHO_DEFECTO = 28;
const ALTO_DEFECTO = 24;

/**
 * Sectores proporcionales de una lista de ítems.
 * `activoId` marca el sector que se pintará en naranja (#f97316).
 * `iconoDe` (opcional) resuelve el icono contextual de cada ítem (🚽 🛏️ 🗄️ 🏠):
 * se centraliza aquí para que TODOS los minimapas usen el mismo criterio.
 */
export function sectoresDeItems(
  items: ItemGeometria[] | null | undefined,
  activoId?: string | null,
  iconoDe?: (item: ItemGeometria) => string | null,
): SectorMinimapa[] {
  const lista = items ?? [];
  return lista.map((item, i) => {
    const ancho = pctValor(item.ui_width, ANCHO_DEFECTO);
    const alto = pctValor(item.ui_height, ALTO_DEFECTO);
    return {
      left: pctValor(item.ui_left, 6 + (i % 5) * 12),
      top: pctValor(item.ui_top, 8 + (i % 4) * 16),
      width: ancho > 0 ? ancho : ANCHO_DEFECTO,
      height: alto > 0 ? alto : ALTO_DEFECTO,
      activo: Boolean(activoId) && item.id === activoId,
      nombre: item.nombre ?? '',
      icono: iconoDe ? iconoDe(item) : '',
    };
  });
}
