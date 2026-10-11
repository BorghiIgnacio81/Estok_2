// =============================================================================
// ESTADO DE LA CASCADA RECURSIVA DE PORTALES (Miller Columns sin límite)
// -----------------------------------------------------------------------------
// Reemplaza la escala FIJA de niveles (0..4) por una PILA de nodos: cada
// selección empuja un nivel nuevo y el nivel N+1 se resuelve con el MISMO
// algoritmo, de modo que la anidación profunda (planta → habitación → mueble →
// estante → estante interno → caja → …) no tiene tope alguno.
//
// Módulo 100% PURO: no toca el DOM, no hace fetch y no conoce Tailwind. El
// dibujo y la persistencia viven en portalesAlmacenamiento.ts y en
// datosNodosPortales.ts.
// =============================================================================

import type { ItemGeometria } from '../../sectoresMinimapa';

/** Naturaleza del nodo dentro de la cascada (jerarquía real por `parent_id`). */
export type TipoNodoPortal = 'planta' | 'habitacion' | 'contenedor';

/** Casillero fino F·C heredado cuando el nodo provino de una celda del padre. */
export interface CeldaFina {
  fila: number | null;
  col: number | null;
}

/**
 * Nodo seleccionable de la cascada. Es una PROYECCIÓN liviana del registro real
 * (Ubicación o Contenedor de PostgreSQL) con lo mínimo que la máquina de niveles
 * necesita para decidir la pantalla: su grilla elástica, su geometría de hijos y
 * su disyuntor de estructura «Espacio Único».
 */
export interface NodoPortal {
  tipo: TipoNodoPortal;
  /** UUID real (Ubicación o Contenedor) del nodo seleccionado. */
  id: string;
  nombre: string;
  /** 🧱 DISYUNTOR: bloque monolítico declarado «Espacio Único» en la base. */
  espacioUnico: boolean;
  /** Tiene al menos un hijo propio (estante/cajón/caja adentro). */
  conDivisiones: boolean;
  /** Grilla elástica propia del nodo (filas internas asimétricas). */
  filas: number;
  /** Columnas por fila (grilla asimétrica) del nodo. */
  columnasPorFila: number[];
  /** Geometría REAL de los hijos directos (ui_left/ui_top/ui_width/ui_height). */
  hijos: ItemGeometria[];
  /**
   * Medida general persistida del PERÍMETRO propio del nodo (px). El nodo oficia
   * de dueño del marco ámbar redimensionable en CUALQUIER nivel de la cascada:
   * se reutiliza el motor de la Planta (`perimetroElastico.ts`) sin duplicarlo.
   */
  ui_width?: string | null;
  ui_height?: string | null;
  /** Casillero F·C heredado cuando el nodo provino de una celda del padre. */
  celda: CeldaFina | null;
}

/** Planta activa del Estok (contexto del nivel raíz de la cascada). */
export interface PlantaActiva {
  fila: number | null;
  nombre: string;
  total: number;
  /** Habitaciones de la planta con su geometría real (minimapa del nivel raíz). */
  hermanas: ItemGeometria[];
}

/** Estado completo de la cascada de portales (singleton en caliente). */
export interface EstadoPortales {
  /** Migas: pila de selección. Índice 0 = primer nivel, profundidad libre. */
  ruta: NodoPortal[];
  /** Planta activa del Estok (contexto de la izquierda en el nivel inicial). */
  planta: PlantaActiva | null;
}

export const estadoPortales: EstadoPortales = {
  ruta: [],
  planta: null,
};

// -----------------------------------------------------------------------------
// LECTURA
// -----------------------------------------------------------------------------

/** Nodo activo (último de la pila) o null cuando la cascada está en la raíz. */
export function nodoActual(): NodoPortal | null {
  const ruta = estadoPortales.ruta;
  return ruta.length ? ruta[ruta.length - 1] : null;
}

/** Nodo inmediatamente superior en la jerarquía (el que oficia de padre). */
export function nodoPadre(): NodoPortal | null {
  const ruta = estadoPortales.ruta;
  return ruta.length >= 2 ? ruta[ruta.length - 2] : null;
}

/** Profundidad de la cascada: 0 = raíz (planta), 1 = habitación, 2+ = contenedores. */
export function profundidad(): number {
  return estadoPortales.ruta.length;
}

/** Copia inmutable de las migas (la consumen los minimapas anidados). */
export function migas(): NodoPortal[] {
  return [...estadoPortales.ruta];
}

/**
 * Fin de cadena estructural: el nodo NO expone una grilla de divisiones
 * navegable, sea porque fue declarado «Espacio Único» (bloque monolítico) o
 * porque directamente todavía no tiene ningún hijo propio. En ambos casos el
 * panel derecho debe mostrar la grilla DIRECTA de objetos reales.
 */
export function esNodoMonolitico(nodo: NodoPortal | null): boolean {
  if (!nodo) return false;
  return nodo.espacioUnico || !nodo.conDivisiones;
}

// -----------------------------------------------------------------------------
// MUTACIÓN
// -----------------------------------------------------------------------------

/** Fija la planta activa (contexto del primer nivel de la cascada). */
export function fijarPlanta(planta: PlantaActiva | null): void {
  estadoPortales.planta = planta;
}

/** DESCENSO N → N+1: empuja el nodo elegido al tope de la pila. */
export function empujarNodo(nodo: NodoPortal): void {
  estadoPortales.ruta.push(nodo);
}

/**
 * Actualiza en caliente el nodo activo (p. ej. tras un PUT de `espacio_unico` o
 * al completar el sondeo asíncrono de su interior). No altera la profundidad.
 */
export function reemplazarNodoActual(parcial: Partial<NodoPortal>): void {
  const actual = nodoActual();
  if (!actual) return;
  Object.assign(actual, parcial);
}

/** Desapila hasta la profundidad destino. Devuelve el nodo que queda activo. */
export function desapilarHasta(destino: number): NodoPortal | null {
  const objetivo = Math.max(0, Math.floor(destino));
  while (estadoPortales.ruta.length > objetivo) estadoPortales.ruta.pop();
  return nodoActual();
}

/** Vuelve a la raíz de la cascada (plano de la planta / casa). */
export function limpiarRuta(): void {
  estadoPortales.ruta.length = 0;
}
