// =============================================================================
// RENDER DE LAS TRES SECCIONES DEL LISTADO JERÁRQUICO DE OBJETOS
// -----------------------------------------------------------------------------
// Capa 100% PURA (sin estado ni acceso al DOM) extraída del controlador
// listadoJerarquicoObjetos.ts para cumplir la disciplina de modularidad
// (<400 líneas por archivo). Las micro-piezas (tipos, chips, viñetas) viven en
// listadoObjetosPiezas.ts. Expone:
//   1. Helpers de clasificación taxonómica en el cliente (defensa en profundidad
//      sobre el filtro ORM del backend):
//        · esCajaMovilEnBloqueCajas → SECCIÓN 1: SOLO `tipo='CAJA'` y
//          `es_inmueble=false`. El Armario Empotrado / Setup PC (inmuebles
//          fijos) quedan FUERA de la cima del inventario.
//        · esMuebleMovil           → SECCIÓN 3: SOLO `tipo='MUEBLE'` mudable.
//   2. Constructores de tarjeta y de cada sección completa.
// Auth/acciones operativas viven en cajaOperativa.ts y rutaCajaMinimapas.ts.
// =============================================================================

import {
  chipCategoria,
  chipDecision,
  chipEstado,
  chipPublicado,
  chevronSvg,
  contenidoBulletsHtml,
  esInmueble,
  esc,
  fotoDe,
  numerico,
} from './listadoObjetosPiezas';
import type { GrupoEstructura, NodoContenedor, ObjetoArbol } from './listadoObjetosPiezas';
import {
  filaAccionesCajaHtml,
  sumarioCategoriasHtml,
} from './cajaOperativa';
import { rutaMinimapasHtml } from './rutaCajaMinimapas';
import type { NodoCaja } from './rutaCajaMinimapas';

// Re-export del contrato del payload y del escapador para los consumidores.
export type { GrupoEstructura, NodoContenedor, ObjetoArbol, PayloadArbol } from './listadoObjetosPiezas';
export { esc };

// ---------------------------------------------------------------------------
// Constantes visuales
// ---------------------------------------------------------------------------

const IMG_ARMARIO = '/archivador-login.png';
const IMG_CAJA = '/Nuevo Contenedor.png';

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

function tieneSubContenedores(nodo: NodoContenedor): boolean {
  // La API aplica la TAXONOMÍA ESTRICTA de la pestaña de Objetos y YA NO anida
  // sub-contenedores (estanterías) en `contenido`. El conteo real de
  // sub-divisiones internas del mueble viaja como metadato en
  // `subcontenedores_count`, para conservar el icono/etiqueta correctos.
  if ((nodo.contenido || []).some((x) => x && x.tipo === 'contenedor')) return true;
  return numerico(nodo.subcontenedores_count) > 0;
}

function imagenContenedor(nodo: NodoContenedor): string {
  // La foto física subida por el operador (modal «Editar») tiene prioridad.
  if (nodo.foto) return esc(nodo.foto);
  return esInmueble(nodo) || tieneSubContenedores(nodo) ? IMG_ARMARIO : IMG_CAJA;
}

/**
 * SECCIÓN 1 · Caja móvil menor admisible en la cima del inventario.
 * Regla de descarte ABSOLUTA: SOLO `tipo_contenedor === 'CAJA'` con
 * `es_inmueble = false`. Cualquier estructura fija (Armario Empotrado,
 * Setup PC, etc.) queda removida de este primer bloque.
 */
export function esCajaMovilEnBloqueCajas(nodo: NodoContenedor): boolean {
  return nodo.tipo_contenedor === 'CAJA' && !esInmueble(nodo);
}

/**
 * Mueble móvil de la SECCIÓN 3 (defensa en profundidad sobre el filtro ORM del
 * backend): SOLO `tipo_contenedor === 'MUEBLE'` y NUNCA un mueble inmueble fijo
 * (`es_inmueble = true`). Los `tipo='ESTANTE'` y `tipo='CAJA'` jamás entran acá.
 */
export function esMuebleMovil(nodo: NodoContenedor): boolean {
  return nodo.tipo_contenedor === 'MUEBLE' && !esInmueble(nodo);
}

// ---------------------------------------------------------------------------
// Tarjetas de contenedor (cajas y muebles)
// ---------------------------------------------------------------------------

interface TarjetaOpts {
  /** Etiqueta de tipo mostrada en el subtítulo de la tarjeta. */
  tipoLabel?: string;
  /** HTML de la hilera de minimapas ULTRA-MINI (Sección 1: Piso→Habitación→Mueble). */
  minimapa?: string;
  /** Alineación vertical del lateral: 'start' cuando hay minimapa, si no 'center'. */
  alinear?: 'start' | 'center';
  /** Inyecta el sumario dinámico por categoría bajo los minimapas (Sección 1). */
  sumario?: boolean;
  /** Inyecta la fila de acciones Mover/Editar/Eliminar al pie, fuera del <details>. */
  acciones?: boolean;
  /** Oculta el botón «Mover» en la fila de acciones (muebles de la Sección 3). */
  mostrarMover?: boolean;
}

/** Tarjeta de contenedor (caja / mueble) colapsada por defecto. */
function contenedorTarjetaHtml(nodo: NodoContenedor, opts: TarjetaOpts = {}): string {
  const contenido = nodo.contenido || [];
  const tieneContenido = contenido.length > 0;
  const tipoLabel = opts.tipoLabel ?? (esInmueble(nodo)
    ? '📌 Mueble fijo (inmueble)'
    : (tieneSubContenedores(nodo) ? '🗄️ Mueble con sub-contenedores' : '📦 Caja/Contenedor'));
  const subtitulo = [
    tipoLabel,
    nodo.material ? esc(nodo.material) : '',
    numerico(nodo.subcontenedores_count) + ' sub-caja(s) · ' + numerico(nodo.objetos_count) + ' objeto(s)',
  ].filter(Boolean).join(' · ');

  // Con minimapa/sumario (Sección 1) el ícono va arriba; el resto conserva el
  // centrado original. El minimapa y su sumario se anclan en la LÍNEA INFERIOR
  // INMEDIATA del título (bloque compacto de coordenadas + stock fino), NUNCA
  // en el lateral. El sumario solo se inyecta cuando la sección lo pide.
  const conDetalle = Boolean(opts.minimapa || opts.sumario);
  const alineacionIdentidad = conDetalle ? 'items-start' : 'items-center';

  const identidad = '<span class="flex ' + alineacionIdentidad + ' gap-3 min-w-0">'
    + '<img src="' + imagenContenedor(nodo) + '" alt="" class="h-12 w-12 rounded-xl object-cover shrink-0 bg-slate-50 border border-gray-100" />'
    + '<span class="min-w-0 flex-1">'
    + '<h3 class="text-xl font-extrabold text-gray-900 leading-tight truncate" title="' + esc(nodo.nombre) + '">' + esc(nodo.nombre) + '</h3>'
    + (opts.minimapa ? '<div class="mt-1.5 min-w-0">' + opts.minimapa + '</div>' : '')
    + (opts.sumario ? sumarioCategoriasHtml(contenido) : '')
    + '<span class="block text-[11px] text-gray-500 mt-0.5 truncate">' + subtitulo + '</span>'
    + '</span></span>';

  // Bloque lateral: SOLO la acción "Abrir" (el minimapa se movió bajo el título).
  const accion = '<a href="/contenedores/' + esc(nodo.id) + '" class="inline-flex items-center px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-base">Abrir ↗</a>';
  const lateral = '<span class="flex shrink-0 flex-col items-end gap-2">'
    + '<span class="flex items-center gap-1.5">' + accion
    + (tieneContenido ? chevronSvg('h-4 w-4') : '')
    + '</span></span>';

  // Fila de acciones operativas (Mover/Editar/Eliminar) fuera del <details>.
  const acciones = opts.acciones
    ? filaAccionesCajaHtml(nodo, { mostrarMover: opts.mostrarMover !== false })
    : '';

  const alineacion = opts.alinear === 'start' ? 'items-start' : 'items-center';

  // Contenedor VACÍO: tarjeta compacta estática (no hay nada que expandir).
  if (!tieneContenido) {
    return '<article class="relative bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-base flex flex-col">'
      + '<div class="flex ' + alineacion + ' justify-between gap-3 p-4">'
      + '<span class="min-w-0 flex-1">' + identidad + '</span>'
      + lateral
      + '</div>'
      + '<div class="px-4 pb-4"><p class="text-sm text-gray-400 italic">— Sin contenido —</p></div>'
      + acciones
      + '</article>';
  }

  // Acordeón nativo HTML5: nace CERRADO (sin atributo open) para máxima densidad.
  return '<article class="relative bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-base flex flex-col">'
    + '<details class="group cursor-pointer">'
    + '<summary class="flex ' + alineacion + ' justify-between gap-3 p-4 list-none font-bold text-slate-800 cursor-pointer select-none [&::-webkit-details-marker]:hidden hover:bg-slate-50 transition-colors duration-150">'
    + '<span class="min-w-0 flex-1">' + identidad + '</span>'
    + lateral
    + '</summary>'
    + '<div class="estok-cuerpo-detalle px-4 pb-4 pt-1">'
    + '<p class="text-[11px] uppercase tracking-wider text-gray-400 font-bold mb-2">Contenido</p>'
    + '<ul class="space-y-px">' + contenidoBulletsHtml(contenido, 0) + '</ul>'
    + '</div>'
    + '</details>'
    + acciones
    + '</article>';
}

// ---------------------------------------------------------------------------
// Secciones completas (devuelven '' si la sección queda vacía)
// ---------------------------------------------------------------------------

/**
 * Grupo de contenedores de una misma Ubicación (espacio de la casa), filtrado
 * por sección. Devuelve '' cuando la ubicación no aporta tarjetas a esa sección
 * (así no se renderizan cabeceras vacías).
 */
function grupoEstructurasHtml(
  grupo: GrupoEstructura,
  filtrar: (nodo: NodoContenedor) => boolean,
  tarjeta: (nodo: NodoContenedor) => string,
): string {
  const contenedores = (grupo.contenedores || []).filter(filtrar);
  if (contenedores.length === 0) return '';
  const contenedoresHtml = contenedores.map(tarjeta).join('');
  return '<section class="bg-gradient-to-b from-slate-50 to-white border border-gray-200 rounded-2xl p-4 sm:p-5">'
    + '<div class="flex items-center justify-between gap-3 mb-4">'
    + '<h3 class="text-base sm:text-lg font-bold text-gray-800 flex items-center gap-2"><span class="text-xl">📍</span> ' + esc(grupo.ubicacion_nombre) + '</h3>'
    + '<span class="text-xs font-semibold text-gray-400 bg-white border border-gray-200 px-2.5 py-1 rounded-full">' + contenedores.length + ' elemento(s)</span>'
    + '</div>'
    + '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">' + contenedoresHtml + '</div>'
    + '</section>';
}

/** Tarjeta de objeto individual suelto (sección inferior). */
function objetoSueltoTarjetaHtml(obj: ObjetoArbol): string {
  const tieneAusencia = Boolean(obj.contenedor_ausente);
  const ubicacion = esc(obj.ubicacion_nombre || 'Sin ubicación');
  const nombre = esc(obj.nombre);
  return '<article class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-base flex flex-col">'
    + '<div class="relative h-32 bg-slate-100 flex items-center justify-center overflow-hidden">'
    + '<img src="' + fotoDe(obj) + '" alt="' + nombre + '" class="h-full w-full object-cover" loading="lazy" />'
    + '<div class="absolute top-2 left-2 flex flex-wrap gap-1">' + chipCategoria(obj) + chipPublicado(obj) + '</div>'
    + '</div>'
    + '<div class="p-3 flex-1 flex flex-col gap-1.5">'
    + '<h3 class="font-semibold text-gray-900 text-sm leading-snug line-clamp-2" title="' + nombre + '">' + nombre + '</h3>'
    + '<div class="flex flex-wrap items-center gap-1">' + chipEstado(obj) + chipDecision(obj) + '</div>'
    + '<p class="text-xs text-gray-400 flex items-center gap-1">📍 ' + ubicacion + (tieneAusencia ? ' · ⚠️ contenedor ausente' : '') + '</p>'
    + '<div class="mt-auto flex items-center justify-between gap-1 pt-2 border-t border-gray-100">'
    + '<a href="/objetos/' + esc(obj.id) + '" class="text-xs font-semibold text-blue-700 hover:underline">Ver</a>'
    + '<div class="flex items-center gap-2">'
    + '<a href="/objetos/' + esc(obj.id) + '/editar" class="text-xs text-gray-500 hover:text-blue-700 hover:underline">Editar</a>'
    + '<button type="button" class="js-eliminar-objeto text-xs text-gray-400 hover:text-red-600 cursor-pointer" data-id="' + esc(obj.id) + '" data-nombre="' + nombre + '">Eliminar</button>'
    + '</div></div>'
    + '</div></article>';
}

/**
 * SECCIÓN 1 · 📦 Cajas e Inventario Interno.
 * Filtro de descarte ABSOLUTO en el cliente: SOLO cajas móviles
 * (`tipo_contenedor='CAJA'` y `es_inmueble=false`). El Armario Empotrado y el
 * Setup PC (inmuebles fijos) quedan removidos de este bloque superior.
 */
export function seccionCajasHtml(cajas: NodoCaja[]): string {
  const moviles = (cajas || []).filter((caja) => esCajaMovilEnBloqueCajas(caja));
  if (moviles.length === 0) return '';
  return '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">'
    + moviles.map((caja) => contenedorTarjetaHtml(caja, {
        tipoLabel: '📦 Caja / Contenedor pequeño',
        minimapa: rutaMinimapasHtml(caja),
        alinear: 'start',
        sumario: true,
        acciones: true,
      })).join('')
    + '</div>';
}

/**
 * SECCIÓN 3 · 🗄 Muebles y Estructuras Móviles. `esMuebleMovil` es la red de
 * seguridad que excluye cualquier estantería o mueble inmueble fijo. Cada
 * tarjeta expone Editar/Eliminar (sin «Mover»: la reubicación de un mueble se
 * gestiona en el Visor de Habitación / Mapa Estok).
 */
export function seccionMueblesHtml(estructuras: GrupoEstructura[]): string {
  return (estructuras || []).map((grupo) => grupoEstructurasHtml(
    grupo,
    esMuebleMovil,
    (nodo) => contenedorTarjetaHtml(nodo, {
      tipoLabel: '🗄️ Mueble con sub-contenedores',
      acciones: true,
      mostrarMover: false,
    }),
  )).join('');
}

/** SECCIÓN 2 · 🧸 Objetos Sueltos o sin Caja (cuadrícula independiente). */
export function seccionSueltosHtml(sueltos: ObjetoArbol[]): string {
  return (sueltos || []).map((obj) => objetoSueltoTarjetaHtml(obj)).join('');
}

/** Encabezado-resumen del inventario (contadores globales del Estok activo). */
export function resumenInventarioHtml(
  resumen: { contenedores: number; objetos_ubicados: number; objetos_sueltos: number },
  filtrosActivos: boolean,
): string {
  const titulo = filtrosActivos ? '🔍 Resultados filtrados' : '🧺 Vista de inventario en cascada';
  return '<div class="flex flex-wrap items-center gap-x-5 gap-y-1 bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm">'
    + '<span class="font-semibold text-gray-700">' + titulo + '</span>'
    + '<span class="text-gray-500">🗄️ <b>' + numerico(resumen.contenedores) + '</b> estructura(s)</span>'
    + '<span class="text-gray-500">📦 <b>' + numerico(resumen.objetos_ubicados) + '</b> objeto(s) guardados</span>'
    + '<span class="text-gray-500">🧺 <b>' + numerico(resumen.objetos_sueltos) + '</b> suelto(s)</span>'
    + '</div>';
}


