// =============================================================================
// SECCIÓN «🗄 MUEBLES Y ESTRUCTURAS MÓVILES» · OBJETOS DE CATEGORÍA «MUEBLES»
// -----------------------------------------------------------------------------
// Pinta el bloque `muebles_objetos` del payload de GET /api/contenedores/arbol/:
// Objetos cuya categoría es «Muebles» / «Muebles y Estructuras Móviles» y que
// NO son cajas (`es_contenedor=False`). Una mesa o un sillón registrado como
// Objeto es mobiliario del Estok: se muestra DENTRO de la sección de muebles y
// NUNCA en «🧸 Objetos Sueltos o sin Caja».
//
// Capa 100% PURA (sin estado ni acceso al DOM). Vive aparte de
// listadoObjetosRender.ts para respetar la disciplina de modularidad (<400
// líneas por archivo de UI) y reutiliza la tarjeta de objeto de esa capa
// (Ver/Editar/Eliminar + ruta geográfica intactas).
// =============================================================================

import { objetoSueltoTarjetaHtml } from './listadoObjetosRender';
import type { ObjetoArbol } from './listadoObjetosPiezas';

/**
 * Bloque de OBJETOS de categoría «Muebles» sin caja, dentro de la sección de
 * muebles. Devuelve '' cuando la lista viene vacía (la sección se oculta sola).
 */
export function seccionMueblesObjetosHtml(objetos: ObjetoArbol[]): string {
  if (!objetos || objetos.length === 0) return '';
  const tarjetas = objetos.map((obj) => objetoSueltoTarjetaHtml(obj)).join('');
  return '<section class="bg-gradient-to-b from-slate-50 to-white border border-gray-200 rounded-2xl p-4 sm:p-5">'
    + '<div class="flex items-center justify-between gap-3 mb-4">'
    + '<h3 class="text-base sm:text-lg font-bold text-gray-800 flex items-center gap-2"><span class="text-xl">🪑</span> Muebles registrados como objeto</h3>'
    + '<span class="text-xs font-semibold text-gray-400 bg-white border border-gray-200 px-2.5 py-1 rounded-full">' + objetos.length + ' objeto(s)</span>'
    + '</div>'
    + '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">' + tarjetas + '</div>'
    + '</section>';
}
