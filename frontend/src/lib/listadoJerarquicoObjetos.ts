// =============================================================================
// LISTADO JERÁRQUICO DE OBJETOS (árbol de almacenamiento en cascada)
// -----------------------------------------------------------------------------
// Consume GET /api/contenedores/arbol/ (payload optimizado sin N+1) y renderiza
// la pantalla en TRES secciones jerárquicas descendentes:
//   1. SECCIÓN 1 · 📦 Cajas e Inventario Interno
//      TODAS las Cajas (Contenedores Pequeños) del Estok activo, listadas de
//      forma DIRECTA e INDEPENDIENTE del mueble padre (incluye las cajas
//      anidadas dentro de roperos/archivadores). Cada tarjeta muestra en su
//      esquina la RED DE MINIMAPAS EN CADENA (Piso → Habitación → Mueble) con la
//      parte activa en NARANJA (#f97316). El contenido nace CERRADO (<details>
//      sin atributo open). La lógica vive en src/lib/rutaCajaMinimapas.ts.
//   2. SECCIÓN 2 · 🧸 Objetos Sueltos o sin Caja
//      Cuadrícula independiente de los objetos individuales sin contenedor.
//   3. SECCIÓN 3 · 🗄 Muebles y Estructuras Móviles
//      Contenedores GRANDES (con sub-contenedores) creados por el usuario.
//      FILTRO CRÍTICO: se excluyen de forma absoluta los muebles con
//      `es_inmueble = true` (solo se renderizan los mudables).
// Las tres secciones comparten la misma textura/paleta corporativa continua y
// responden de forma reactiva a los filtros (Decisión, Categoría, Publicación ML
// y búsqueda) re-fetchando el payload con los query params del listado.
// Auth centralizada: getAuthHeaders() desde src/services/auth (no se duplica).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import {
  cargarContextoRutaCaja,
  cargarObjetosRutaCaja,
  cajasDelEstok,
  rutaMinimapasHtml,
} from './rutaCajaMinimapas';
import type { NodoCaja } from './rutaCajaMinimapas';

// ---------------------------------------------------------------------------
// Tipos del payload (contrato con inventario/services/arbol_inventario_service)
// ---------------------------------------------------------------------------

export interface ObjetoArbol {
  [key: string]: any;
}

export interface NodoContenedor {
  [key: string]: any;
  id: string;
  nombre: string;
  contenido: Array<NodoContenedor | ObjetoArbol>;
}

export interface GrupoEstructura {
  ubicacion_id: string | null;
  ubicacion_nombre: string;
  contenedores: NodoContenedor[];
}

export interface PayloadArbol {
  estructuras: GrupoEstructura[];
  sueltos: ObjetoArbol[];
  filtros_activos: boolean;
  resumen?: { contenedores: number; objetos_ubicados: number; objetos_sueltos: number };
}

interface Filtros {
  decision: string;
  categoria: string;
  publicado_ml: string;
}

// ---------------------------------------------------------------------------
// Constantes visuales
// ---------------------------------------------------------------------------

const IMG_ARMARIO = '/archivador-login.png';
const IMG_CAJA = '/Nuevo Contenedor.png';
const IMG_OBJETO = '/fluffy_plush_ball.jpg';
const MAX_OBJETOS_POR_NIVEL = 60;

const ETIQUETA_DECISION: Record<string, { texto: string; clase: string }> = {
  vender: { texto: 'Vender', clase: 'bg-green-100 text-green-800' },
  conservar: { texto: 'Conservar', clase: 'bg-blue-100 text-blue-800' },
  tirar: { texto: 'Tirar', clase: 'bg-red-100 text-red-800' },
};

const ETIQUETA_ESTADO: Record<string, { texto: string; clase: string }> = {
  excelente: { texto: 'Excelente', clase: 'bg-emerald-100 text-emerald-800' },
  bueno: { texto: 'Bueno', clase: 'bg-blue-100 text-blue-800' },
  regular: { texto: 'Regular', clase: 'bg-amber-100 text-amber-800' },
  malo: { texto: 'Malo', clase: 'bg-orange-100 text-orange-800' },
  muy_malo: { texto: 'Muy malo', clase: 'bg-red-100 text-red-800' },
};

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

function esc(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function numerico(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function esInmueble(nodo: NodoContenedor): boolean {
  return Boolean(nodo.es_inmueble);
}

function tieneSubContenedores(nodo: NodoContenedor): boolean {
  // La API aplica la TAXONOMÍA ESTRICTA de la pestaña de Objetos y YA NO anida
  // sub-contenedores (estanterías) en `contenido`. El conteo real de
  // sub-divisiones internas del mueble viaja como metadato en
  // `subcontenedores_count`, para conservar el icono/etiqueta correctos.
  if ((nodo.contenido || []).some((x) => x && x.tipo === 'contenedor')) return true;
  return numerico(nodo.subcontenedores_count) > 0;
}

function imagenContenedor(nodo: NodoContenedor): string {
  return esInmueble(nodo) || tieneSubContenedores(nodo) ? IMG_ARMARIO : IMG_CAJA;
}

/**
 * Mueble mudable = Contenedor GRANDE (con sub-contenedores) que el usuario
 * puede mover. FILTRO CRÍTICO de la SECCIÓN 3: los muebles inmuebles fijos
 * (`es_inmueble = true`) quedan EXCLUIDOS de forma estricta y absoluta.
 */
function esMuebleMudable(nodo: NodoContenedor): boolean {
  return !esInmueble(nodo) && tieneSubContenedores(nodo);
}

function chipDecision(obj: ObjetoArbol): string {
  const cfg = ETIQUETA_DECISION[String(obj.owner_action || '')];
  if (!cfg) return '';
  return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ' + cfg.clase + '">' + cfg.texto + '</span>';
}

function chipEstado(obj: ObjetoArbol): string {
  const cfg = ETIQUETA_ESTADO[String(obj.estado_conservacion || '')];
  if (!cfg) return '';
  return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ' + cfg.clase + '">' + cfg.texto + '</span>';
}

function chipCategoria(obj: ObjetoArbol): string {
  const nombre = String(obj.categoria_nombre || '');
  if (!nombre) return '';
  return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-semibold">' + esc(nombre) + '</span>';
}

function chipPublicado(obj: ObjetoArbol): string {
  const pubs: unknown[] = Array.isArray(obj.plataformas_publicadas) ? obj.plataformas_publicadas : [];
  if (!pubs.some((p) => String(p) === 'mercadolibre')) return '';
  return '<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-[10px] font-bold">MercadoLibre</span>';
}

function fotoDe(obj: ObjetoArbol): string {
  return obj.foto_principal ? esc(obj.foto_principal) : IMG_OBJETO;
}

/** Chevron SVG que rota 90° cuando su <details class="group"> ancestro está abierto. */
function chevronSvg(tamano: string): string {
  return '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="' + tamano
    + ' text-slate-400 transition-transform duration-200 group-open:rotate-90">'
    + '<path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 010-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />'
    + '</svg>';
}

// ---------------------------------------------------------------------------
// Constructores de HTML (viñetas en cascada y tarjetas)
// ---------------------------------------------------------------------------

function bulletContenedorHtml(nodo: NodoContenedor, profundidad: number): string {
  const contenido = nodo.contenido || [];
  const fijo = esInmueble(nodo) ? '<span class="shrink-0 text-[10px] font-bold text-gray-400">📌 FIJO</span>' : '';
  const nombreLink = '<a href="/contenedores/' + esc(nodo.id) + '" class="font-semibold text-gray-800 hover:text-blue-700 hover:underline truncate">' + esc(nodo.nombre) + '</a>';

  // Sub-caja vacía: fila simple, sin acordeón (no hay nada que expandir).
  if (contenido.length === 0) {
    return '<li class="py-0.5"><div class="flex items-center gap-1.5 min-w-0">'
      + '<span class="shrink-0">📦</span>' + nombreLink + fijo + '</div></li>';
  }

  const chip = '<span class="shrink-0 text-[10px] font-semibold text-gray-400">(' + contenido.length + ')</span>';
  return '<li class="py-0.5">'
    + '<details class="group cursor-pointer">'
    + '<summary class="flex items-center gap-1.5 min-w-0 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden rounded-lg px-1 py-0.5 hover:bg-slate-50 transition-colors duration-150">'
    + '<span class="shrink-0">📦</span>'
    + nombreLink
    + chip
    + fijo
    + chevronSvg('h-3.5 w-3.5 ml-auto shrink-0')
    + '</summary>'
    + '<ul class="estok-cuerpo-detalle mt-1 ml-4 pl-2.5 border-l-2 border-amber-100 space-y-px">'
    + contenidoBulletsHtml(contenido, profundidad + 1)
    + '</ul>'
    + '</details></li>';
}

function bulletObjetoHtml(obj: ObjetoArbol): string {
  const nombre = esc(obj.nombre);
  return '<li class="py-px"><div class="flex items-center gap-2 min-w-0 py-0.5">'
    + '<span class="shrink-0 text-amber-400">•</span>'
    + '<img src="' + fotoDe(obj) + '" alt="" class="h-6 w-6 rounded-md object-cover shrink-0 bg-slate-100" loading="lazy" />'
    + '<a href="/objetos/' + esc(obj.id) + '" class="text-sm text-gray-700 hover:text-blue-700 hover:underline truncate" title="' + nombre + '">' + nombre + '</a>'
    + '<span class="shrink-0 flex items-center gap-1 ml-auto">' + chipCategoria(obj) + chipDecision(obj) + '</span>'
    + '<a href="/objetos/' + esc(obj.id) + '/editar" title="Editar ' + nombre + '" class="shrink-0 text-gray-400 hover:text-blue-600">✏️</a>'
    + '<button type="button" class="js-eliminar-objeto shrink-0 text-gray-400 hover:text-red-600 cursor-pointer" data-id="' + esc(obj.id) + '" data-nombre="' + nombre + '" title="Eliminar ' + nombre + '">🗑️</button>'
    + '</div></li>';
}

/** Renderiza una lista de contenido (sub-contenedores + objetos) en viñetas. */
function contenidoBulletsHtml(items: Array<NodoContenedor | ObjetoArbol>, profundidad: number): string {
  const contenedores = items.filter((x) => x && x.tipo === 'contenedor') as NodoContenedor[];
  const objetos = items.filter((x) => x && x.tipo === 'objeto') as ObjetoArbol[];
  const visibles = objetos.slice(0, MAX_OBJETOS_POR_NIVEL);
  const ocultos = objetos.length - visibles.length;
  let html = contenedores.map((n) => bulletContenedorHtml(n, profundidad)).join('');
  html += visibles.map((o) => bulletObjetoHtml(o)).join('');
  if (ocultos > 0) {
    html += '<li class="text-xs text-gray-400 italic">… +' + ocultos + ' objeto(s) más (ver contenedor)</li>';
  }
  return html;
}

interface TarjetaOpts {
  /** Etiqueta de tipo mostrada en el subtítulo de la tarjeta. */
  tipoLabel?: string;
  /** HTML del minimapa ULTRA-MINI anclado a la esquina superior del bloque. */
  minimapa?: string;
  /** Alineación vertical del lateral: 'start' cuando hay minimapa, si no 'center'. */
  alinear?: 'start' | 'center';
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

  const identidad = '<span class="flex items-center gap-3 min-w-0">'
    + '<img src="' + imagenContenedor(nodo) + '" alt="" class="h-12 w-12 rounded-xl object-cover shrink-0 bg-slate-50 border border-gray-100" />'
    + '<span class="min-w-0">'
    + '<h3 class="text-xl font-extrabold text-gray-900 leading-tight truncate" title="' + esc(nodo.nombre) + '">' + esc(nodo.nombre) + '</h3>'
    + '<span class="block text-[11px] text-gray-500 mt-0.5 truncate">' + subtitulo + '</span>'
    + '</span></span>';

  // Bloque lateral superior: minimapa ULTRA-MINI (opcional) + acción "Abrir".
  const accion = '<a href="/contenedores/' + esc(nodo.id) + '" class="inline-flex items-center px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-base">Abrir ↗</a>';
  const lateral = '<span class="flex shrink-0 flex-col items-end gap-2">'
    + (opts.minimapa || '')
    + '<span class="flex items-center gap-1.5">' + accion
    + (tieneContenido ? chevronSvg('h-4 w-4') : '')
    + '</span></span>';

  const alineacion = opts.alinear === 'start' ? 'items-start' : 'items-center';

  // Contenedor VACÍO: tarjeta compacta estática (no hay nada que expandir).
  if (!tieneContenido) {
    return '<article class="relative bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-base">'
      + '<div class="flex ' + alineacion + ' justify-between gap-3 p-4">'
      + '<span class="min-w-0 flex-1">' + identidad + '</span>'
      + lateral
      + '</div>'
      + '<div class="px-4 pb-4"><p class="text-sm text-gray-400 italic">— Sin contenido —</p></div>'
      + '</article>';
  }

  // Acordeón nativo HTML5: nace CERRADO (sin atributo open) para máxima densidad.
  return '<article class="relative bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-base">'
    + '<details class="group cursor-pointer">'
    + '<summary class="flex ' + alineacion + ' justify-between gap-3 p-4 list-none font-bold text-slate-800 cursor-pointer select-none [&::-webkit-details-marker]:hidden hover:bg-slate-50 transition-colors duration-150">'
    + '<span class="min-w-0 flex-1">' + identidad + '</span>'
    + lateral
    + '</summary>'
    + '<div class="estok-cuerpo-detalle px-4 pb-4 pt-1">'
    + '<p class="text-[11px] uppercase tracking-wider text-gray-400 font-bold mb-2">Contenido</p>'
    + '<ul class="space-y-px">' + contenidoBulletsHtml(contenido, 0) + '</ul>'
    + '</div>'
    + '</details></article>';
}

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

// ---------------------------------------------------------------------------
// Estado y referencias DOM
// ---------------------------------------------------------------------------

let loadingEl: HTMLElement | null = null;
let errorEl: HTMLElement | null = null;
let errorMsgEl: HTMLElement | null = null;
let retryBtn: HTMLElement | null = null;
let emptyEl: HTMLElement | null = null;
let sinResultadosEl: HTMLElement | null = null;
let resumenEl: HTMLElement | null = null;
let seccionesWrap: HTMLElement | null = null;
let seccionCajas: HTMLElement | null = null;
let cajasContainer: HTMLElement | null = null;
let seccionMuebles: HTMLElement | null = null;
let mueblesContainer: HTMLElement | null = null;
let seccionSueltos: HTMLElement | null = null;
let gridSueltos: HTMLElement | null = null;
let filtroDecision: HTMLSelectElement | null = null;
let filtroCategoria: HTMLSelectElement | null = null;
let filtroPublicado: HTMLSelectElement | null = null;
let searchInput: HTMLInputElement | null = null;
let exportCsvBtn: HTMLElement | null = null;

const filtros: Filtros = { decision: '', categoria: '', publicado_ml: '' };

function mostrar(el: HTMLElement | null, visible: boolean): void {
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

// ---------------------------------------------------------------------------
// Carga del payload jerárquico (GET /api/contenedores/arbol/)
// ---------------------------------------------------------------------------

function construirUrlArbol(): string {
  const params = new URLSearchParams();
  if (filtros.decision) params.set('decision', filtros.decision);
  if (filtros.categoria) params.set('categoria', filtros.categoria);
  if (filtros.publicado_ml) params.set('publicado_ml', filtros.publicado_ml);
  const texto = (searchInput && searchInput.value ? searchInput.value : '').trim();
  if (texto.length >= 2) params.set('search', texto);
  const qs = params.toString();
  return API_BASE_URL + '/contenedores/arbol/' + (qs ? '?' + qs : '');
}

async function cargar(): Promise<void> {
  if (!loadingEl || !errorEl) return;
  mostrar(errorEl, false);
  mostrar(emptyEl, false);
  mostrar(sinResultadosEl, false);
  mostrar(loadingEl, true);
  const texto = (searchInput && searchInput.value ? searchInput.value : '').trim();
  const search = texto.length >= 2 ? texto : '';
  // Con filtros activos la SECCIÓN 1 solo muestra cajas con objetos coincidentes.
  const soloConContenido = Boolean(search || filtros.decision || filtros.categoria || filtros.publicado_ml);
  try {
    // Las cajas (SECCIÓN 1) se resuelven con sus PROPIOS objetos, de forma
    // independiente del mueble que las contiene: se cargan en paralelo al árbol.
    const objetosPromise = cargarObjetosRutaCaja({
      decision: filtros.decision,
      categoria: filtros.categoria,
      publicado_ml: filtros.publicado_ml,
      search,
    }).catch(() => undefined);

    const res = await fetch(construirUrlArbol(), { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      throw new Error('Error al consultar el árbol de inventario (' + res.status + ').');
    }
    const payload = (await res.json()) as PayloadArbol;
    await objetosPromise;
    render(payload, soloConContenido);
  } catch (err: any) {
    if (errorMsgEl) {
      errorMsgEl.textContent = err && err.message
        ? err.message
        : 'Error de conexión al cargar el inventario.';
    }
    mostrar(errorEl, true);
  } finally {
    mostrar(loadingEl, false);
  }
}

// ---------------------------------------------------------------------------
// Render del árbol jerárquico
// ---------------------------------------------------------------------------

function render(payload: PayloadArbol, soloConContenido: boolean): void {
  const estructuras = payload.estructuras || [];
  const sueltos = payload.sueltos || [];
  const resumen = payload.resumen || { contenedores: 0, objetos_ubicados: 0, objetos_sueltos: 0 };
  // SECCIÓN 1 · Cajas (Contenedores Pequeños) resueltas de forma DIRECTA e
  // INDEPENDIENTE del mueble padre (incluye las cajas anidadas en roperos).
  const cajas = cajasDelEstok({ soloConContenido });
  const hayDatos = cajas.length > 0 || estructuras.length > 0 || sueltos.length > 0;

  if (resumenEl) {
    const titulo = payload.filtros_activos ? '🔍 Resultados filtrados' : '🧺 Vista de inventario en cascada';
    resumenEl.innerHTML = '<div class="flex flex-wrap items-center gap-x-5 gap-y-1 bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm">'
      + '<span class="font-semibold text-gray-700">' + titulo + '</span>'
      + '<span class="text-gray-500">🗄️ <b>' + numerico(resumen.contenedores) + '</b> estructura(s)</span>'
      + '<span class="text-gray-500">📦 <b>' + numerico(resumen.objetos_ubicados) + '</b> objeto(s) guardados</span>'
      + '<span class="text-gray-500">🧺 <b>' + numerico(resumen.objetos_sueltos) + '</b> suelto(s)</span>'
      + '</div>';
    mostrar(resumenEl, true);
  }

  if (!hayDatos) {
    mostrar(seccionCajas, false);
    mostrar(seccionSueltos, false);
    mostrar(seccionMuebles, false);
    mostrar(seccionesWrap, false);
    mostrar(resumenEl, false);
    if (payload.filtros_activos) {
      mostrar(sinResultadosEl, true);
    } else {
      mostrar(emptyEl, true);
    }
    return;
  }

  mostrar(sinResultadosEl, false);
  mostrar(emptyEl, false);

  // SECCIÓN 1 · 📦 Cajas e Inventario Interno. Se listan TODAS las cajas del
  // Estok activo directamente (sin agrupar por mueble padre). Cada tarjeta lleva
  // la RED DE MINIMAPAS EN CADENA (Piso → Habitación → Mueble) en su esquina y su
  // contenido nace cerrado por defecto (<details> sin atributo open).
  const cajasHtml = cajas.length
    ? '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">'
      + cajas.map((caja: NodoCaja) => contenedorTarjetaHtml(caja, {
          tipoLabel: '📦 Caja / Contenedor pequeño',
          minimapa: rutaMinimapasHtml(caja),
          alinear: 'start',
        })).join('')
      + '</div>'
    : '';

  // SECCIÓN 3 · 🗄 Muebles y Estructuras Móviles. FILTRO CRÍTICO: los muebles
  // con `es_inmueble = true` quedan excluidos por completo (solo mudables).
  const mueblesHtml = estructuras
    .map((g) => grupoEstructurasHtml(
      g,
      esMuebleMudable,
      (n) => contenedorTarjetaHtml(n, { tipoLabel: '🗄️ Mueble con sub-contenedores' }),
    ))
    .join('');

  if (cajasContainer) cajasContainer.innerHTML = cajasHtml;
  if (mueblesContainer) mueblesContainer.innerHTML = mueblesHtml;
  if (gridSueltos) {
    gridSueltos.innerHTML = sueltos.map((o) => objetoSueltoTarjetaHtml(o)).join('');
  }

  const haySecciones = cajasHtml.length > 0 || sueltos.length > 0 || mueblesHtml.length > 0;

  mostrar(seccionCajas, cajasHtml.length > 0);
  mostrar(seccionSueltos, sueltos.length > 0);
  mostrar(seccionMuebles, mueblesHtml.length > 0);
  // El lienzo de textura corporativa solo se muestra si hay alguna sección.
  mostrar(seccionesWrap, haySecciones);

  // Caso borde: si TODOS los contenedores del Estok son muebles inmuebles fijos
  // (excluidos de forma absoluta por el FILTRO CRÍTICO) y no hay objetos sueltos,
  // no queda nada que listar → se degrada al estado vacío en vez de una pantalla muda.
  if (!haySecciones) {
    mostrar(resumenEl, false);
    if (payload.filtros_activos) {
      mostrar(sinResultadosEl, true);
    } else {
      mostrar(emptyEl, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Filtros dinámicos y búsqueda
// ---------------------------------------------------------------------------

function aplicarFiltros(): void {
  filtros.decision = filtroDecision ? filtroDecision.value : '';
  filtros.categoria = filtroCategoria ? filtroCategoria.value : '';
  filtros.publicado_ml = filtroPublicado ? filtroPublicado.value : '';
  void cargar();
}

async function cargarCategoriasFiltros(): Promise<void> {
  if (!filtroCategoria) return;
  try {
    const res = await fetch(API_BASE_URL + '/categorias/', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const categorias: Array<{ id: string; nombre: string; icono?: string }> = data.results || data || [];
    let html = '<option value="">Todas</option>';
    for (const c of categorias) {
      html += '<option value="' + esc(c.id) + '">' + esc(c.icono || '🏷️') + ' ' + esc(c.nombre) + '</option>';
    }
    filtroCategoria.innerHTML = html;
  } catch {
    // El árbol se carga igual sin el desplegable de categorías.
  }
}

// ---------------------------------------------------------------------------
// Eliminación de objetos sueltos (soft delete vía API)
// ---------------------------------------------------------------------------

async function eliminarObjeto(id: string): Promise<void> {
  try {
    const res = await fetch(API_BASE_URL + '/objetos/' + encodeURIComponent(id) + '/', {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      const win = window as any;
      if (win.showError) win.showError('Error al eliminar el objeto.');
      return;
    }
    const win = window as any;
    if (win.showSuccess) win.showSuccess('✅ Objeto eliminado correctamente');
    void cargar();
  } catch {
    const win = window as any;
    if (win.showError) win.showError('Error de conexión al eliminar el objeto.');
  }
}

// ---------------------------------------------------------------------------
// Exportar CSV (acción del encabezado)
// ---------------------------------------------------------------------------

function enlazarExportarCsv(): void {
  if (!exportCsvBtn) return;
  exportCsvBtn.addEventListener('click', async () => {
    const win = window as any;
    try {
      const res = await fetch(API_BASE_URL + '/objetos/exportar_csv/', { headers: getAuthHeaders() });
      if (!res.ok) {
        if (win.showError) win.showError('Error al exportar CSV');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inventario_estok_' + new Date().toISOString().split('T')[0] + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      if (win.showSuccess) win.showSuccess('✅ CSV exportado correctamente');
    } catch {
      if (win.showError) win.showError('Error de conexión al exportar CSV');
    }
  });
}

// ---------------------------------------------------------------------------
// Enlace de eventos con delegación (auth centralizada en src/services/auth)
// ---------------------------------------------------------------------------

function enlazarEventos(): void {
  if (filtroDecision) filtroDecision.addEventListener('change', aplicarFiltros);
  if (filtroCategoria) filtroCategoria.addEventListener('change', aplicarFiltros);
  if (filtroPublicado) filtroPublicado.addEventListener('change', aplicarFiltros);

  let timeout: number | null = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (timeout) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => void cargar(), 300);
    });
  }

  if (retryBtn) retryBtn.addEventListener('click', () => void cargar());
  enlazarExportarCsv();

  // Delegación global para botones "Eliminar" dentro de viñetas y tarjetas.
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const btn = target && target.closest ? target.closest('.js-eliminar-objeto') as HTMLElement | null : null;
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const nombre = btn.getAttribute('data-nombre') || 'este objeto';
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    const ok = window.confirm('¿Eliminar "' + nombre + '"?\nSe marcará como eliminado (soft delete).');
    if (!ok) return;
    void eliminarObjeto(id);
  });
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

export function initListadoJerarquicoObjetos(): void {
  loadingEl = document.getElementById('loadingState');
  errorEl = document.getElementById('errorState');
  errorMsgEl = document.getElementById('errorMessage');
  retryBtn = document.getElementById('retryBtn');
  emptyEl = document.getElementById('emptyState');
  sinResultadosEl = document.getElementById('sinResultados');
  resumenEl = document.getElementById('resumenInventario');
  seccionesWrap = document.getElementById('seccionesInventario');
  seccionCajas = document.getElementById('seccionCajas');
  cajasContainer = document.getElementById('cajasContainer');
  seccionMuebles = document.getElementById('seccionMuebles');
  mueblesContainer = document.getElementById('mueblesContainer');
  seccionSueltos = document.getElementById('seccionSueltos');
  gridSueltos = document.getElementById('objetosGrid');
  filtroDecision = document.getElementById('filtroDecision') as HTMLSelectElement | null;
  filtroCategoria = document.getElementById('filtroCategoria') as HTMLSelectElement | null;
  filtroPublicado = document.getElementById('filtroPublicado') as HTMLSelectElement | null;
  searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
  exportCsvBtn = document.getElementById('exportCsvBtn');

  mostrar(sinResultadosEl, false);
  mostrar(seccionesWrap, false);
  mostrar(seccionCajas, false);
  mostrar(seccionSueltos, false);
  mostrar(seccionMuebles, false);
  enlazarEventos();

  // La red de minimapas en cadena de cada caja necesita el plano de ubicaciones,
  // TODOS los contenedores del Estok (incluidas las cajas anidadas) y la grilla
  // del macro-Estok: se cargan una sola vez y la primera carga del árbol espera
  // ese contexto para poder pintar la ruta (Piso → Habitación → Mueble).
  const contextoRuta = cargarContextoRutaCaja();

  // Navegación cruzada desde el Dashboard: /objetos?categoria_id=XX (en caliente).
  const params = new URLSearchParams(window.location.search);
  const catId = params.get('categoria_id');

  if (catId) {
    Promise.all([contextoRuta, cargarCategoriasFiltros()]).then(() => {
      const existe = filtroCategoria ? Array.from(filtroCategoria.options).some((opt) => opt.value === catId) : false;
      if (existe && filtroCategoria) {
        filtroCategoria.value = catId;
        filtroCategoria.dispatchEvent(new Event('change'));
      } else {
        void cargar();
      }
    });
  } else {
    Promise.all([contextoRuta, cargarCategoriasFiltros()]).then(() => void cargar());
  }
}






