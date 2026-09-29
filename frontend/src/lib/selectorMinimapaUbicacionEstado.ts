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
  // ARRANQUE EN EL PLANO REAL: el recorrido empieza en el plano de habitaciones
  // de la planta activa (nivel 1). NO existe el viejo nivel 0 de «elegí la
  // planta» con tarjetas/cajones por planta («1er piso» / «Planta 2»).
  nivel: 1,
  planta: 'PRIMER_PISO',
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
 * Plantas navegables del inmueble (DATO de contexto).
 * `cantidad_pisos > 1` = Modo Casa (varias plantas reales); si no, planta única.
 */
export function plantasDisponibles(): Array<{ valor: string; etiqueta: string }> {
  const total = Math.max(1, Math.floor(Number(estado.estok?.cantidad_pisos) || 1));
  const usadas = new Set(estado.ubicaciones.map((u) => String(u.piso || 'PRIMER_PISO')));
  const etiquetas = ['PRIMER_PISO', 'PLANTA_BAJA'];
  const lista: Array<{ valor: string; etiqueta: string }> = [];
  for (let i = 0; i < total; i++) {
    const valor = etiquetas[i] || `PLANTA_${i + 1}`;
    lista.push({ valor, etiqueta: i === 0 ? '1er piso' : `Planta ${i + 1}` });
  }
  // Plantas con habitaciones reales que no entraron por cantidad_pisos.
  usadas.forEach((valor) => {
    if (!lista.some((p) => p.valor === valor)) {
      lista.push({
        valor,
        etiqueta: valor === 'PLANTA_BAJA' ? 'Planta baja' : 'Planta adicional',
      });
    }
  });
  return lista;
}

/**
 * Habitaciones (Ubicaciones raíz) de la PLANTA ACTIVA: son los sectores del
 * plano de Nivel 1 (cada uno con su geometría real `ui_*`).
 */
export function habitacionesDePlanta(): UbicacionPlano[] {
  return estado.ubicaciones.filter(
    (u) => String(u.piso || 'PRIMER_PISO') === estado.planta && !u.parent_ubicacion,
  );
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
