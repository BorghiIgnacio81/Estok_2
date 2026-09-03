// =============================================================================
// VISOR CONTENEDOR GRANDE - acciones asincrónicas de sub-divisiones
// -----------------------------------------------------------------------------
// Persistencia multi-tenant estricta (JWT + X-Estok-Id) de los controles
// directos de la ESCENA 3:
//   - eliminarDivisionDeFilaEnGrid: DELETE /api/contenedores/{id}/ tras el
//     cartel de advertencia unificado — el backend libera los objetos a la
//     bandeja de «por ubicar»; luego la fila se CONTRAE: los hermanos a la
//     derecha se desplazan una columna y el contador real de columnas de esa
//     fila baja (columnas -= 1) vía PUT de grid_filas_config. Así la columna
//     desaparece físicamente de la grilla y de PostgreSQL (sin rectángulo vacío).
//   - agregarDivisionEnFila: suma una división/columna vacía a una fila exacta
//     del mueble. Ensancha la geometría (PUT grid_filas_config) si la fila está
//     llena y registra el nuevo casillero con POST /api/contenedores/ (coordenada
//     F·C persistida en PostgreSQL). Si el POST falla, revierte el ensanche para
//     no dejar columnas fantasma (sin deudas técnicas).
//   - fijarColumnasFila: PUT geométrico directo (grid_filas_config) que también
//     usa el botón «−» rojo de fila cuando la última columna queda vacía (sin
//     estante que borrar con DELETE): contrae la grilla una columna exacta.
//   - liberarObjetoDeCasillero: libera un objeto suelto de la última columna a la
//     bandeja de «por ubicar» (PUT con contenedor/coordenadas nulas), sin borrarlo.
// Consumido únicamente por src/lib/visorContenedorGrande.ts.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { toast } from './mapaJerarquico';
import { filasInternasDe, columnasDeFilaInterna } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';

// Cartel unificado de advertencia destructiva (misma regla que mapaEstokEliminar).
export const ADVERTENCIA_ELIMINAR_DIVISION =
  'Si elimina este contenedor/ubicacion todo su contenido quedara sin ubicacion, se perdera su estructura etc. ¿Está seguro de que desea proceder?';

export interface MuebleGrillaFuente {
  id: string;
  nombre: string;
  grid_filas?: number | null;
  grid_columnas?: number | null;
  grid_filas_config?: number[] | null;
}

export interface OpcionesAgregarDivision {
  mueble: MuebleGrillaFuente;
  roomId: string;
  fila: number;
  colNueva: number;
  /** true = la fila está llena y hay que ensanchar la geometría antes del POST. */
  requiereEnsanche: boolean;
}

/** Hermano (sub-división u objeto directo) que debe re-posicionarse tras un −. */
export interface ItemADesplazar {
  tipo: 'contenedor' | 'objeto';
  id: string;
  col: number;
}

export interface OpcionesQuitarDivision {
  /** Sub-división (estante/cajón) que se elimina físicamente. */
  subId: string;
  nombre: string;
  mueble: MuebleGrillaFuente;
  fila: number;
  /** Columna que ocupaba la sub-división borrada (1-based). */
  col: number;
  /** Columnas que tenía la fila ANTES del borrado (para calcular columnas -= 1). */
  columnasAnterior: number;
  /** Siblings con columna mayor a la borrada: se desplazan una columna a la izquierda. */
  aDesplazar: ItemADesplazar[];
}

/** DELETE físico del estante/cajón (el backend libera objetos a la bandeja). */
async function borrarContenedorApi(id: string, nombre: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${id}/`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok || res.status === 204) {
      toast(`🗑 División «${nombre}» eliminada. Su contenido quedó en la bandeja de «por ubicar».`);
      return true;
    }
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || `No se pudo eliminar la división (${res.status}).`));
    return false;
  } catch {
    toast('❌ Error de conexión al eliminar la división.');
    return false;
  }
}

/** Re-posiciona un hermano de la fila una columna a la izquierda (PUT asincrónico). */
async function desplazarHermanoALaIzquierda(item: ItemADesplazar): Promise<boolean> {
  const recurso = item.tipo === 'contenedor' ? 'contenedores' : 'objetos';
  try {
    const res = await fetch(`${API_BASE_URL}/${recurso}/${item.id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_grid_col: item.col - 1 }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Borra la sub-división y CONTRAE la fila para que su columna desaparezca
 * físicamente de la grilla y de PostgreSQL:
 *   1. DELETE /api/contenedores/{id}/ (objetos → bandeja de «por ubicar»).
 *   2. Desplaza a la izquierda (col - 1) las divisiones/objetos que estaban a la
 *      derecha de la columna borrada (evita huecos fantasma en el DOM).
 *   3. Reduce el contador real de columnas de la fila (columnas -= 1) con un PUT
 *      de grid_filas_config, hermético al Estok activo vía headers.
 */
export async function eliminarDivisionDeFilaEnGrid(opts: OpcionesQuitarDivision): Promise<boolean> {
  const { subId, nombre, mueble, fila, col, columnasAnterior, aDesplazar } = opts;

  const borrado = await borrarContenedorApi(subId, nombre);
  if (!borrado) return false;

  // Paso 2: desplazamientos en orden descendente para no pisar coordenadas.
  const desplazables = [...aDesplazar].sort((a, b) => b.col - a.col);
  const fallos: string[] = [];
  for (const item of desplazables) {
    const ok = await desplazarHermanoALaIzquierda(item);
    if (!ok) fallos.push(`${item.tipo} ${item.id}`);
  }
  if (fallos.length) {
    toast(`⚠️ No se pudo reacomodar ${fallos.length} elemento(s) de la fila.`);
  }

  // Paso 3: la fila pierde una columna real (mínimo 1 para conservar la línea).
  const columnasNuevas = Math.max(1, columnasAnterior - 1);
  const okGeometria = await fijarColumnasFila(mueble, fila, columnasNuevas);
  if (okGeometria && columnasNuevas !== columnasAnterior) {
    toast(`✅ Fila ${fila} de «${mueble.nombre}» ahora tiene ${columnasNuevas} casillero${columnasNuevas === 1 ? '' : 's'}.`);
  }
  return true;
}

/** Libera un objeto suelto de un casillero del mueble a la bandeja de «por ubicar»
 *  (PUT con contenedor/coordenadas nulas) SIN borrarlo. Usado por el botón «−»
 *  de fila cuando la última columna que se contrae aloja un objeto directo. */
export async function liberarObjetoDeCasillero(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/objetos/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ contenedor: null, parent_grid_row: null, parent_grid_col: null }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) return true;
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo liberar el objeto de su casillero.'));
    return false;
  } catch {
    toast('❌ Error de conexión al liberar el objeto de su casillero.');
    return false;
  }
}

/**
 * Fija la cantidad de columnas de una fila específica del mueble (PUT geométrico
 * de grid_filas_config). Sirve tanto para ENSANCHAR (botón «+» cuando la fila
 * está llena) como para CONTRAER (botón «−» sobre la última columna vacía).
 */
export async function fijarColumnasFila(mueble: MuebleGrillaFuente, fila: number, colNueva: number): Promise<boolean> {
  const div = mueble as unknown as UbicacionPlano;
  const filas = filasInternasDe(div);
  const fallbackColumnas = Number(mueble.grid_columnas) || 3;

  const config: number[] = [];
  for (let i = 0; i < filas; i++) {
    config.push(i === fila - 1 ? colNueva : columnasDeFilaInterna(div, i + 1));
  }
  const uniforme = config.every((v) => v === config[0]);

  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${mueble.id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grid_filas: filas,
        grid_columnas: uniforme ? colNueva : fallbackColumnas,
        grid_filas_config: uniforme ? null : config,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) return true;
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo actualizar la geometría de la fila del mueble.'));
    return false;
  } catch {
    toast('❌ Error de conexión al actualizar la geometría de la fila del mueble.');
    return false;
  }
}

/** Registra el nuevo casillero con POST (persiste la coordenada F·C en PostgreSQL). */
async function registrarDivision(
  mueble: MuebleGrillaFuente,
  roomId: string,
  fila: number,
  col: number,
): Promise<boolean> {
  const nombre = `Estante F${fila}·C${col}`;
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre,
        descripcion: '',
        ubicacion: roomId,
        parent_contenedor: mueble.id,
        parent_grid_row: fila,
        parent_grid_col: col,
        es_inmueble: false,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) {
      toast(`✅ «${nombre}» registrada en «${mueble.nombre}». Clic en el nombre para renombrarla en caliente.`);
      return true;
    }
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo registrar la nueva división.'));
    return false;
  } catch {
    toast('❌ Error de conexión al registrar la nueva división.');
    return false;
  }
}

/**
 * Suma una división/columna vacía a la fila indicada del mueble inspeccionado.
 * Devuelve true si la coordenada quedó persistida (POST + ensanche geométrico).
 */
export async function agregarDivisionEnFila(opts: OpcionesAgregarDivision): Promise<boolean> {
  const { mueble, roomId, fila, colNueva, requiereEnsanche } = opts;
  if (colNueva < 1 || colNueva > 12) {
    toast('⚠️ Cada fila admite entre 1 y 12 casilleros.');
    return false;
  }
  const colAnterior = columnasDeFilaInterna(mueble as unknown as UbicacionPlano, fila);
  let ensanchado = false;
  if (requiereEnsanche) {
    ensanchado = await fijarColumnasFila(mueble, fila, colNueva);
    if (!ensanchado) return false;
  }

  const creado = await registrarDivision(mueble, roomId, fila, colNueva);
  if (!creado && ensanchado) {
    // Rollback best-effort de la geometría para no dejar columnas fantasma.
    await fijarColumnasFila(mueble, fila, colAnterior);
  }
  return creado;
}

