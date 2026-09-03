// =============================================================================
// VISOR CONTENEDOR GRANDE - acciones asincrónicas de sub-divisiones
// -----------------------------------------------------------------------------
// Persistencia multi-tenant estricta (JWT + X-Estok-Id) de los controles
// directos de la ESCENA 3:
//   - eliminarSubdivisionApi: DELETE /api/contenedores/{id}/ tras el cartel de
//     advertencia unificado (frena el flujo con confirm) — el backend libera
//     los objetos a la bandeja de «por ubicar» y desacopla los sub-contenedores.
//   - agregarDivisionEnFila: suma una división/columna vacía a una fila exacta
//     del mueble. Ensancha la geometría (PUT grid_filas_config) si la fila está
//     llena y registra el nuevo casillero con POST /api/contenedores/ (coordenada
//     F·C persistida en PostgreSQL). Si el POST falla, revierte el ensanche para
//     no dejar columnas fantasma (sin deudas técnicas).
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

/** Elimina físicamente una sub-división (estante/cajón) con DELETE asincrónico. */
export async function eliminarSubdivisionApi(id: string, nombre: string): Promise<boolean> {
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

/** Ensancha la fila `fila` del mueble a `colNueva` columnas (PUT geométrica). */
async function ensancharFila(mueble: MuebleGrillaFuente, fila: number, colNueva: number): Promise<boolean> {
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
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo ensanchar la fila del mueble.'));
    return false;
  } catch {
    toast('❌ Error de conexión al ensanchar la fila del mueble.');
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
    ensanchado = await ensancharFila(mueble, fila, colNueva);
    if (!ensanchado) return false;
  }

  const creado = await registrarDivision(mueble, roomId, fila, colNueva);
  if (!creado && ensanchado) {
    // Rollback best-effort de la geometría para no dejar columnas fantasma.
    await ensancharFila(mueble, fila, colAnterior);
  }
  return creado;
}

