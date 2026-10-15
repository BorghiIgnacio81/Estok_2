// =============================================================================
// VISTA DE LA COLUMNA DESTINO (render puro del plano + su estado transitorio)
// -----------------------------------------------------------------------------
// Fuente ÚNICA del pintado de la columna derecha del tablero de Mudanzas:
//   · `pintarMapaDestino`   → reparte el mapa del nivel vigente en sus hosts: el
//     SVG del plano, el detalle/cabecera y el CABEZAL DE CONTEXTO EN CASCADA
//     (minimapas compactados de los niveles previos).
//   · `pintarEstadoDestino` → estado transitorio (carga o mudanza en curso):
//     apaga el plano y deja el aviso en el detalle.
// Funciones PURAS de vista: reciben el estado y los nodos, no leen el tablero.
// Se extrajeron de mudanzaBoard.ts (Lote 27) para sostener el límite de 400
// líneas por archivo.
// =============================================================================

import { htmlVacio } from './mudanzaInventario';
import { htmlMapaDestino, pintarCascadaDestino } from './mudanzaMapaDestino';
import type { VistaMapaDestino } from './mudanzaMapaDestino';
import type { FiltroDestino } from './mudanzaFiltros';
import type { ContenedorDto, UbicacionDto } from './mudanzaApi';

/** Nodos del DOM que la columna Destino gobierna (inyección explícita). */
export interface NodosDestino {
  /** Host del PLANO UNIFICADO (componente global `<MinimapaRuta plano />`). */
  plano: HTMLElement;
  /** Cabecera, avisos y chips del plano (hermano del host). */
  detalle: HTMLElement;
  /** Host del cabezal de contexto en cascada (minimapas compactados). */
  ruta: HTMLElement;
  /** Botón «⬅ Volver» del cabezal. */
  volver: HTMLButtonElement;
}

/** Estado vigente de la columna Destino (lo compone el tablero). */
export interface EstadoMapaDestino {
  ubicaciones: UbicacionDto[];
  contenedores: ContenedorDto[];
  filtros: Set<FiltroDestino>;
  /** Error de red del plano (`null` = sin error). */
  error: string | null;
  /** Nombre del Estok destino (contexto raíz de la jerarquía). */
  nombre: string;
}

/** Reparte el mapa del nivel vigente en sus hosts + cabezal en cascada. */
export function pintarMapaDestino(estado: EstadoMapaDestino, nodos: NodosDestino): void {
  const vista: VistaMapaDestino = estado.error
    ? {
        plano: '',
        detalle: htmlVacio('No se pudo cargar el plano del Estok destino', estado.error),
        cascada: '',
        hayVolver: false,
        casita: false,
      }
    : htmlMapaDestino(estado.ubicaciones, estado.contenedores, estado.filtros, estado.nombre);
  nodos.plano.innerHTML = vista.plano;
  nodos.plano.classList.toggle('hidden', !vista.plano);
  // La silueta de la casa (niveles 0 y 1) pide una caja cuadrada centrada.
  nodos.plano.classList.toggle('mudanza-plano-casita', vista.casita);
  nodos.detalle.innerHTML = vista.detalle;
  pintarCascadaDestino(nodos.ruta, vista.cascada, vista.hayVolver, nodos.volver);
}

/** Estado transitorio del Destino (carga o mudanza en curso): apaga el mapa. */
export function pintarEstadoDestino(detalle: string, nodos: NodosDestino): void {
  nodos.plano.innerHTML = '';
  nodos.plano.classList.add('hidden');
  nodos.plano.classList.remove('mudanza-plano-casita');
  nodos.detalle.innerHTML = detalle;
  pintarCascadaDestino(nodos.ruta, '', false, nodos.volver);
}
