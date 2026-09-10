// =============================================================================
// PLANTA ÚNICA - GRUPO DE FUSIÓN (persistencia consolidada + geometría)
// -----------------------------------------------------------------------------
// Un espacio fusionado (macro-estructura en "L") se edita SIEMPRE como un
// bloque: mover, redimensionar o renombrar recalcula la geometría/nombre de
// TODAS sus partes y la envía en UN ÚNICO PUT atómico a
// PUT /api/ubicaciones/{base}/grupo/  (una sola transacción en PostgreSQL).
//
// Auth 100% centralizada (services/auth).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';

export interface ParteGrupo {
  id: string;
  ui_left: string;
  ui_top: string;
  ui_width: string;
  ui_height: string;
}

/** PUT JSON con auth centralizada (JWT + X-Estok-Id). Devuelve true si fue 2xx. */
export async function putJson(url: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

/** Aplica nombre y/o geometría a TODAS las partes del grupo en un único PUT. */
export async function putGrupo(baseId: string, payload: Record<string, unknown>): Promise<boolean> {
  return putJson(`${API_BASE_URL}/ubicaciones/${baseId}/grupo/`, payload);
}

function porCiento(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}

function tiles(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLElement>('[data-tile-id]'));
}

function numero(el: HTMLElement, attr: string, def = 0): number {
  const n = parseFloat(el.dataset[attr] ?? '');
  return Number.isFinite(n) ? n : def;
}

/** Geometría nueva de cada parte al MOVER el bloque (delta en % del lienzo). */
export function partesTrasMover(card: HTMLElement, dL: number, dT: number): ParteGrupo[] {
  return tiles(card)
    .map((t) => ({
      id: t.dataset.tileId ?? '',
      ui_left: porCiento(numero(t, 'tileLeft') + dL),
      ui_top: porCiento(numero(t, 'tileTop') + dT),
      ui_width: porCiento(numero(t, 'tileWidth', 28)),
      ui_height: porCiento(numero(t, 'tileHeight', 24)),
    }))
    .filter((p) => p.id);
}

/**
 * Geometría nueva de cada parte al REDIMENSIONAR el bloque: se escala cada
 * módulo respecto del origen (esquina superior izquierda) del grupo, de modo
 * que la forma en "L" se conserve proporcionalmente.
 */
export function partesTrasEscalar(
  card: HTMLElement,
  origen: { left: number; top: number },
  escala: { x: number; y: number },
): ParteGrupo[] {
  return tiles(card)
    .map((t) => {
      const l = numero(t, 'tileLeft');
      const tp = numero(t, 'tileTop');
      const w = numero(t, 'tileWidth', 28);
      const h = numero(t, 'tileHeight', 24);
      return {
        id: t.dataset.tileId ?? '',
        ui_left: porCiento(origen.left + (l - origen.left) * escala.x),
        ui_top: porCiento(origen.top + (tp - origen.top) * escala.y),
        ui_width: porCiento(w * escala.x),
        ui_height: porCiento(h * escala.y),
      };
    })
    .filter((p) => p.id);
}
