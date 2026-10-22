// =============================================================================
// EVENTOS GLOBALES DEL MÓDULO DE DECISIONES
// -----------------------------------------------------------------------------
// Punto ÚNICO de los avisos "en caliente" entre las islas de /alertas-stock:
//
//   · EVENTO_DECISION_CAMBIADA      → se persistió una decisión (vender /
//     conservar / tirar) desde la ficha, la grilla de pendientes o el tablero.
//     Lo escuchan la sección destacada de venta y los bloques ya decididos para
//     recargar sus datos sin esperar a que el usuario refresque la página.
//   · EVENTO_PUBLICACION_ACTUALIZADA → el objeto se publicó (Mercado Libre /
//     Facebook): mueve la tarjeta de "sin publicar" a "ya publicados".
//
// Vive en un módulo neutro (sin imports) para que cualquier lib pueda emitir o
// escuchar estos eventos sin acoplarse a otra isla (evita ciclos de import).
// =============================================================================

export const EVENTO_DECISION_CAMBIADA = 'estok:decision-cambiada';
export const EVENTO_PUBLICACION_ACTUALIZADA = 'estok:publicacion-actualizada';

function emitir(nombre: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(nombre));
}

/** Avisa que una decisión patrimonial quedó persistida en el backend. */
export function notificarDecisionCambiada(): void {
  emitir(EVENTO_DECISION_CAMBIADA);
}

/** Avisa que cambió el estado de publicación de un objeto. */
export function notificarPublicacionActualizada(): void {
  emitir(EVENTO_PUBLICACION_ACTUALIZADA);
}
