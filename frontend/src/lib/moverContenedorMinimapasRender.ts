// =============================================================================
// RENDER DEL ASISTENTE DE MOVIMIENTO POR MINIMAPAS (capa 100% pura)
// -----------------------------------------------------------------------------
// Dibujo del modal «Mover»: miga de pan contextual del encabezado (los mapas
// previos se «encogen» ahí, con el botón «⬅ Volver»), plano elástico del nivel
// visible y pie de acciones con la ficha arrastrable del contenedor.
//
// NO dibuja por su cuenta: el plano lo emite el MOTOR GLOBAL de minimapas
// (lib/minimapa.ts → minimapaSectoresSvg con `responsive` + `clicable`), el
// mismo del componente components/MinimapaRuta.astro, y su contenedor lo
// declara la ÚNICA fábrica canónica del host (lib/minimapaRutaHost.ts). Así el
// look canónico es idéntico en toda la app: fondo crema, BORDE NEGRO nítido de
// puntas redondeadas, ambientes fusionados como un único contorno y el sector
// activo en NARANJA ESTRICTO (#f97316). Cero divs de plano propios.
//
// Sin estado, sin fetch y sin DOM: recibe la vista ya resuelta por el
// controlador (lib/moverContenedorMinimapas.ts) y devuelve HTML.
// =============================================================================

import { escapeHtml } from './mapaJerarquico';
import { ASPECTO_LIENZO, minimapaSectoresSvg } from './minimapa';
import type { SectorMinimapa } from './minimapa';
import { hostCadenaMinimapaHtml, hostPlanoMinimapaHtml } from './minimapaRutaHost';
import { renderMinimapasAnidados } from './minimapasAnidados';
import type { NodoRuta } from './minimapasAnidados';
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
  /** Nombres de los niveles ya recorridos (miga de pan textual). */
  recorrido: string[];
  /**
   * MIGA VISUAL: los planos previos «encogidos» en la cadena canónica de
   * minimapas anidados (lib/moverContenedorMinimapasRuta.ts). Viaja vacía en el
   * nivel de ambientes (el plano grande ya es ese mapa).
   */
  nodos: NodoRuta[];
  /** Sectores REALES del nivel visible (geometría ui_* de PostgreSQL). */
  sectores: SectorMinimapa[];
  /** Aviso/ayuda del nivel (reemplaza al plano si no hay sectores). */
  aviso: string;
  /** Nombre del destino seleccionado (habilita «💾 Confirmar ubicación aquí»). */
  destinoNombre: string | null;
}

const TITULO_NIVEL: Record<NivelMover, string> = {
  0: '1 · Tocá el ambiente',
  1: '2 · Tocá el mueble (se abre) o la caja',
  2: '3 · Tocá el estante / casillero o confirmá la ubicación',
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
    + '</div>'
    + migaVisualHtml(vista.nodos);
}

/**
 * MIGA VISUAL de contexto: los mapas ya recorridos «encogidos» en el encabezado
 * (planta → ambiente → mueble), con el nodo vigente en naranja. Es la MISMA
 * cadena canónica de minimapas anidados que usan Almacenamiento y las tarjetas
 * de Objetos, montada en el host de la cadena del componente global
 * (lib/minimapaRutaHost.ts). Con un solo nodo no hay contexto que mostrar.
 */
function migaVisualHtml(nodos: NodoRuta[]): string {
  if (nodos.length < 2) return '';
  return hostCadenaMinimapaHtml(
    renderMinimapasAnidados(nodos, { todosActivos: true }),
    'mb-2',
  );
}

/**
 * Plano elástico del nivel: COMPONENTE GLOBAL y nada más.
 *
 * El SVG lo emite el motor (`minimapaSectoresSvg` con `responsive` + `clicable`,
 * el mismo de components/MinimapaRuta.astro) y el contenedor lo declara la
 * ÚNICA fábrica canónica del host (`lib/minimapaRutaHost.ts`): mismas clases,
 * mismo `aspect-ratio` real y mismo `data-minimapa-ruta` que el componente.
 *
 * El gancho `data-mover-plano` viaja en el propio host: el controlador lo
 * reconoce como zona de suelta. Se eliminó el cajón amarillo propio que
 * recuadraba el mapa viejo (`rounded-xl border border-amber-200 bg-amber-50/40`):
 * el plano ya no queda dentro de una caja genérica de relleno.
 */
function lienzoHtml(sectores: SectorMinimapa[]): string {
  const svg = minimapaSectoresSvg({
    sectores,
    aspecto: ASPECTO_LIENZO,
    responsive: true,
    clicable: true,
    // Etiquetas de lectura del componente global: icono + nombre de cada
    // ambiente sobre su silueta (capa `pointer-events:none`: no interfiere con
    // la zona de suelta `data-mover-plano`).
    etiquetas: true,
  });
  return hostPlanoMinimapaHtml(svg, ASPECTO_LIENZO, 'data-mover-plano');
}

/** Ficha arrastrable del contenedor + enunciado del nivel vigente. */
function fichaHtml(vista: VistaMover): string {
  return '<div class="flex items-center gap-2 mb-2">'
    + '<span class="js-mover-arrastrar inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 text-white text-[11px] font-semibold cursor-grab select-none" draggable="true" title="Arrastrá esta ficha sobre el destino">📦 '
    + escapeHtml(vista.nombreContenedor) + '</span>'
    + '<span class="text-[11px] text-gray-400">' + TITULO_NIVEL[vista.nivel] + '</span>'
    + '</div>';
}

/** Pie de acciones: cancelar + CONFIRMACIÓN explícita de la ubicación elegida. */
function accionesHtml(destinoNombre: string | null): string {
  // El botón tiene SIEMPRE el mismo rótulo pedido: la decisión es del operador
  // (raíz del mueble, estante interno, casillero o ambiente), no del clic.
  const objetivo = destinoNombre
    ? '<span class="text-[11px] text-gray-400">Destino elegido: <span class="font-semibold text-gray-700">«'
      + escapeHtml(destinoNombre) + '»</span></span>'
    : '<span class="text-[11px] text-gray-400">Tocá un ambiente o mueble para recorrerlo y tocá el estante/caja final para elegirlo; o arrastrá la ficha sobre el destino.</span>';
  return '<div class="flex flex-wrap items-center justify-between gap-2 pt-3 mt-2 border-t border-gray-100">'
    + objetivo
    + '<span class="flex items-center gap-2">'
    + '<button type="button" class="js-cerrar-overlay px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 cursor-pointer">Cancelar</button>'
    + '<button type="button" class="js-mover-confirmar px-4 py-2.5 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/30 disabled:opacity-50 disabled:shadow-none cursor-pointer"'
    + (destinoNombre ? '' : ' disabled') + '>💾 Confirmar ubicación aquí</button>'
    + '</span></div>';
}

/** HTML completo del asistente (miga de pan + ficha + plano + acciones). */
export function renderAsistenteHtml(vista: VistaMover): string {
  // El cuerpo es EL COMPONENTE GLOBAL: el host canónico del plano (con la zona
  // de suelta) o, si el nivel no aporta geometría real, su aviso explicativo.
  // Nunca se envuelve en un cajón propio ni se inventa un plano de relleno.
  // Con plano Y aviso (ej: interior de un mueble sin estantes creados) la ayuda
  // viaja como nota al pie del lienzo, sin reemplazarlo.
  const cuerpo = vista.sectores.length
    ? lienzoHtml(vista.sectores)
      + (vista.aviso
        ? '<p class="mt-2 text-[11px] text-gray-500 text-center">' + escapeHtml(vista.aviso) + '</p>'
        : '')
    : '<p class="text-sm text-gray-500 py-8 text-center">' + escapeHtml(vista.aviso) + '</p>';
  return migasHtml(vista)
    + fichaHtml(vista)
    + cuerpo
    + accionesHtml(vista.destinoNombre);
}
