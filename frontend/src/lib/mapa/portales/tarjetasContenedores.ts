// =============================================================================
// TARJETAS DEL INTERIOR JERÁRQUICO (Panel Derecho recursivo) · RENDER PURO
// -----------------------------------------------------------------------------
// MODO 100% VISUAL: cada hijo directo del nodo activo se dibuja DENTRO del mapa
// elástico del interior (./lienzoHijos.ts), sobre su silueta geométrica real y
// con su NOMBRE e ICONO rotulados encima. Se eliminó el listado plano de texto
// («📦 Espacio 1 → 📦 Espacio 2 →») que desperdiciaba la pantalla en web y
// arruinaba el responsive móvil.
//
// Este módulo queda como la ÚNICA autoridad de la FICHA del hijo: traduce cada
// `NodoPortal` + sus contadores reales del padrón a la `PiezaLienzo` que consume
// el lienzo (icono de taxonomía, etiqueta rotulada, divisiones propias y
// geometría). Cada silueta es PORTAL (`data-portal-abrir`) y DROP ZONE
// (`data-portal-drop`): soltar un chip de la canasta la guarda DENTRO de esa
// pieza («En Tránsito Interno» si tiene divisiones internas).
//
// Módulo PURO: el clic y el drop los conecta el orquestador por delegación.
// =============================================================================

import type { ItemGeometria } from '../../sectoresMinimapa';
import { esCajaMovil } from '../../taxonomiaContenedor';
import { etiquetaTransitoInternoHtml } from './transitoInterno';
import { estadoVacioInteriorHtml, lienzoInteriorHtml } from './lienzoHijos';
import type { PiezaLienzo } from './lienzoHijos';
import type { NodoPortal } from './estadoPortales';

/** Pieza del interior activo con todo lo que la tarjeta necesita mostrar. */
export interface FichaHijo {
  nodo: NodoPortal;
  /** Geometría real de los hijos de ESTE hijo (contador de sub-divisiones). */
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
export function iconoDePieza(ficha: FichaHijo): string {
  if (esCajaMovil({ tipo: ficha.tipo, es_inmueble: ficha.esInmueble })) return '📦';
  if (ficha.tipo === 'OBJETO') return '🧸';
  if (ficha.esInmueble) return '📌';
  if (ficha.espacioUnico) return '🧱';
  if (ficha.subconteo > 0) return '🗄️';
  return '🧺';
}

/**
 * Rótulo que se estampa sobre la silueta: nombre REAL de la pieza + sus
 * contadores del padrón. Así el plano elástico sigue siendo 100% visual sin
 * perder la información operativa que antes vivía en las tarjetas de texto.
 */
function etiquetaDeFicha(ficha: FichaHijo, subdivisiones: number): string {
  const extras: string[] = [];
  if (subdivisiones) extras.push(`${subdivisiones} sub`);
  if (ficha.objetos) extras.push(`${ficha.objetos} obj`);
  if (ficha.enTransito) extras.push(`🔴 ${ficha.enTransito}`);
  return extras.length ? `${ficha.nodo.nombre} · ${extras.join(' · ')}` : ficha.nodo.nombre;
}

/** Traduce una ficha del padrón a la pieza que dibuja el lienzo del interior. */
export function piezaDeFicha(ficha: FichaHijo, geometria: ItemGeometria | null): PiezaLienzo {
  return {
    id: ficha.nodo.id,
    nombre: ficha.nodo.nombre,
    etiqueta: etiquetaDeFicha(ficha, ficha.subconteo || ficha.nietos.length),
    icono: iconoDePieza(ficha),
    geometria,
    conDivisiones: ficha.nodo.conDivisiones,
  };
}

/**
 * LIENZO del interior jerárquico de un nodo (Panel Derecho, recursivo).
 *
 * `geometria` es la geometría REAL de esos hijos dentro del lienzo del padre
 * (`InteriorNodo.geometriaHijos`): con ella el plano elástico replica las
 * proporciones reales de cada sub-espacio y los rótulos caen sobre su silueta.
 * Sin hijos devuelve el estado vacío explicativo (nunca un panel mudo).
 */
export function listaHijosHtml(
  fichas: FichaHijo[],
  aspecto: number,
  nombrePadre: string,
  geometria: ItemGeometria[] = [],
): string {
  if (!fichas.length) return estadoVacioInteriorHtml(nombrePadre);
  const porId = new Map<string, ItemGeometria>(
    geometria.map((g) => [String(g.id ?? ''), g]),
  );
  const enTransito = fichas.reduce((total, ficha) => total + (ficha.enTransito ? 1 : 0), 0);
  const alerta = enTransito
    ? `<p class="portal-lienzo-alerta">${etiquetaTransitoInternoHtml()} · ${enTransito} elemento(s) guardado(s) dentro de una pieza sin estante fino asignado.</p>`
    : '';
  return `${alerta}${lienzoInteriorHtml(
    fichas.map((ficha) => piezaDeFicha(ficha, porId.get(ficha.nodo.id) ?? null)),
    aspecto,
    nombrePadre,
  )}`;
}
