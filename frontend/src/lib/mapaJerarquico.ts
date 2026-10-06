// =============================================================================
// MAPA ESTOK - FACHADA PÚBLICA (barrel)
// -----------------------------------------------------------------------------
// Este archivo era el monolito original del mapa jerárquico. Su lógica fue
// fragmentada en submódulos limpios dentro de `src/lib/mapa/` para respetar el
// límite de mantenibilidad (< 400 líneas por archivo):
//
//   - mapaQueries.ts     → tipos, constantes, utilidades base y capa de acceso
//                          a datos (fetchUbicacionesPlano, guardar*, filtros de
//                          deduplicación de grupos fusionados).
//   - mapaArbolMapeo.ts  → transformaciones de estructuras jerárquicas y
//                          encastre de tiles (sub-grillas, minimapas y render
//                          del Mapa Estok).
//
// Se conserva esta fachada re-exportando TODO el API anterior para no romper a
// los consumidores que importan desde './mapaJerarquico' (0 regresiones).
// =============================================================================

export * from './mapa/mapaQueries';
export * from './mapa/mapaArbolMapeo';
export { COLOR_NARANJA } from './minimapa';
