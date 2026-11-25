// =============================================================================
// LISTA MÓVIL DE OBJETOS (/objetos) · CAPA DE VISTA (HTML puro, sin DOM)
// -----------------------------------------------------------------------------
// Construye el HTML de la vista móvil:
//   1. Renglones compactos de detalle: MINIFOTO cuadrada a la izquierda,
//      nombre + ubicación/categoría al centro y badge de estado/decisión con
//      menú rápido de acciones a la derecha (el mismo formato de las viñetas
//      internas de una caja, llevado a fila navegable con foto grande).
//   2. Píldoras de los filtros activos acumulados, cada una con su ✕.
// No define estado ni consulta la API: sólo compone cadenas escapadas.
// =============================================================================

import { escapeHtml as esc } from '../../escapeHtml';
// Chips de estado y decisión: FUENTE ÚNICA compartida con las tarjetas.
import { chipDecision, chipEstado } from '../../listadoObjetosPiezas';
// Badge inteligente de la caja (llena / con espacio / vacía), con su toggle.
import { badgeEstadoCajaHtml } from '../../cajaEstadoBadge';
import type { CajaEstadoFuente } from '../../cajaEstadoBadge';
// `data-*` de las acciones operativas del contenedor: FUENTE ÚNICA.
import { atributosCajaHtml } from '../../cajaOperativa';
import type { CajaOperable } from '../../cajaOperativa';
import { etiquetaCriterio } from './listaObjetosMovilDatos';
import type { FiltroMovilActivo, ItemListaMovil } from './listaObjetosMovilDatos';

const CLASE_CHIP = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold';
const CLASE_ITEM_MENU = 'block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 cursor-pointer';

/** Badge(s) de la derecha: estado/decisión del objeto o estado de la caja. */
function badgesDerechaHtml(item: ItemListaMovil): string {
  if (item.tipo === 'contenedor') {
    if (item.origen === 'mueble') {
      return '<span class="' + CLASE_CHIP + ' bg-slate-100 text-slate-600">🗄 ' + item.objetos + ' ítem(s)</span>';
    }
    return badgeEstadoCajaHtml(item.datos as CajaEstadoFuente);
  }
  return chipEstado(item.datos) + chipDecision(item.datos);
}

/** Chips del centro: categoría (objetos) o naturaleza (cajas y muebles). */
function chipsCentroHtml(item: ItemListaMovil): string {
  let html = '';
  if (item.tipo === 'objeto') {
    html = '<span class="' + CLASE_CHIP + ' bg-slate-100 text-slate-600">'
      + esc(item.categoria || 'Sin categoría') + '</span>';
  } else {
    html = '<span class="' + CLASE_CHIP + ' bg-amber-100 text-amber-900 border border-amber-200">'
      + esc(item.tipoEtiqueta) + '</span>';
  }
  if (item.contenedor) {
    html += '<span class="' + CLASE_CHIP + ' bg-amber-50 text-amber-800 border border-amber-200 max-w-full">'
      + '<span class="truncate">' + esc(item.contenedor) + '</span></span>';
  }
  return html;
}

/** Menú rápido de acciones (details/summary: funciona sin JavaScript extra). */
function menuAccionesHtml(item: ItemListaMovil): string {
  const nombre = esc(item.nombre);
  const etiquetaVer = item.tipo === 'objeto' ? 'Ver ficha' : 'Ver contenedor';
  let html = '<a href="' + esc(item.href) + '" class="' + CLASE_ITEM_MENU + ' text-gray-700">👁️ '
    + etiquetaVer + '</a>';

  if (item.editableComoObjeto && item.hrefEditar) {
    html += '<a href="' + esc(item.hrefEditar) + '" class="' + CLASE_ITEM_MENU + ' text-gray-700">✏️ Editar</a>';
  } else if (!item.editableComoObjeto) {
    // Contenedor real: los botones operativos leen sus metadatos de `data-*`.
    const attrs = atributosCajaHtml(item.datos as CajaOperable);
    html += '<button type="button" class="js-editar-caja ' + CLASE_ITEM_MENU + ' text-gray-700" '
      + attrs + '>✏️ Editar</button>';
    if (item.origen === 'caja') {
      html += '<button type="button" class="js-mover-caja ' + CLASE_ITEM_MENU + ' text-gray-700" '
        + attrs + '>📦 Mover</button>';
    }
    html += '<button type="button" class="js-eliminar-caja ' + CLASE_ITEM_MENU + ' text-red-600 hover:bg-red-50" '
      + attrs + '>🗑️ Eliminar</button>';
    return envolverMenu(html, nombre);
  }

  html += '<button type="button" class="js-eliminar-objeto ' + CLASE_ITEM_MENU
    + ' text-red-600 hover:bg-red-50" data-id="' + esc(item.id)
    + '" data-nombre="' + nombre + '">🗑️ Eliminar</button>';
  return envolverMenu(html, nombre);
}

/** Panel desplegable del menú (summary «⋯» + acciones). */
function envolverMenu(contenido: string, nombre: string): string {
  return '<details class="js-menu-movil relative">'
    + '<summary class="list-none cursor-pointer inline-flex h-8 w-8 items-center justify-center rounded-full '
    + 'bg-slate-100 text-lg leading-none text-gray-600 hover:bg-slate-200 active:scale-95 '
    + '[&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400" '
    + 'aria-label="Acciones de ' + nombre + '" title="Acciones rápidas">⋯</summary>'
    + '<div class="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">'
    + contenido + '</div></details>';
}

/**
 * Renglón compacto de la lista: [minifoto] [nombre + ubicación/categoría]
 * [badge de estado/decisión + menú de acciones].
 */
export function filaItemMovilHtml(item: ItemListaMovil): string {
  const nombre = esc(item.nombre);
  const ubicacion = item.ubicacion ? '📍 ' + esc(item.ubicacion) : '📍 Sin ubicación';
  return '<article class="flex items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-amber-50/60">'
    + '<img src="' + esc(item.foto) + '" alt="" class="h-12 w-12 shrink-0 rounded-lg bg-slate-100 object-cover" loading="lazy" />'
    + '<div class="min-w-0 flex-1">'
    + '<a href="' + esc(item.href) + '" class="block truncate text-sm font-semibold leading-tight text-gray-900 hover:text-blue-700 hover:underline" '
    + 'title="' + nombre + '">' + nombre + '</a>'
    + '<p class="mt-0.5 truncate text-[11px] leading-tight text-gray-500" title="' + ubicacion + '">' + ubicacion + '</p>'
    + '<div class="mt-1 flex flex-wrap items-center gap-1">' + chipsCentroHtml(item) + '</div>'
    + '</div>'
    + '<div class="flex shrink-0 flex-col items-end gap-1">'
    + '<span class="flex max-w-[8rem] flex-wrap justify-end gap-1">' + badgesDerechaHtml(item) + '</span>'
    + menuAccionesHtml(item)
    + '</div></article>';
}

/** HTML de todos los renglones (cadena vacía si no hay ítems). */
export function filasListaMovilHtml(items: ItemListaMovil[]): string {
  if (!items.length) return '';
  return items.map(filaItemMovilHtml).join('');
}

/** Píldoras de los filtros activos: «Categoría: Libros ✕». */
export function pildorasFiltrosHtml(filtros: FiltroMovilActivo[]): string {
  return filtros.map((filtro) => {
    const texto = etiquetaCriterio(filtro.criterio) + ': ' + filtro.etiqueta;
    return '<span class="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 py-1 pl-2.5 pr-1 '
      + 'text-[11px] font-semibold text-amber-900">'
      + '<span class="max-w-[10rem] truncate" title="' + esc(texto) + '">' + esc(texto) + '</span>'
      + '<button type="button" data-quitar-filtro="' + filtro.criterio + '" title="Quitar filtro" '
      + 'aria-label="Quitar filtro ' + esc(texto) + '" '
      + 'class="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-amber-700 hover:bg-amber-200 hover:text-red-700">✕</button>'
      + '</span>';
  }).join('');
}
