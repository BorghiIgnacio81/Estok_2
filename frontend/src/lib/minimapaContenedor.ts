// =============================================================================
// MINIMAPA DE CONTENEDOR - contexto de ubicaciones + grilla del macro-Estok
// -----------------------------------------------------------------------------
// Provee el MINIMAPA ULTRA-MINI que la ficha de una CAJA (contenedor pequeño)
// muestra en su esquina superior: pinta en NARANJA (#f97316) el cuadrante
// exacto de la habitación/planta donde reside el contenedor.
//
// Reutiliza el motor de minimapas ya existente (src/lib/mapaJerarquico.ts →
// minimapaPlantaHtml) y la carga de contexto de la app (fetchUbicacionesPlano +
// fetchEstokConfig). NO duplica getAuthHeaders(): toda la red pasa por
// src/services/auth a través de esos helpers.
// =============================================================================

import {
  minimapaPlantaHtml,
  fetchUbicacionesPlano,
  fetchEstokConfig,
  type UbicacionPlano,
} from './mapaJerarquico';
import { inyectarCssMinimapa } from './minimapa';

// ---------------------------------------------------------------------------
// Estado del contexto (se carga una sola vez por documento)
// ---------------------------------------------------------------------------

const ubicacionesPorId = new Map<string, UbicacionPlano>();
let estokFilas = 3;
let estokColumnas = 3;
let contextoCargado = false;

function entero(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

/**
 * Carga (una sola vez) el plano de ubicaciones y la grilla del macro-Estok
 * activo, e inyecta el CSS base del minimapa ULTRA-MINI. Es idempotente: si el
 * contexto ya está cargado no repite las consultas.
 */
export async function cargarContextoMinimapa(): Promise<void> {
  inyectarCssMinimapa();
  if (contextoCargado) return;
  try {
    const [ubicaciones, estok] = await Promise.all([
      fetchUbicacionesPlano(),
      fetchEstokConfig(),
    ]);
    ubicacionesPorId.clear();
    for (const u of ubicaciones) ubicacionesPorId.set(u.id, u);
    if (estok) {
      estokFilas = entero(estok.grid_filas, 3);
      estokColumnas = entero(estok.grid_columnas, 3);
    }
    contextoCargado = true;
  } catch {
    // Sin contexto el minimapa degrada a "sin cuadrante"; el listado sigue igual.
  }
}

/**
 * HTML del minimapa ULTRA-MINI de la ubicación de un contenedor. Pinta en
 * NARANJA (#f97316) el cuadrante exacto de la habitación/planta donde reside.
 */
export function minimapaUbicacionHtml(ubicacionId: string | null | undefined): string {
  const u = ubicacionId ? ubicacionesPorId.get(String(ubicacionId)) : undefined;
  return minimapaPlantaHtml(estokFilas, estokColumnas, u ?? null);
}
