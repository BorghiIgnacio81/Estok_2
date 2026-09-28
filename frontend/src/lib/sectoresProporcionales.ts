// =============================================================================
// GEOMETRÍA DE SECTORES PROPORCIONALES (común a los renders de minimapa)
// -----------------------------------------------------------------------------
// Valida la geometría REAL de un espacio (ui_left/ui_top/ui_width/ui_height en %
// del lienzo persistidos en PostgreSQL) y la acota al perímetro del lienzo:
// NINGÚN sector puede desbordar las paredes (borde derecho/inferior).
//
// Vive en su propio módulo para que el render SVG (minimapa.ts) y cualquier
// otro consumidor de la geometría compartan EXACTAMENTE el mismo acotado, sin
// acoplar los módulos de dibujo entre sí y manteniendo cada archivo bajo el
// límite de modularidad del proyecto. 100% puro.
// =============================================================================

import type { CajaBloque } from './plantaFusionSilueta';

/** Geometría mínima de un sector proporcional (porcentajes 0..100 del lienzo). */
export interface SectorGeometrico {
  left: number;
  top: number;
  width: number;
  height: number;
  /** ID del espacio real (Ubicación o Contenedor) que representa el sector. */
  id?: string | null;
  /** Sector activo: se pinta en naranja (#f97316). */
  activo?: boolean;
  /** Icono contextual opcional (🚽 🛏️ 🗄️ 🏠) dibujado en miniatura. */
  icono?: string | null;
  /** Nombre legible del sector (tooltip / descripción accesible). */
  nombre?: string | null;
  /**
   * PARTES de un espacio FUSIONADO, en % de la caja del propio sector: cuando
   * viene, el sector es la UNIÓN de esas cajas y debe dibujarse con su contorno
   * exterior (un solo trazo, sin aristas internas) en vez de un rectángulo.
   */
  partes?: readonly CajaBloque[] | null;
}

/** Sector ya validado y acotado al perímetro real del lienzo (0..100 %). */
export interface SectorAcotado {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  activo: boolean;
  icono: string;
  nombre: string;
  /** Partes del espacio fusionado (se conservan tal cual: son relativas). */
  partes: readonly CajaBloque[] | null;
}

function acotar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Descarta los sectores sin geometría válida y recorta los que se salen del
 * lienzo. Conserva el orden de entrada (importante: los iconos y tooltips se
 * resuelven por índice/identidad en el módulo que arma los sectores).
 *
 * `activoId` es el override global de resalte: el sector cuyo `id` coincide se
 * pinta en naranja (#f97316) aunque quien armó la lista no lo haya marcado
 * (`activo`). Así el componente global MinimapaRuta.astro puede recibir el ID
 * del contenedor activo y resaltarlo sin reconstruir la geometría.
 */
export function sectoresAcotados(
  sectores: readonly SectorGeometrico[] | null | undefined,
  activoId?: string | null,
): SectorAcotado[] {
  return (sectores ?? [])
    .filter((s) => Number.isFinite(s.left) && Number.isFinite(s.top) && s.width > 0 && s.height > 0)
    .map((s) => {
      const left = acotar(s.left, 0, 100);
      const top = acotar(s.top, 0, 100);
      const id = s.id != null ? String(s.id) : '';
      return {
        id,
        left,
        top,
        width: acotar(s.width, 0, 100 - left),
        height: acotar(s.height, 0, 100 - top),
        activo: s.activo === true || (Boolean(activoId) && id === activoId),
        icono: s.icono ?? '',
        nombre: s.nombre ?? '',
        // Las partes del espacio fusionado son RELATIVAS a la caja del sector:
        // viajan intactas (el acotado ya se aplicó sobre la caja), así el render
        // puede trazar el contorno de la unión sin recalcular nada.
        partes: s.partes ?? null,
      };
    });
}
