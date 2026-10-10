// =============================================================================
// ESTADO COMPARTIDO DEL LIENZO «MAPA ESTOK» (Nivel Estok)
// -----------------------------------------------------------------------------
// Fuente ÚNICA del estado mutable del lienzo. La comparten el orquestador
// (mapaCasitaNavegable.ts), el render (renderCasita.ts), el dominio
// (dominioCasita.ts) y la carga (cargaCasita.ts) SIN dependencias circulares.
// Módulo de DATOS: no toca el DOM, no hace fetch y no conoce Tailwind.
// =============================================================================

import type { EstokConfig, UbicacionPlano } from '../mapaJerarquico';

/** Referencias DOM del lienzo (host del mapa + badge de nivel). */
export interface RefsCasita {
  mapa: HTMLElement | null;
  badge: HTMLElement | null;
}

/** Estado completo del lienzo navegable de la casa. */
export interface EstadoCasita {
  refs: RefsCasita;
  estok: EstokConfig | null;
  /** Divisiones raíz (plantas) del Estok activo. */
  divisiones: UbicacionPlano[];
  /** Habitaciones/espacios (Nivel 2) del Estok activo. */
  habitaciones: UbicacionPlano[];
  /** Planta activa (parent_grid_row). null = vista general sin filtro. */
  filaActiva: number | null;
  /** Nivel de navegación: 1 = casa general, 2 = habitaciones de una planta. */
  nivelActual: 1 | 2;
  /** true mientras no se haya resuelto la PRIMERA carga con datos reales. */
  primeraCarga: boolean;
}

export const estado: EstadoCasita = {
  refs: { mapa: null, badge: null },
  estok: null,
  divisiones: [],
  habitaciones: [],
  filaActiva: null,
  nivelActual: 1,
  primeraCarga: true,
};
