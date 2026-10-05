// =============================================================================
// ACCESO AL DOM - helper ÚNICO de las pantallas de Objetos
// -----------------------------------------------------------------------------
// `ref(id)` devuelve el elemento por id ya tipado. Los módulos de comportamiento
// (editarObjetoFotos / editarObjetoPrecio / editarObjetoForm) lo comparten para
// no repetir el mismo `getElementById(...) as T` en cada archivo.
// Se resuelve al inicializar cada módulo, cuando el markup de la página ya existe.
// =============================================================================

/** Elemento del DOM por id, ya casteado al tipo esperado. */
export function ref<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/**
 * Elemento del DOM por id, ya casteado, o `null` si no existe.
 * Se usa en los nodos opcionales (botones/paneles que pueden no montarse) para
 * no depender de la aserción de no-nulo cuando el elemento es realmente dudoso.
 */
export function refOpcional<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
