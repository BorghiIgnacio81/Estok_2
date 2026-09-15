// =============================================================================
// GEOMETRÍA DE SECTORES PROPORCIONALES (común a los renders de minimapa)
// -----------------------------------------------------------------------------
// Valida la geometría REAL de un espacio (ui_left/ui_top/ui_width/ui_height en %
// del lienzo persistidos en PostgreSQL) y la acota al perímetro del lienzo:
// NINGÚN sector puede desbordar las paredes (borde derecho/inferior).
//
// Vive en su propio módulo para que el render SVG (minimapa.ts) y el render HTML
// por porcentajes CSS (minimapaSectoresHtml.ts) compartan EXACTAMENTE el mismo
// acotado, sin acoplar un módulo de dibujo con el otro y manteniendo cada
// archivo bajo el límite de modularidad del proyecto. 100% puro.
// =============================================================================

/** Geometría mínima de un sector proporcional (porcentajes 0..100 del lienzo). */
export interface SectorGeometrico {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Sector activo: se pinta en naranja (#f97316). */
  activo?: boolean;
  /** Icono contextual opcional (🚽 🛏️ 🗄️ 🏠) dibujado en miniatura. */
  icono?: string | null;
  /** Nombre legible del sector (tooltip / descripción accesible). */
  nombre?: string | null;
}

/** Sector ya validado y acotado al perímetro real del lienzo (0..100 %). */
export interface SectorAcotado {
  left: number;
  top: number;
  width: number;
  height: number;
  activo: boolean;
  icono: string;
  nombre: string;
}

function acotar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Descarta los sectores sin geometría válida y recorta los que se salen del
 * lienzo. Conserva el orden de entrada (importante: los iconos y tooltips se
 * resuelven por índice/identidad en el módulo que arma los sectores).
 */
export function sectoresAcotados(
  sectores: readonly SectorGeometrico[] | null | undefined,
): SectorAcotado[] {
  return (sectores ?? [])
    .filter((s) => Number.isFinite(s.left) && Number.isFinite(s.top) && s.width > 0 && s.height > 0)
    .map((s) => {
      const left = acotar(s.left, 0, 100);
      const top = acotar(s.top, 0, 100);
      return {
        left,
        top,
        width: acotar(s.width, 0, 100 - left),
        height: acotar(s.height, 0, 100 - top),
        activo: s.activo === true,
        icono: s.icono ?? '',
        nombre: s.nombre ?? '',
      };
    });
}
