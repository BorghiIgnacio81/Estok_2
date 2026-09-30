// =============================================================================
// RENDER DEL ASISTENTE DE MOVIMIENTO POR MINIMAPAS (capa 100% pura)
// -----------------------------------------------------------------------------
// Dibujo del modal «Mover»: miga de pan contextual del encabezado (los mapas
// previos se «encogen» ahí, con el botón «⬅ Volver»), plano elástico del nivel
// visible y pie de acciones con la ficha arrastrable del contenedor.
//
// NO dibuja por su cuenta: el plano lo emite el MOTOR GLOBAL de minimapas
// (lib/minimapa.ts → minimapaSectoresSvg con `responsive` + `clicable`), el
// mismo del componente components/MinimapaRuta.astro. Así el look canónico es
// idéntico en toda la app: fondo crema, BORDE NEGRO nítido de puntas
// redondeadas, ambientes fusionados como un único contorno y el sector activo
// en NARANJA ESTRICTO (#f97316).
//
// Sin estado, sin fetch y sin DOM: recibe la vista ya resuelta por el
// controlador (lib/moverContenedorMinimapas.ts) y devuelve HTML.
// =============================================================================

import { escapeHtml } from './mapaJerarquico';
import { ASPECTO_LIENZO, minimapaSectoresSvg } from './minimapa';
import type { SectorMinimapa } from './minimapa';
import type { PlantaDisponible } from './espaciosDePlanta';

/** Nivel visible del recorrido: 0 ambientes · 1 contenedores · 2 cajas. */
export type NivelMover = 0 | 1 | 2;

/** Vista del nivel vigente, resuelta por el controlador. */
export interface VistaMover {
  nivel: NivelMover;
  /** Nombre del contenedor que se está moviendo (ficha arrastrable). */
  nombreContenedor: string;
  /** Plantas navegables reales del inmueble (selector de planta activa). */
  plantas: PlantaDisponible[];
  /** FILA (1-based) de la planta activa. */
  planta: number;
  /** Nombres de los niveles ya recorridos (miga de pan contextual). */
  recorrido: string[];
  /** Sectores REALES del nivel visible (geometría ui_* de PostgreSQL). */
  sectores: SectorMinimapa[];
  /** Aviso cuando el nivel no aporta sectores: jamás un plano inventado. */
  aviso: string;
  /** Nombre del destino seleccionado (habilita «📦 Mover a «X»»). */
  destinoNombre: string | null;
}

const TITULO_NIVEL: Record<NivelMover, string> = {
  0: '1 · Tocá el ambiente',
  1: '2 · Tocá el mueble o la caja',
  2: '3 · Tocá la caja interna',
};

/** MIGA DE PAN del encabezado: planta activa + niveles recorridos + Volver. */
function migasHtml(vista: VistaMover): string {
  const selector = vista.plantas.length > 1
    ? '<select class="js-mover-planta px-1.5 py-0.5 text-[11px] text-gray-700 bg-white border border-gray-300 rounded-md">'
      + vista.plantas
        .map((p) => '<option value="' + p.fila + '"' + (p.fila === vista.planta ? ' selected' : '') + '>🏠 ' + escapeHtml(p.etiqueta) + '</option>')
        .join('')
      + '</select>'
    : '<span class="text-[11px] font-semibold text-gray-600">🏠 '
      + escapeHtml(vista.plantas[0] ? vista.plantas[0].etiqueta : 'Planta 1') + '</span>';

  const volver = vista.nivel > 0
    ? '<button type="button" class="js-mover-volver px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer">⬅ Volver</button>'
    : '';

  return '<div class="flex flex-wrap items-center gap-2 mb-2">'
    + selector
    + vista.recorrido
      .map((nivel) => '<span class="text-[11px] text-gray-400">›</span><span class="text-[11px] font-semibold text-gray-700">' + escapeHtml(nivel) + '</span>')
      .join('')
    + '<span class="ml-auto">' + volver + '</span>'
    + '</div>';
}

/**
 * Plano elástico del nivel: SVG al 100% del host con la proporción REAL del
 * lienzo (`--minimapa-aspecto-ratio`) y el motor global de minimapas.
 */
function lienzoHtml(sectores: SectorMinimapa[]): string {
  const svg = minimapaSectoresSvg({
    sectores,
    aspecto: ASPECTO_LIENZO,
    responsive: true,
    clicable: true,
  });
  return '<div class="minimapa-ruta minimapa-ruta-plano w-full" style="--minimapa-aspecto-ratio:'
    + (1 / ASPECTO_LIENZO).toFixed(4) + ';">' + svg + '</div>';
}

/** Ficha arrastrable del contenedor + enunciado del nivel vigente. */
function fichaHtml(vista: VistaMover): string {
  return '<div class="flex items-center gap-2 mb-2">'
    + '<span class="js-mover-arrastrar inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 text-white text-[11px] font-semibold cursor-grab select-none" draggable="true" title="Arrastrá esta ficha sobre el destino">📦 '
    + escapeHtml(vista.nombreContenedor) + '</span>'
    + '<span class="text-[11px] text-gray-400">' + TITULO_NIVEL[vista.nivel] + '</span>'
    + '</div>';
}

/** Pie de acciones: cancelar + confirmación del nivel seleccionado. */
function accionesHtml(destinoNombre: string | null): string {
  const etiqueta = destinoNombre
    ? '📦 Mover a «' + escapeHtml(destinoNombre) + '»'
    : '📦 Mover aquí';
  return '<div class="flex flex-wrap items-center justify-between gap-2 pt-3 mt-2 border-t border-gray-100">'
    + '<p class="text-[11px] text-gray-400">Tocá el destino final para moverlo; o arrastrá la ficha sobre el ambiente.</p>'
    + '<span class="flex items-center gap-2">'
    + '<button type="button" class="js-cerrar-overlay px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 cursor-pointer">Cancelar</button>'
    + '<button type="button" class="js-mover-confirmar px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 cursor-pointer"'
    + (destinoNombre ? '' : ' disabled') + '>' + etiqueta + '</button>'
    + '</span></div>';
}

/** HTML completo del asistente (miga de pan + ficha + plano + acciones). */
export function renderAsistenteHtml(vista: VistaMover): string {
  const cuerpo = vista.sectores.length
    ? lienzoHtml(vista.sectores)
    : '<p class="text-sm text-gray-500 py-8 text-center">' + escapeHtml(vista.aviso) + '</p>';
  return migasHtml(vista)
    + fichaHtml(vista)
    + '<div class="js-mover-plano w-full min-w-0 rounded-xl border border-amber-200 bg-amber-50/40 p-2" data-mover-plano>'
    + cuerpo
    + '</div>'
    + accionesHtml(vista.destinoNombre);
}
