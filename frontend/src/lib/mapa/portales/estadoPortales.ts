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
 * su disyuntor de estructura «Espacio Final».
 */
export interface NodoPortal {
  tipo: TipoNodoPortal;
  /** UUID real (Ubicación o Contenedor) del nodo seleccionado. */
  id: string;
  nombre: string;
  /**
   * 🧱 DISYUNTOR DE ESPACIO FINAL (persistido como `espacio_unico` en la base):
   * nivel TERMINAL declarado por el operador, sin subdivisiones arquitectónicas.
   */
  espacioUnico: boolean;
  /**
   * 🎒 DISYUNTOR DE MOVILIDAD: pieza declarada «Mueble Móvil / Objeto» en la
   * base (`declarado_movible`). Destildado (default) = ARQUITECTURA del espacio.
   * SÓLO los Contenedores tienen el campo: las Ubicaciones viajan siempre false.
   */
  declaradoMovible: boolean;
  /** Tiene al menos un hijo propio (estante/cajón/caja adentro). */
  conDivisiones: boolean;
  /**
   * SUB-ESPACIOS ARQUITECTÓNICOS: cantidad de hijos directos que son DIVISIONES
   * fijas del espacio (estantes, cajones, muebles inmuebles). Los BULTOS —
   * cajas móviles y muebles declarados «Mueble Móvil / Objeto»— NO cuentan.
   *
   * Lo resuelve `refrescarNivel()` con el interior real del nodo. `undefined` =
   * todavía no se sondeó el interior (se conserva el modelador geométrico).
   */
  subEspaciosArquitectonicos?: number;
  /**
   * CONTADORES REALES del padrón (PostgreSQL) del nodo activo. Los consume la
   * ficha del Panel Izquierdo y el badge de cada tarjeta del lienzo, que se
   * incrementa en el acto al soltar un objeto encima.
   */
  objetosCount?: number;
  subcontenedoresCount?: number;
  /**
   * 🧱 NATURALEZA FÍSICA de la pieza: `true` = mueble inmueble fijo del espacio
   * (arquitectura clavada al cuarto, NO puede ponerse en tránsito). Las
   * Ubicaciones viajan siempre `false`. Lo consume la barra de acciones del
   * contenedor activo (lib/mapa/portales/accionesCajaPortales.ts).
   */
  esInmueble?: boolean;
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

/**
 * 🧱 OVERRIDE DE SESIÓN DEL MODELADOR: ids de nodos donde el operador pidió
 * EXPLÍCITAMENTE «Modelar divisiones» sobre un Espacio Final detectado
 * automáticamente (contenedor cuyos hijos son todos bultos). Vive sólo en
 * memoria: la persistencia real del disyuntor es `espacio_unico` (PUT parcial).
 */
const modeladorForzado = new Set<string>();

/** ¿El operador reabrió el modelador de este nodo en esta sesión? */
export function esModeladorForzado(id: string): boolean {
  return modeladorForzado.has(String(id ?? ''));
}

/**
 * Reabre (o vuelve a cerrar) el modelador geométrico de un nodo en caliente.
 * `false` limpia el override: el nodo vuelve a resolverse con las reglas puras.
 */
export function forzarModelador(id: string, forzar = true): void {
  const clave = String(id ?? '');
  if (!clave) return;
  if (forzar) modeladorForzado.add(clave);
  else modeladorForzado.delete(clave);
}

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
 * 🧱 DISYUNTOR «ESPACIO FINAL» (AUTORIDAD ÚNICA del nivel terminal).
 *
 * Un nodo es Espacio Final cuando YA NO se modela arquitectónicamente:
 *   · fue declarado explícitamente (`espacioUnico = true`, persistido como
 *     `espacio_unico` en la base), o
 *   · es un CONTENEDOR cuyos hijos directos son TODOS bultos (cajas móviles /
 *     muebles declarados) —o no tiene hijos—: ningún sub-espacio arquitectónico.
 *
 * Las HABITACIONES nunca son terminales por detección automática: su editor
 * elástico es el flujo principal de modelado (sólo lo apaga su propio disyuntor
 * `espacioUnico`, que es reversible).
 *
 * El modelador geométrico puede reabrirse en caliente con `forzarModelador()`
 * (botón «Modelar divisiones» del Panel de Contenido).
 */
export function esEspacioFinal(nodo: NodoPortal | null): boolean {
  if (!nodo) return false;
  if (esModeladorForzado(nodo.id)) return false;
  if (nodo.espacioUnico) return true;
  if (nodo.tipo !== 'contenedor') return false;
  const arquitectonicos = nodo.subEspaciosArquitectonicos;
  // Interior todavía no sondeado: se conserva el modelador hasta saberlo.
  if (arquitectonicos === undefined) return false;
  return arquitectonicos === 0;
}

/**
 * ¿El hijo directo es una DIVISIÓN ARQUITECTÓNICA del espacio (estante, cajón,
 * mueble fijo)? Los bultos móviles —cajas y piezas declaradas «Mueble Móvil /
 * Objeto»— son CONTENIDO, no arquitectura, y por eso no impiden que el nivel sea
 * un Espacio Final.
 */
export function esSubEspacioArquitectonico(hijo: NodoPortal | null): boolean {
  if (!hijo) return false;
  if (hijo.espacioUnico) return false;
  return !hijo.declaradoMovible;
}

/** Cuenta los hijos ARQUITECTÓNICOS de un interior ya resuelto. */
export function contarSubEspaciosArquitectonicos(hijos: NodoPortal[]): number {
  return (hijos || []).filter(esSubEspacioArquitectonico).length;
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
