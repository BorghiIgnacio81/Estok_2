// =============================================================================
// CARTEL UNIFICADO DE ELIMINACIÓN DESTRUCTIVA (protección de stock)
// -----------------------------------------------------------------------------
// Texto ÚNICO compartido por TODAS las mutaciones destructivas de estructuras
// (contenedores y ubicaciones) del proyecto. Se centraliza para que el aviso sea
// idéntico en cualquier pantalla: al eliminar un contenedor/ubicación, su
// contenido queda sin ubicación y su estructura se pierde.
// =============================================================================

export const ADVERTENCIA_ELIMINAR_ESTRUCTURA =
  'Si elimina este contenedor/ubicacion todo su contenido quedara sin ubicacion, se perdera su estructura etc. ¿Está seguro de que desea proceder?';

/**
 * Despliega el cartel unificado y devuelve true SOLO si el usuario confirma.
 * El `confirm` nativo es bloqueante: frena la ejecución antes de tocar el server.
 */
export function confirmarEliminacionEstructura(): boolean {
  return window.confirm(ADVERTENCIA_ELIMINAR_ESTRUCTURA);
}
