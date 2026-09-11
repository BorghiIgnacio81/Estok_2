// =============================================================================
// LIENZO ELÁSTICO 2D - contrato genérico + adaptadores de persistencia
// -----------------------------------------------------------------------------
// Abstrae el motor 2D (render + arrastre + resizing + fusión en "L") para que
// se ejecute IDÉNTICO en TODOS los niveles del almacenamiento:
//   - Nivel 1/2 (Ubicación)   → Planta Única y muebles de la habitación.
//   - Nivel 3/4 (Contenedor)  → estantes/cajones internos de un mueble.
//
// Un `ItemElastico` es un rectángulo libre con geometría relativa (% del
// lienzo) y `fusion_grupo` opcional. El `AdaptadorEspacios` inyecta la
// persistencia multi-tenant (JWT + X-Estok-Id) del recurso concreto
// ('/ubicaciones' o '/contenedores') sin duplicar el motor.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';

export interface ItemElastico {
  id: string;
  nombre: string;
  /** Icono/emoji contextual opcional (🚽 🛏️ 🗄️ 🏠) que precede al nombre. */
  icono?: string | null;
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
  /** ID relacional del grupo de fusión (espacio en "L"): mismo valor = mismo rectángulo. */
  fusion_grupo?: string | null;
  /** Meta visual opcional (texto ya formateado) que se muestra bajo el nombre. */
  meta?: string | null;
  /** Conteos opcionales: si no hay `meta`, la tarjeta los compone automáticamente. */
  objetos_count?: number;
  contenedores_count?: number;
}

export interface AdaptadorEspacios {
  /** Recurso REST base: '/ubicaciones' | '/contenedores'. */
  recurso: string;
  /** PUT de geometría/nombre de un ítem suelto. */
  guardarItem(id: string, valores: Record<string, unknown>): Promise<boolean>;
  /** PUT consolidado de un grupo fusionado (nombre y/o partes). */
  guardarGrupo(baseId: string, payload: Record<string, unknown>): Promise<boolean>;
  /** POST fusión encadenada del grupo (base + ids). */
  fusionar(baseId: string, ids: string[]): Promise<boolean>;
  /** POST disolución del grupo de fusión. */
  separar(id: string): Promise<boolean>;
}

/** Request JSON con auth centralizada (JWT + X-Estok-Id). true si fue 2xx. */
async function enviar(
  url: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method,
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
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

/** Construye el adaptador de persistencia para un recurso espacial REST. */
export function crearAdaptadorEspacios(recurso: string): AdaptadorEspacios {
  const base = `${API_BASE_URL}${recurso}`;
  return {
    recurso,
    guardarItem: (id, valores) => enviar(`${base}/${id}/`, 'PUT', valores),
    guardarGrupo: (baseId, payload) => enviar(`${base}/${baseId}/grupo/`, 'PUT', payload),
    fusionar: (baseId, ids) => enviar(`${base}/${baseId}/fusionar/`, 'POST', { ubicacion_ids: ids }),
    separar: (id) => enviar(`${base}/${id}/separar/`, 'POST', {}),
  };
}

/** Adaptador por defecto del motor (Ubicación, Nivel 1/2). */
export const adaptadorUbicaciones = (): AdaptadorEspacios => crearAdaptadorEspacios('/ubicaciones');

/** Adaptador de Contenedor (Nivel 3/4: muebles y sus estantes internos). */
export const adaptadorContenedores = (): AdaptadorEspacios => crearAdaptadorEspacios('/contenedores');
