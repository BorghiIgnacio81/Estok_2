// =============================================================================
// ESTADO Y DERIVACIONES DEL SELECTOR DE UBICACIÓN (alta y edición de objetos)
// -----------------------------------------------------------------------------
// Núcleo de DATOS del navegador espacial de Objetos: el estado del recorrido
// (planta → habitación → mueble → caja), los IDs de los hosts del DOM y las
// derivaciones de los espacios REALES del Estok activo (habitaciones de la
// planta, muebles de la habitación, cajas del mueble).
//
// Vive en su propio módulo para que el render
// (selectorMinimapaNuevoObjetoRender.ts) y la navegación
// (selectorMinimapaNuevoObjeto.ts) compartan UNA sola fuente de estado, sin
// ciclos de importación y con cada archivo por debajo del límite de
// modularidad del proyecto.
//
// NO dibuja nada ni hace fetch: 100% puro salvo el estado en memoria del
// recorrido, que la capa de navegación muta.
// =============================================================================

import type { ItemGeometria } from './sectoresMinimapa';
import type { EstokConfig, UbicacionPlano } from './mapaJerarquico';
// MAPEO CANÓNICO COMPARTIDO con la sección central de Almacenamiento: quién es
// división (planta), quién es habitación, y qué ambientes tiene una planta.
// Es la ÚNICA fuente de esta física: no se duplica ninguna derivación acá.
import {
  dividirEspacios,
  filaDeUbicacion,
  habitacionesDeFila,
  plantasDe,
} from './espaciosDePlanta';
import type { EspaciosEstok, PlantaDisponible } from './espaciosDePlanta';

// =============================================================================
// TIPOS
// =============================================================================

/** Contenedor de PostgreSQL (mueble, estante o caja) con su geometría real. */
export interface ContenedorMinimapa extends ItemGeometria {
  ubicacion?: string | null;
  parent_contenedor?: string | null;
  tipo?: string | null;
  grid_filas?: number | null;
}

export interface EstadoSelector {
  /** Estok activo (tenant): aporta la cantidad de plantas del inmueble. */
  estok: EstokConfig | null;
  ubicaciones: UbicacionPlano[];
  contenedores: ContenedorMinimapa[];
  cargando: boolean;
  error: string | null;
  /** Nivel visible: 1 = habitaciones, 2 = muebles, 3 = cajas. */
  nivel: 1 | 2 | 3;
  /**
   * FILA de la planta activa (1-based, como string): es la clave canónica
   * `parent_grid_row` de la división, la MISMA que usa el lienzo central de
   * Almacenamiento. NO es un código de piso: la lista de plantas reales la
   * resuelve `plantasDisponibles()`.
   */
  planta: string;
  habitacionId: string | null;
  muebleId: string | null;
  cajaId: string | null;
}

// =============================================================================
// ESTADO E IDS DEL DOM
// =============================================================================

export const estado: EstadoSelector = {
  estok: null,
  ubicaciones: [],
  contenedores: [],
  cargando: true,
  error: null,
  // ARRANQUE EN EL PLANO REAL: el recorrido empieza en el plano de ambientes de
  // la planta activa (nivel 1). NO existe el viejo nivel 0 de «elegí la planta»
  // con tarjetas/cajones por planta («1er piso» / «Planta 2»). `planta` es la
  // FILA de la división (clave canónica `parent_grid_row`), no un código de piso.
  nivel: 1,
  planta: '1',
  habitacionId: null,
  muebleId: null,
  cajaId: null,
};

export const IDS = {
  /**
   * RAÍZ del selector: única delegación de eventos (click en el plano y en la
   * cabecera + change del selector de planta). Los hosts de dibujo viven
   * adentro, así que la delegación no depende de cuál se re-renderice.
   */
  raiz: 'minimapaSelectorRaiz',
  /** Cadena de orientación (componente global). */
  niveles: 'minimapaNiveles',
  /** Host del PLANO a escala (componente global, formato `plano`). */
  lienzo: 'minimapaLienzo',
  /** Cabecera del nivel (título, volver/quitar y planta activa). */
  texto: 'minimapaPlanoTexto',
  /** Pie explicativo del nivel visible. */
  pie: 'minimapaPlanoPie',
  inputUbicacion: 'ubicacionSeleccionada',
  inputContenedor: 'contenedorSeleccionado',
};

// =============================================================================
// ICONOGRAFÍA CONTEXTUAL
// =============================================================================

const ICONO_TIPO: Record<string, string> = {
  MUEBLE: '🗄️',
  ESTANTE: '🗃️',
  CAJA: '📦',
};

// =============================================================================
// DERIVACIONES DE LOS ESPACIOS REALES
// =============================================================================

/**
 * Plantas navegables REALES del inmueble (fila + división + etiqueta), resueltas
 * por el mapeo canónico compartido (lib/espaciosDePlanta.ts → plantasDe): las
 * MISMAS que lista el lienzo central de Almacenamiento. Nunca se inventan cajones
 * vacíos «1er piso» / «Planta 2» sin estructura ni ambientes.
 */
export function plantasDisponibles(): PlantaDisponible[] {
  return plantasDe(estado.estok, estado.ubicaciones);
}

/** Partición canónica (divisiones ⇄ habitaciones) de los espacios cargados. */
export function espaciosEstok(): EspaciosEstok {
  return dividirEspacios(estado.ubicaciones);
}

/** FILA de planta activa (1-based) como número. */
export function filaActiva(): number {
  const n = Math.floor(Number(estado.planta));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Fila de planta a la que pertenece una Ubicación real (división o habitación). */
export function filaDeUbicacionDe(habitacion: UbicacionPlano | null | undefined): number {
  return filaDeUbicacion(espaciosEstok().divisiones, habitacion);
}

/**
 * AMBIENTES de la PLANTA ACTIVA: son los sectores del plano de Nivel 1 (cada uno
 * con su geometría real `ui_*`). Mapeo iterativo canónico: habitaciones
 * ENCASTADAS en la división de esa fila + sueltas legacy, tal cual la sección
 * central de Almacenamiento (mapaCasitaNavegable → habitacionesDePlanta).
 */
export function habitacionesDePlanta(): UbicacionPlano[] {
  return habitacionesDeFila(espaciosEstok(), filaActiva());
}

/** Muebles/estantes contenidos en una habitación (contenedores raíz del espacio). */
export function mueblesDeHabitacion(ubicacionId: string | null): ContenedorMinimapa[] {
  if (!ubicacionId) return [];
  return estado.contenedores.filter(
    (c) => String(c.ubicacion || '') === String(ubicacionId) && !c.parent_contenedor,
  );
}

/** Cajas contenidas en un mueble (sub-contenedores directos). */
export function cajasDeMueble(muebleId: string | null): ContenedorMinimapa[] {
  if (!muebleId) return [];
  return estado.contenedores.filter((c) => String(c.parent_contenedor || '') === String(muebleId));
}

export function habitacionActual(): UbicacionPlano | null {
  return estado.ubicaciones.find((u) => String(u.id) === String(estado.habitacionId)) || null;
}

export function muebleActual(): ContenedorMinimapa | null {
  return estado.contenedores.find((c) => String(c.id) === String(estado.muebleId)) || null;
}

export function cajaActual(): ContenedorMinimapa | null {
  return estado.contenedores.find((c) => String(c.id) === String(estado.cajaId)) || null;
}

/** Icono contextual del contenedor (mismo criterio en toda la app). */
export function iconoContenedor(item: ItemGeometria): string {
  const tipo = String((item as ContenedorMinimapa).tipo || '').toUpperCase();
  return ICONO_TIPO[tipo] || '📦';
}
