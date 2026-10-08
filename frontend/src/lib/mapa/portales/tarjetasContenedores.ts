// =============================================================================
// TARJETAS DEL INTERIOR JERÁRQUICO (Panel Derecho recursivo) · RENDER PURO
// -----------------------------------------------------------------------------
// Cada hijo directo del nodo activo se dibuja como una tarjeta que:
//   1. Es PORTAL: tocarla la traslada al Panel Izquierdo y abre su propio nivel
//      (`data-portal-abrir`) — recursión sin límite de profundidad.
//   2. Es DROP ZONE (`data-portal-drop`): soltar un chip de la canasta acá
//      guarda el bulto DENTRO de esa pieza. Si la pieza tiene divisiones
//      internas y no se eligió estante, el backend la marca «En Tránsito
//      Interno» (ver transitoInterno.ts). Si es «Espacio Único», entra directo.
//   3. Muestra el MINI-MAPA de su propio interior (geometría real de sus hijos).
//
// Módulo PURO: el clic y el drop los conecta el orquestador por delegación.
// =============================================================================

import { escapeHtml } from '../../mapaJerarquico';
import { ASPECTO_LIENZO } from '../../minimapa';
import { renderMinimapasAnidados } from '../../minimapasAnidados';
import { sectoresDeItems } from '../../sectoresMinimapa';
import type { ItemGeometria } from '../../sectoresMinimapa';
import { esCajaMovil } from '../../taxonomiaContenedor';
import { etiquetaTransitoInternoHtml } from './transitoInterno';
import type { NodoPortal } from './estadoPortales';

/** Pieza del interior activo con todo lo que la tarjeta necesita mostrar. */
export interface FichaHijo {
  nodo: NodoPortal;
  /** Geometría real de los hijos de ESTE hijo (su mini-mapa interno). */
  nietos: ItemGeometria[];
  /** Sub-contenedores directos (contador real del padrón). */
  subconteo: number;
  /** Objetos guardados directamente (contador real del padrón). */
  objetos: number;
  /** Objetos en «En Tránsito Interno» dentro de esta pieza. */
  enTransito: number;
  /** Taxonomía física normalizada para el icono. */
  tipo: string;
  esInmueble: boolean;
  espacioUnico: boolean;
}

/** Icono contextual de la pieza según su taxonomía física. */
function iconoDePieza(ficha: FichaHijo): string {
  if (esCajaMovil({ tipo: ficha.tipo, es_inmueble: ficha.esInmueble })) return '📦';
  if (ficha.tipo === 'OBJETO') return '🧸';
  if (ficha.esInmueble) return '📌';
  if (ficha.espacioUnico) return '🧱';
  if (ficha.subconteo > 0) return '🗄️';
  return '🧺';
}

/** Mini-mapa del interior de la pieza (sus hijos reales en silueta proporcional). */
function minimapaHijoHtml(ficha: FichaHijo, aspecto: number): string {
  const sectores = sectoresDeItems(ficha.nietos, null);
  if (!sectores.length) return '';
  return renderMinimapasAnidados(
    [
      {
        tipo: 'mueble',
        nombre: ficha.nodo.nombre,
        id: ficha.nodo.id,
        sectores,
        aspecto: aspecto || ASPECTO_LIENZO,
      },
    ],
    { hermanas: true },
  );
}

/** Tarjeta de un hijo directo: portal + drop zone + mini-mapa interno. */
export function tarjetaHijoHtml(ficha: FichaHijo, aspecto: number): string {
  const { nodo } = ficha;
  const clases = [
    'portal-tarjeta',
    'portal-tarjeta-hijo',
    ficha.espacioUnico ? 'portal-tarjeta-monolitica' : '',
    nodo.conDivisiones ? 'portal-tarjeta-ramificada' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const badges: string[] = [];
  if (ficha.subconteo) badges.push(`<span class="portal-badge">${ficha.subconteo} sub</span>`);
  if (ficha.objetos) badges.push(`<span class="portal-badge">${ficha.objetos} obj</span>`);
  if (ficha.espacioUnico) badges.push('<span class="portal-badge portal-badge-monolitico">🧱 Espacio Único</span>');
  const transito = ficha.enTransito
    ? `<span class="portal-badge portal-badge-transito">${etiquetaTransitoInternoHtml()} · ${ficha.enTransito}</span>`
    : '';
  const ayuda = nodo.conDivisiones
    ? 'Soltá un bulto acá para dejarlo dentro: sin estante fino queda «En Tránsito Interno».'
    : 'Soltá un bulto acá para guardarlo directamente adentro.';
  return `<article class="${clases}"
    data-portal-abrir="${escapeHtml(nodo.id)}"
    data-portal-tipo="contenedor"
    data-portal-nombre="${escapeHtml(nodo.nombre)}"
    data-portal-drop="${escapeHtml(nodo.id)}"
    data-portal-divisiones="${nodo.conDivisiones ? '1' : '0'}"
    title="«${escapeHtml(nodo.nombre)}» · ${escapeHtml(ayuda)}">
    <div class="portal-tarjeta-cab">
      <span class="portal-tarjeta-ico" aria-hidden="true">${iconoDePieza(ficha)}</span>
      <span class="portal-tarjeta-nombre">${escapeHtml(nodo.nombre)}</span>
      <span class="portal-tarjeta-flecha" aria-hidden="true">→</span>
    </div>
    ${minimapaHijoHtml(ficha, aspecto)}
    <div class="portal-tarjeta-badges">${badges.join('')}${transito}</div>
  </article>`;
}

/**
 * Listado del interior jerárquico de un nodo. Estado vacío explicativo cuando la
 * pieza no tiene hijos todavía (invita a fundar el primero en la izquierda).
 */
export function listaHijosHtml(
  fichas: FichaHijo[],
  aspecto: number,
  nombrePadre: string,
): string {
  if (!fichas.length) {
    return `<div class="portal-vacio">
      <span class="portal-vacio-ico" aria-hidden="true">🧺</span>
      <p class="portal-vacio-texto">«${escapeHtml(nombrePadre)}» todavía no tiene sub-contenedores. Fundá un estante en la grilla de la izquierda o soltá una caja desde la canasta para que aparezca acá.</p>
    </div>`;
  }
  const tarjetas = fichas.map((f) => tarjetaHijoHtml(f, aspecto)).join('');
  return `<div class="portal-lista portal-lista-hijos">${tarjetas}</div>`;
}
