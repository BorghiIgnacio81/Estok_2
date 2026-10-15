// =============================================================================
// MINIMAPAS DEL DETALLE DE CONTENEDOR (capa de pantalla del MÓDULO UNIFICADO)
// -----------------------------------------------------------------------------
// La vista `pages/contenedores/[id]/index.astro` sólo declara los hosts
// `<MinimapaModuloUnificado modo="visor" tipo="seccion" />` y delega acá:
//   · `pintarCeldaEnPadre(...)`      → celda F·C exacta dentro del PADRE.
//   · `pintarCasillerosOcupados(...)`→ casilleros internos ocupados por objetos.
// Ambos sectores se pintan en NARANJA ESTRICTO (#f97316) por el motor canónico.
// Cero geometría propia: el trazo lo emite lib/minimapaModuloUnificado.ts.
// =============================================================================

import { renderSeccionModulo, renderSeccionMultiples } from './minimapaModuloUnificado';

/** Host canónico de la celda del contenedor dentro de su PADRE. */
export const HOST_SECCION_PADRE = 'seccionModuloUnificado';
/** Host canónico de los casilleros internos ocupados por objetos. */
export const HOST_SECCION_INTERNA = 'seccionInternaModulo';

/** Celda (1-based) dentro de la grilla de un contenedor. */
export interface CeldaGrilla {
  fila: number;
  columna: number;
}

/** Celda exacta del contenedor dentro de su PADRE. `false` = sin casillero real. */
export function pintarCeldaEnPadre(datos: {
  filas?: number;
  columnas?: number;
  fila?: number | null;
  columna?: number | null;
}): boolean {
  return renderSeccionModulo(HOST_SECCION_PADRE, null, datos);
}

/** Casilleros ocupados por objetos (todos en naranja). `false` = sin celdas. */
export function pintarCasillerosOcupados(datos: {
  filas?: number;
  columnas?: number;
  celdas: CeldaGrilla[];
}): boolean {
  return renderSeccionMultiples(HOST_SECCION_INTERNA, null, datos);
}

/** Celdas F·C ocupadas derivadas de la lista real de objetos del contenedor. */
export function celdasOcupadasDe(objetos: Array<Record<string, unknown>>): CeldaGrilla[] {
  const celdas: CeldaGrilla[] = [];
  for (const objeto of objetos) {
    if (objeto.parent_grid_row && objeto.parent_grid_col) {
      celdas.push({
        fila: Number(objeto.parent_grid_row),
        columna: Number(objeto.parent_grid_col),
      });
    }
  }
  return celdas;
}

/** Micro-texto de la sección interna ('' cuando no hay casilleros ocupados). */
export function detalleCasilleros(total: number): string {
  return total > 0 ? `${total} objeto${total > 1 ? 's' : ''} con casillero asignado` : '';
}
