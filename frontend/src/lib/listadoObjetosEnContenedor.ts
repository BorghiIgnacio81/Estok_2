// =============================================================================
// SECCIÓN «📦 OBJETOS EN CONTENEDOR» DEL LISTADO DE OBJETOS (/objetos)
// -----------------------------------------------------------------------------
// Los objetos guardados DENTRO de una caja, de un mueble o de un espacio lógico
// sólo se veían como viñetas plegadas dentro de la tarjeta de su contenedor: al
// quitar los filtros —o al filtrar por categoría («Coleccionables»,
// «Artesanías»)— el ítem quedaba oculto y el inventario parecía incompleto.
//
// Esta capa (100% PURA, sin estado ni DOM) pinta UNA TARJETA POR ÍTEM con la
// insignia de su ubicación («📦 En Caja 02»). El payload lo entrega el backend
// en `objetos_en_contenedor` (arbol_inventario_objetos_en_contenedor.py), que ya
// resuelve `contenedor_tipo` y `contenedor_etiqueta` en memoria (cero N+1).
//
// Los chips y helpers visuales se reutilizan de listadoObjetosPiezas.ts: acá no
// se duplica ninguna regla de presentación del inventario.
// =============================================================================

import {
  chipCategoria,
  chipDecision,
  chipEstado,
  chipPublicado,
  esc,
  fotoDe,
  numerico,
} from './listadoObjetosPiezas';

/** Objeto almacenado dentro de un contenedor (contrato del backend). */
export interface ObjetoEnContenedor {
  [key: string]: any;
  id?: string;
  nombre?: string;
  /** 'caja' | 'mueble' | 'espacio' — naturaleza física del contenedor. */
  contenedor_tipo?: string | null;
  /** Nombre legible del contenedor que lo aloja («Caja 02»). */
  contenedor_etiqueta?: string | null;
}

/** Insignia por naturaleza del contenedor (espejo del backend). */
const ICONO_CONTENEDOR: Record<string, string> = {
  caja: '📦',
  mueble: '🗄️',
  espacio: '🧩',
};

/**
 * Insignia visual de la ubicación del ítem: «📦 En Caja 02».
 *
 * Sin nombre de contenedor devuelve cadena vacía: la tarjeta no muestra una
 * insignia vacía ni un texto inventado.
 */
export function badgeContenedorHtml(obj: ObjetoEnContenedor): string {
  const nombre = String(obj.contenedor_etiqueta || '').trim();
  if (!nombre) return '';
  const icono = ICONO_CONTENEDOR[String(obj.contenedor_tipo || '')] || '📦';
  return '<span class="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 '
    + 'border border-amber-200 px-2 py-0.5 text-[11px] font-semibold max-w-full">'
    + '<span class="shrink-0">' + icono + '</span>'
    + '<span class="truncate" title="' + esc(nombre) + '">En ' + esc(nombre) + '</span>'
    + '</span>';
}

/** Tarjeta individual de un objeto almacenado dentro de un contenedor. */
function tarjetaHtml(obj: ObjetoEnContenedor): string {
  const nombre = esc(obj.nombre);
  const badge = badgeContenedorHtml(obj);
  const ruta = String(obj.ubicacion_display || obj.ubicacion_nombre || '').trim();
  const rutaHtml = ruta
    ? '<p class="text-[11px] text-gray-400 truncate" title="' + esc(ruta) + '">📍 ' + esc(ruta) + '</p>'
    : '';
  return '<article class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-base flex flex-col">'
    + '<div class="relative h-32 bg-slate-100 flex items-center justify-center overflow-hidden">'
    + '<img src="' + fotoDe(obj) + '" alt="' + nombre + '" class="h-full w-full object-cover" loading="lazy" />'
    + '<div class="absolute top-2 left-2 flex flex-wrap gap-1">' + chipCategoria(obj) + chipPublicado(obj) + '</div>'
    + '</div>'
    + '<div class="p-3 flex-1 flex flex-col gap-1.5">'
    + '<h3 class="font-semibold text-gray-900 text-sm leading-snug line-clamp-2" title="' + nombre + '">' + nombre + '</h3>'
    + '<div class="flex flex-wrap items-center gap-1">' + badge + chipEstado(obj) + chipDecision(obj) + '</div>'
    + rutaHtml
    + '<div class="mt-auto flex items-center justify-between gap-1 pt-2 border-t border-gray-100">'
    + '<a href="/objetos/' + esc(obj.id) + '" class="text-xs font-semibold text-blue-700 hover:underline">Ver</a>'
    + '<div class="flex items-center gap-2">'
    + '<a href="/objetos/' + esc(obj.id) + '/editar" class="text-xs text-gray-500 hover:text-blue-700 hover:underline">Editar</a>'
    + '<button type="button" class="js-eliminar-objeto text-xs text-gray-400 hover:text-red-600 cursor-pointer" data-id="' + esc(obj.id) + '" data-nombre="' + nombre + '">Eliminar</button>'
    + '</div></div>'
    + '</div></article>';
}

/**
 * Grilla completa de la sección. Devuelve cadena vacía si no hay ítems: el
 * controlador esconde la sección en vez de dejar un bloque huérfano.
 */
export function seccionObjetosEnContenedorHtml(items: ObjetoEnContenedor[]): string {
  const lista = (items || []).filter((obj) => obj && obj.id);
  if (lista.length === 0) return '';
  return '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">'
    + lista.map(tarjetaHtml).join('')
    + '</div>';
}

/** Contador legible para el encabezado («12 objetos almacenados»). */
export function contadorObjetosEnContenedor(items: ObjetoEnContenedor[]): string {
  const total = numerico((items || []).length);
  if (total === 0) return '';
  return total + (total === 1 ? ' objeto almacenado' : ' objetos almacenados');
}
