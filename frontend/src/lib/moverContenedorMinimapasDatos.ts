// =============================================================================
// DATOS DEL ASISTENTE DE MOVIMIENTO POR MINIMAPAS (estructura espacial real)
// -----------------------------------------------------------------------------
// Capa de DATOS del modal «Mover»: carga una sola vez el plano real del Estok
// activo (config del inmueble, ambientes con geometría ui_* y TODOS los
// contenedores, incluidas las cajas anidadas dentro de muebles) y resuelve las
// derivaciones puras que necesita la navegación en cascada:
//
//   · ambientes REALES de la planta activa (mismo mapeo canónico de la app),
//   · muebles/cajas raíz de un ambiente,
//   · cajas internas de un mueble,
//   · guarda anti-ciclos: un contenedor jamás se ofrece como destino de su
//     propio subárbol (mismo blindaje que el Drag & Drop de Almacenamiento).
//
// Multi-tenant: fetchAllPages consume la auth centralizada (JWT + X-Estok-Id).
// No dibuja ni toca el DOM: 100% datos + derivaciones.
// =============================================================================

import { fetchAllPages } from './api';
import { getEstokActivoId } from '../services/auth';
import { dividirEspacios, filaDeUbicacion, habitacionesDeFila } from './espaciosDePlanta';
import type { EstokConfig, UbicacionPlano } from './mapaJerarquico';
// Tipo del motor global: la cuadrícula interna del mueble se devuelve como
// sectores proporcionales (misma geometría que dibuja todo minimapa del sistema).
import type { SectorMinimapa } from './minimapa';

/** Contenedor que el asistente va a reubicar (caja o mueble del listado). */
export interface ContenedorMover {
  id: string;
  nombre: string;
  /** Ambiente (habitación) donde vive hoy: punto de partida del recorrido. */
  ubicacion?: string | null;
}

/** Contenedor destino candidato, con su geometría real de PostgreSQL. */
export interface ContenedorDestino {
  id: string;
  nombre: string;
  tipo: string;
  ubicacion: string | null;
  parent_contenedor: string | null;
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
  /**
   * Mueble FIJO adherido al inmueble (ropero/armario empotrado). El modal lo
   * trata como MUEBLE ingresable aunque todavía no tenga divisiones creadas.
   */
  es_inmueble?: boolean;
  /** Sub-contenedores directos (estantes/cajas internas): habilita «entrar». */
  subcontenedores_count?: number;
  /** Grilla interna del mueble (casilleros) que se dibuja al abrirlo. */
  grid_filas?: number | string | null;
  grid_columnas?: number | string | null;
  grid_filas_config?: number[] | null;
}

/** Estructura espacial real del Estok activo, lista para navegar. */
export interface EstructuraMover {
  estok: EstokConfig | null;
  ubicaciones: UbicacionPlano[];
  contenedores: ContenedorDestino[];
  /** FILA (1-based) de la planta activa de arranque. */
  planta: number;
}

/** Normaliza el contenedor crudo de la API a IDs string y taxonomía en mayúsculas. */
function normalizarContenedor(crudo: ContenedorDestino): ContenedorDestino {
  return {
    ...crudo,
    id: String(crudo.id),
    tipo: String(crudo.tipo || 'CAJA').toUpperCase(),
    ubicacion: crudo.ubicacion != null ? String(crudo.ubicacion) : null,
    parent_contenedor: crudo.parent_contenedor != null ? String(crudo.parent_contenedor) : null,
    // Mueble inmueble: la bandera decide si el modal lo ABRE (nunca lo mueve de
    // un toque) aunque su árbol interno todavía esté vacío.
    es_inmueble: crudo.es_inmueble === true,
  };
}

/**
 * Ambiente real del contenedor que se mueve: su propia ubicación o, si es una
 * pieza anidada sin ubicación denormalizada, la del primer ancestro con una.
 */
function ambienteDe(estructura: EstructuraMover, contenedor: ContenedorMover): UbicacionPlano | undefined {
  const porId = new Map(estructura.contenedores.map((c) => [c.id, c]));
  const propio = porId.get(contenedor.id);
  let id: string | null = contenedor.ubicacion || propio?.ubicacion || null;
  let actual = propio;
  const visitados = new Set<string>();
  while (!id && actual && !visitados.has(actual.id)) {
    visitados.add(actual.id);
    actual = actual.parent_contenedor ? porId.get(actual.parent_contenedor) : undefined;
    id = actual?.ubicacion || null;
  }
  return id ? estructura.ubicaciones.find((u) => String(u.id) === String(id)) : undefined;
}

/** Carga el árbol espacial íntegro del Estok activo (una pasada por recurso). */
export async function cargarEstructuraMover(contenedor: ContenedorMover): Promise<EstructuraMover> {
  const [estoks, ubicaciones, contenedores] = await Promise.all([
    fetchAllPages<EstokConfig>('/estoks/', { page_size: '1000' }),
    fetchAllPages<UbicacionPlano>('/ubicaciones/', { page_size: '1000' }),
    fetchAllPages<ContenedorDestino>('/contenedores/', { page_size: '1000' }),
  ]);

  const activoId = getEstokActivoId();
  const estructura: EstructuraMover = {
    estok: estoks.find((e) => String(e.id) === String(activoId)) || estoks[0] || null,
    ubicaciones,
    contenedores: contenedores.map(normalizarContenedor),
    planta: 1,
  };
  estructura.planta = filaDeUbicacion(
    dividirEspacios(estructura.ubicaciones).divisiones,
    ambienteDe(estructura, contenedor),
  );
  return estructura;
}

/** Ambientes REALES de una planta (habitaciones encastradas + sueltas legacy). */
export function ambientesDePlanta(estructura: EstructuraMover, planta: number): UbicacionPlano[] {
  return habitacionesDeFila(dividirEspacios(estructura.ubicaciones), planta);
}

/**
 * ¿`candidatoId` es el contenedor móvil o un descendiente suyo? Bloquea mover
 * una pieza dentro de sí misma o de su propio subárbol.
 */
export function esDescendiente(
  estructura: EstructuraMover,
  contenedorId: string,
  candidatoId: string,
): boolean {
  const padres = new Map(estructura.contenedores.map((c) => [c.id, c.parent_contenedor]));
  let cursor: string | null | undefined = candidatoId;
  const visitados = new Set<string>();
  while (cursor && !visitados.has(cursor)) {
    if (cursor === contenedorId) return true;
    visitados.add(cursor);
    cursor = padres.get(cursor);
  }
  return false;
}

/** Muebles y cajas RAÍZ de un ambiente (sin el contenedor móvil ni su subárbol). */
export function contenedoresDelAmbiente(
  estructura: EstructuraMover,
  ubicacionId: string | null,
  contenedorId: string,
): ContenedorDestino[] {
  if (!ubicacionId) return [];
  return estructura.contenedores.filter(
    (c) =>
      c.ubicacion === ubicacionId &&
      !c.parent_contenedor &&
      !esDescendiente(estructura, contenedorId, c.id),
  );
}

/** Cajas internas de un mueble (sin el contenedor móvil ni su subárbol). */
export function cajasDelMueble(
  estructura: EstructuraMover,
  muebleId: string | null,
  contenedorId: string,
): ContenedorDestino[] {
  if (!muebleId) return [];
  return estructura.contenedores.filter(
    (c) => c.parent_contenedor === muebleId && !esDescendiente(estructura, contenedorId, c.id),
  );
}

// =============================================================================
// NAVEGACIÓN RECURSIVA AL INTERIOR DEL MUEBLE (derivaciones puras)
// =============================================================================

/** Prefijo de los casilleros sintéticos de la cuadrícula interna de un mueble. */
const PREFIJO_CASILLERO = 'casillero:';
/** Icono de referencia de un casillero/estante interno (capa de etiquetas). */
const ICONO_CASILLERO = '🗂️';
/** Máximo de filas/columnas que se dibujan del interior (grilla acotada). */
const MAX_FILAS = 6;
const MAX_COLUMNAS = 6;
/** Separación (% del lienzo) entre casilleros: los hace leer como cuadrícula. */
const HUECO = 1.5;

/** Acota un entero al rango [min, max]. */
function acotar(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * ¿El contenedor se puede ABRIR para elegir una división interna?
 *
 * MISMO criterio con el que el Visor de Contenedor Grande considera un mueble
 * «navegable»: es un MUEBLE de la taxonomía, es un mueble INMUEBLE (ropero /
 * armario empotrado: nunca se traslada, siempre se abre) o ya tiene
 * sub-contenedores. Lo que no cumple ninguna es una HOJA del inventario
 * (caja/estante sin hijos): tocarla ejecuta el traslado en el acto.
 */
export function esMuebleIngresable(contenedor: ContenedorDestino): boolean {
  return (
    contenedor.tipo === 'MUEBLE' ||
    contenedor.es_inmueble === true ||
    Number(contenedor.subcontenedores_count) > 0
  );
}

/** Contenedor por ID dentro del árbol ya cargado (búsqueda única). */
export function contenedorPorId(
  estructura: EstructuraMover,
  id: string | null | undefined,
): ContenedorDestino | undefined {
  if (!id) return undefined;
  return estructura.contenedores.find((c) => c.id === String(id));
}

/** Token sintético de un casillero del mueble abierto (`casillero:F:C`). */
export function idDeCasillero(fila: number, columna: number): string {
  return PREFIJO_CASILLERO + fila + ':' + columna;
}

/** Coordenada F·C de un token de casillero (null si no es un casillero). */
export function casilleroDeId(token: string): { fila: number; col: number } | null {
  if (!token.startsWith(PREFIJO_CASILLERO)) return null;
  const partes = token.slice(PREFIJO_CASILLERO.length).split(':');
  const fila = Math.floor(Number(partes[0]));
  const col = Math.floor(Number(partes[1]));
  if (!(fila > 0) || !(col > 0)) return null;
  return { fila, col };
}

/** Casilleros por fila de la grilla interna REAL del mueble (1..MAX). */
export function grillaInternaDe(mueble: ContenedorDestino): number[] {
  const filas = acotar(Math.floor(Number(mueble.grid_filas)) || 1, 1, MAX_FILAS);
  const columnas = acotar(Math.floor(Number(mueble.grid_columnas)) || 1, 1, MAX_COLUMNAS);
  const config = Array.isArray(mueble.grid_filas_config) ? mueble.grid_filas_config : null;
  return Array.from({ length: filas }, (_, i) => {
    const n = config ? Math.floor(Number(config[i])) : columnas;
    return acotar(Number.isFinite(n) && n > 0 ? n : columnas, 1, MAX_COLUMNAS);
  });
}

/**
 * CUADRÍCULA INTERNA del mueble como sectores seleccionables: una silueta por
 * casillero (F·C) con su token `casillero:F:C`.
 *
 * Se usa cuando el mueble todavía NO tiene sub-contenedores creados, para que el
 * operador elija la DIVISIÓN exacta: el PUT viaja con `parent_contenedor` = el
 * mueble + la coordenada F·C, EXACTAMENTE el mismo payload que persiste el
 * arrastre del Visor de Contenedores (`asignarSubContenedor`). Así ningún mueble
 * queda sin interior navegable.
 */
export function casillerosDelMueble(mueble: ContenedorDestino): SectorMinimapa[] {
  const filas = grillaInternaDe(mueble);
  const alto = 100 / filas.length;
  const sectores: SectorMinimapa[] = [];
  filas.forEach((columnas, i) => {
    const ancho = 100 / columnas;
    for (let c = 1; c <= columnas; c++) {
      sectores.push({
        id: idDeCasillero(i + 1, c),
        left: (c - 1) * ancho + HUECO,
        top: i * alto + HUECO,
        width: Math.max(1, ancho - HUECO * 2),
        height: Math.max(1, alto - HUECO * 2),
        nombre: 'F' + (i + 1) + '·C' + c,
        icono: ICONO_CASILLERO,
      });
    }
  });
  return sectores;
}
