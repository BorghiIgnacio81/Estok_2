// =============================================================================
// PERSISTENCIA DE LOS DISYUNTORES DEL ESPACIO (PUT parcial multi-tenant)
// -----------------------------------------------------------------------------
// Los DOS disyuntores del nodo activo del motor de portales viajan por el MISMO
// contrato de red (el ViewSet de Contenedores documenta `partial = True`):
//   · `espacio_unico`     → bloque monolítico (lib/espacioUnico.ts).
//   · `declarado_movible` → «🎒 Declarar como Mueble / Objeto» (lib/muebleMovil.ts).
//
// `declarado_movible` SÓLO existe en Contenedor: las Ubicaciones (habitación o
// planta) aceptan únicamente `espacio_unico`.
//
// Auth centralizada: getAuthHeaders()/API_BASE_URL SIEMPRE desde services/auth.
// Este módulo NUNCA define headers ni URLs propias.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../../../services/auth';
import { toast } from '../../mapaJerarquico';

/** PUT parcial de UN campo booleano sobre el recurso indicado. */
async function putBandera(
  recurso: 'contenedores' | 'ubicaciones',
  id: string,
  campo: 'espacio_unico' | 'declarado_movible',
  valor: boolean,
  etiqueta: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/${recurso}/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ [campo]: valor }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) return true;
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || `No se pudo guardar «${etiqueta}».`));
    return false;
  } catch {
    toast(`❌ Error de conexión al guardar «${etiqueta}».`);
    return false;
  }
}

/**
 * Persiste el flag `espacio_unico` del nodo activo (Contenedor o Ubicación): la
 * UI re-transiciona en caliente (bloque monolítico ⇄ grilla de divisiones).
 */
export function guardarEspacioUnico(
  id: string,
  valor: boolean,
  recurso: 'contenedores' | 'ubicaciones' = 'contenedores',
): Promise<boolean> {
  return putBandera(recurso, id, 'espacio_unico', valor, 'Espacio Único');
}

/**
 * Persiste el flag `declarado_movible` del CONTENEDOR activo («🎒 Mueble Móvil /
 * Objeto»): la pieza entra o sale de «Elementos por ubicar» sin recargar.
 */
export function guardarDeclaradoMovible(id: string, valor: boolean): Promise<boolean> {
  return putBandera('contenedores', id, 'declarado_movible', valor, 'Declarar como Mueble / Objeto');
}
