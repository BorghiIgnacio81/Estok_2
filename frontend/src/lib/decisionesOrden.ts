// =============================================================================
// ORDEN DE LAS TARJETAS DEL TABLERO DE DECISIONES (Lote 31 · punto 1)
// -----------------------------------------------------------------------------
// Regla: las votaciones ACTIVAS/PENDIENTES y los objetos todavía SIN decisión se
// leen ARRIBA; las decisiones YA RESUELTAS/CERRADAS quedan relegadas al FONDO de
// su grilla.
//
// El orden de los BLOQUES de la página (pages/alertas-stock/index.astro) ya era
// «urgente primero» por markup; lo que faltaba era el orden DENTRO de cada
// grilla, que hasta ahora era el del payload del backend
// (`DecisionVotacion.Meta.ordering = ['-created_at']` y el orden del ORM).
//
// Módulo 100% PURO (sin DOM, sin fetch, sin estado): la MISMA regla la consumen
// votacionesDecisiones.ts, decisionesPendientes.ts y decisionesGrupos.ts, así el
// criterio vive en un único lugar y no se re-implementa por consumidor.
//
// Determinismo: el `sort` de JS es estable (ES2019+), así que entre elementos con
// la misma clave se conserva el orden original del backend.
// =============================================================================

/** Votación tal como la devuelve GET /api/decisiones/pendientes/. */
export interface VotacionOrdenable {
  estado?: string | null;
  /** Votos que faltan para que el Estok resuelva (menos = más cerca del cierre). */
  votos_faltantes?: number | null;
  created_at?: string | null;
}

/** Subconjunto del objeto del tablero que decide su orden de lectura. */
export interface ObjetoOrdenable {
  owner_action?: string | null;
  despachado_en?: string | null;
  en_periodo_gracia?: boolean | null;
  descarte_listo_para_ejecutar?: boolean | null;
  /** Vencimiento del período de reclamo (sólo objetos con decisión de Tirar). */
  fecha_limite_descarte?: string | null;
}

/** Grupos del bloque «Decisiones tomadas» (Bloques 3, 4 y 5 de la pestaña). */
export type GrupoDecision = 'vender' | 'tirar' | 'conservar';

/** Estados de votación que ya NO admiten voto: van al fondo de la grilla. */
const ESTADOS_VOTACION_CERRADOS = new Set(['resuelta', 'cancelada', 'cerrada', 'cerrado']);

function tiempo(valor?: string | null): number {
  const ms = Date.parse(String(valor ?? ''));
  return Number.isNaN(ms) ? 0 : ms;
}

/** Compara por criterios EN ORDEN: el primero que devuelve diferencia decide. */
function comparar<T>(a: T, b: T, criterios: Array<(item: T) => number>): number {
  for (const criterio of criterios) {
    const diferencia = criterio(a) - criterio(b);
    if (diferencia !== 0) return diferencia;
  }
  return 0;
}

// -----------------------------------------------------------------------------
// BLOQUE 1 · 🗳️ Votaciones pendientes del Estok
// -----------------------------------------------------------------------------

/** 0 = activa/pendiente (arriba) · 1 = resuelta/cancelada (al fondo). */
export function rangoEstadoVotacion(estado?: string | null): number {
  return ESTADOS_VOTACION_CERRADOS.has(String(estado ?? '').toLowerCase()) ? 1 : 0;
}

/**
 * Votaciones ACTIVAS primero; entre ellas, la más cercana a resolverse (menos
 * votos faltantes) y, a igualdad, la más ANTIGUA (FIFO: la que espera hace más
 * tiempo). Las resueltas/canceladas caen siempre al fondo.
 */
export function ordenarVotaciones<T extends VotacionOrdenable>(votaciones: T[]): T[] {
  return [...votaciones].sort((a, b) =>
    comparar(a, b, [
      (v) => rangoEstadoVotacion(v.estado),
      (v) => Number(v.votos_faltantes ?? 0),
      (v) => tiempo(v.created_at),
    ]),
  );
}

// -----------------------------------------------------------------------------
// BLOQUE 2 · 🧭 Objetos pendientes de decisión
// -----------------------------------------------------------------------------

/** 0 = todavía sin decisión (activo, arriba) · 1 = ya decidido (al fondo). */
export function rangoDecisionObjeto(obj: ObjetoOrdenable): number {
  return obj.owner_action ? 1 : 0;
}

/** Los objetos que todavía esperan decisión se leen antes que los ya decididos. */
export function ordenarPendientesDecision<T extends ObjetoOrdenable>(objetos: T[]): T[] {
  return [...objetos].sort((a, b) => comparar(a, b, [rangoDecisionObjeto]));
}

// -----------------------------------------------------------------------------
// BLOQUES 3, 4 y 5 · Decisiones tomadas
// -----------------------------------------------------------------------------

/**
 * ¿El caso ya está CERRADO? (0 = sigue activo → arriba · 1 = cerrado → al fondo)
 *   · vender    → cerrado cuando el objeto ya fue DESPACHADO al comprador.
 *   · tirar     → cerrado cuando VENCIÓ el período de reclamo
 *                 (`descarte_listo_para_ejecutar`): ya no hay acción posible del
 *                 inquilinato, sólo la baja física del Administrador. Mientras la
 *                 gracia está vigente el caso sigue ACTIVO (se puede reclamar).
 *   · conservar → es una lista de protección: nunca se «cierra».
 */
export function rangoCierreGrupo(obj: ObjetoOrdenable, grupo: GrupoDecision): number {
  if (grupo === 'vender') return obj.despachado_en ? 1 : 0;
  if (grupo === 'tirar') return obj.descarte_listo_para_ejecutar ? 1 : 0;
  return 0;
}

/** Orden de lectura de cada grilla del bloque «Decisiones tomadas». */
export function ordenarGrupoDecisiones<T extends ObjetoOrdenable>(
  objetos: T[],
  grupo: GrupoDecision,
): T[] {
  return [...objetos].sort((a, b) =>
    comparar(a, b, [
      (o) => rangoCierreGrupo(o, grupo),
      // «Tirar»: el plazo de reclamo que vence ANTES va primero (más urgente).
      (o) =>
        grupo === 'tirar' && o.en_periodo_gracia
          ? tiempo(o.fecha_limite_descarte) || Number.MAX_SAFE_INTEGER
          : 0,
      // «Conservar»: los reclamados para mudanza (acción reciente) van primero.
      (o) => (o.owner_action === 'mudar' ? 0 : 1),
    ]),
  );
}

// -----------------------------------------------------------------------------
// SECCIÓN DESTACADA · 🏷️ Objetos con decisión de venta (/alertas-stock)
// -----------------------------------------------------------------------------

/** Objeto vendible: publicado en alguna plataforma de venta o no. */
export interface ObjetoVendibleOrdenable extends ObjetoOrdenable {
  publicado?: boolean | null;
  plataformas_publicadas?: string[] | null;
}

/** ¿Ya está publicado en Mercado Libre / Facebook? */
export function estaPublicado(obj: ObjetoVendibleOrdenable): boolean {
  return Boolean(obj.publicado) || (obj.plataformas_publicadas?.length ?? 0) > 0;
}

/**
 * Orden de la sección destacada de venta: PRIMERO los que están listos para
 * publicar (📢 acción directa «Publicar / Generar Anuncio»), después los ya
 * publicados (🔗 link a la publicación) y al fondo los ya despachados.
 */
export function ordenarVentasDestacadas<T extends ObjetoVendibleOrdenable>(
  objetos: T[],
): T[] {
  return [...objetos].sort((a, b) =>
    comparar(a, b, [
      (o) => (o.despachado_en ? 2 : estaPublicado(o) ? 1 : 0),
    ]),
  );
}
