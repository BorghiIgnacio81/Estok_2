// =============================================================================
// PIEZAS HTML REUTILIZABLES DEL LISTADO DE OBJETOS
// -----------------------------------------------------------------------------
// Tipos del payload + micro-componentes de la cascada (escapado, chips, chevron
// y viñetas recursivas de sub-contenedores/objetos). Extraído del render para
// mantener cada archivo por debajo de las 400 líneas (disciplina de modularidad).
// =============================================================================

import type { NodoCaja } from './rutaCajaMinimapas';

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
  cajas: NodoCaja[];
  sueltos: ObjetoArbol[];
  filtros_activos: boolean;
  resumen?: { contenedores: number; objetos_ubicados: number; objetos_sueltos: number };
}

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

export function esc(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function numerico(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function esInmueble(nodo: NodoContenedor): boolean {
  return Boolean(nodo.es_inmueble);
}

/** Chevron SVG que rota 90° cuando su <details class="group"> ancestro está abierto. */
export function chevronSvg(tamano: string): string {
  return '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="' + tamano
    + ' text-slate-400 transition-transform duration-200 group-open:rotate-90">'
    + '<path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 010-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />'
    + '</svg>';
}

export function chipDecision(obj: ObjetoArbol): string {
  const cfg = ETIQUETA_DECISION[String(obj.owner_action || '')];
  if (!cfg) return '';
  return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ' + cfg.clase + '">' + cfg.texto + '</span>';
}

export function chipEstado(obj: ObjetoArbol): string {
  const cfg = ETIQUETA_ESTADO[String(obj.estado_conservacion || '')];
  if (!cfg) return '';
  return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ' + cfg.clase + '">' + cfg.texto + '</span>';
}

export function chipCategoria(obj: ObjetoArbol): string {
  const nombre = String(obj.categoria_nombre || '');
  if (!nombre) return '';
  return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-semibold">' + esc(nombre) + '</span>';
}

export function chipPublicado(obj: ObjetoArbol): string {
  const pubs: unknown[] = Array.isArray(obj.plataformas_publicadas) ? obj.plataformas_publicadas : [];
  if (!pubs.some((p) => String(p) === 'mercadolibre')) return '';
  return '<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-[10px] font-bold">MercadoLibre</span>';
}

export function fotoDe(obj: ObjetoArbol): string {
  return obj.foto_principal ? esc(obj.foto_principal) : IMG_OBJETO;
}

// ---------------------------------------------------------------------------
// Viñetas recursivas (cascada de sub-contenedores + objetos)
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
export function contenidoBulletsHtml(items: Array<NodoContenedor | ObjetoArbol>, profundidad: number): string {
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

