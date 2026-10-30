// =============================================================================
// CONTENIDO INTERNO DEL NODO ACTIVO · «Ver contenido interno»
// -----------------------------------------------------------------------------
// Panel derecho de la cascada de Almacenamiento: al abrir una CAJA / CONTENEDOR
// (ej. «Caja 01») el operador necesita ver QUÉ HAY ADENTRO, no sólo las
// sub-divisiones geométricas del lienzo elástico.
//
// Este bloque agrega, debajo del editor, un acordeón «📋 Ver contenido
// interno» con la lista de los OBJETOS guardados directamente en el nodo
// (nombre + casillero F·C + marca «En tránsito interno») y el acceso a la ficha
// completa del contenedor (/contenedores/:id), que lista todo el inventario
// interno incluidos los sub-contenedores.
//
// Módulo PURO (devuelve string HTML): no toca el DOM ni hace fetch. Los datos ya
// vienen resueltos en el `InteriorNodo` del nivel activo.
// =============================================================================

import { escapeHtml } from '../../mapaJerarquico';
import { indicadorTransitoHtml } from '../../indicadorTransito';
import type { NodoPortal } from './estadoPortales';
import type { ObjetoDto } from './datosNodosPortales';

/** Casillero fino legible del objeto («F1·C2» o «sin casillero»). */
function casilleroDe(objeto: ObjetoDto): string {
  return objeto.parent_grid_row != null && objeto.parent_grid_col != null
    ? `F${objeto.parent_grid_row}·C${objeto.parent_grid_col}`
    : 'sin casillero';
}

/** Fila de la lista: objeto real del nodo, enlazado a su ficha. */
function objetoFilaHtml(objeto: ObjetoDto): string {
  const transito = objeto.en_transito_interno
    ? ` ${indicadorTransitoHtml('interno', '🔴 pendiente de estante')}`
    : '';
  return `<li>
      <a href="/objetos/${escapeHtml(objeto.id)}"
         class="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-white border border-gray-200 hover:border-amber-300 hover:bg-amber-50 transition-base"
         title="Abrir la ficha de «${escapeHtml(objeto.nombre)}»">
        <span class="text-xs text-gray-800 truncate">📦 ${escapeHtml(objeto.nombre)}</span>
        <span class="text-[11px] text-gray-400 whitespace-nowrap">${escapeHtml(casilleroDe(objeto))}${transito}</span>
      </a>
    </li>`;
}

/**
 * Acordeón «Ver contenido interno» del nodo activo.
 *
 * Se abre por defecto cuando hay objetos guardados (el inventario de la caja es
 * lo primero que se quiere ver) y queda cerrado, con el conteo «0», cuando el
 * nodo está vacío. Incluye el acceso a la ficha completa del contenedor.
 */
export function contenidoInternoHtml(nodo: NodoPortal, objetos: ObjetoDto[]): string {
  const total = objetos.length;
  const cuerpo = total
    ? `<ul class="mt-2 space-y-1">${objetos.map(objetoFilaHtml).join('')}</ul>`
    : '<p class="mt-2 text-xs text-gray-500">Este espacio todavía no tiene objetos guardados directamente. Arrastrá uno desde la canasta inferior para asignarlo.</p>';
  const ficha =
    nodo.tipo === 'contenedor'
      ? `<a href="/contenedores/${escapeHtml(nodo.id)}"
            class="inline-flex items-center gap-1 mt-2 text-xs font-medium text-amber-700 hover:text-amber-900 underline"
            title="Ver la ficha completa del contenedor con TODO su inventario interno">
            🔎 Abrir ficha completa de «${escapeHtml(nodo.nombre)}»
          </a>`
      : '';
  return `
    <details class="portal-contenido-interno mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2"${total ? ' open' : ''}>
      <summary class="cursor-pointer select-none text-sm font-semibold text-gray-800">
        📋 Ver contenido interno de «${escapeHtml(nodo.nombre)}» · ${total} objeto(s)
      </summary>
      ${cuerpo}
      ${ficha}
    </details>`;
}
