// =============================================================================
// RESUMEN DE LAS SECCIONES COLAPSABLES DEL LISTADO DE OBJETOS (/objetos)
// -----------------------------------------------------------------------------
// Cada acordeón (Objetos Sueltos · Cajas e Inventario Interno · Objetos en
// Contenedor · Muebles y Estructuras Móviles) muestra en su barra desplegable:
//
//   · un BADGE con el número total de objetos que engloba la sección
//     («12 objetos», contando las tarjetas y los ítems que viven dentro), y
//   · un RESUMEN SECUNDARIO con la cantidad de sub-ítems y el valor estimado
//     acumulado (formato es-AR de `lib/formatoMoneda`, fuente única).
//
// Capa 100% PURA (sin estado ni acceso al DOM): la vista sólo vuelca los textos.
// =============================================================================

import { formatearMoneda } from './formatoMoneda';
import type { GrupoEstructura, NodoContenedor, ObjetoArbol } from './listadoObjetosPiezas';
import type { NodoCaja } from './rutaCajaMinimapas';

/** Textos que consume la barra desplegable de una sección. */
export interface ResumenSeccion {
  /** Número total de objetos que engloba la sección (badge). */
  total: number;
  /** Texto del badge: «12 objetos» / «1 objeto». */
  badge: string;
  /** Resumen secundario: sub-ítems y valor estimado acumulado. */
  detalle: string;
}

const SIN_VALOR = 'sin valor estimado';

function pluralObjetos(total: number): string {
  return total + (total === 1 ? ' objeto' : ' objetos');
}

function pluralContenedores(total: number, singular: string, plural: string): string {
  return total + ' ' + (total === 1 ? singular : plural);
}

/** Ítems físicos (tipo='objeto') que pinta el contenido de una tarjeta. */
function objetosDeNodos(nodos: Array<{ contenido?: any[] }>): ObjetoArbol[] {
  const salida: ObjetoArbol[] = [];
  for (const nodo of nodos || []) {
    for (const item of (nodo && nodo.contenido) || []) {
      if (item && item.tipo === 'objeto') salida.push(item as ObjetoArbol);
    }
  }
  return salida;
}

/** Suma de `valor_estimado` (el backend lo envía como decimal en string). */
function valorEstimadoAcumulado(items: ObjetoArbol[]): number {
  return (items || []).reduce((total, obj) => {
    const valor = Number(obj && obj.valor_estimado);
    return Number.isFinite(valor) ? total + valor : total;
  }, 0);
}

/** «💵 $1.234,56» o cadena vacía cuando ningún ítem declara valor. */
function textoValor(items: ObjetoArbol[]): string {
  const total = valorEstimadoAcumulado(items);
  return total > 0 ? '💵 ' + formatearMoneda(total) : '';
}

/** SECCIÓN · Objetos Sueltos o sin Caja. */
export function resumenSeccionSueltos(sueltos: ObjetoArbol[]): ResumenSeccion {
  const lista = sueltos || [];
  const valor = textoValor(lista);
  return {
    total: lista.length,
    badge: pluralObjetos(lista.length),
    detalle: lista.length === 0
      ? 'Sin objetos en esta sección'
      : '🧺 Ítems fuera de caja o mueble · ' + (valor || SIN_VALOR),
  };
}

/** SECCIÓN · Cajas e Inventario Interno. */
export function resumenSeccionCajas(cajas: NodoCaja[]): ResumenSeccion {
  const lista = cajas || [];
  const internos = objetosDeNodos(lista);
  const total = lista.length + internos.length;
  const detalle = [
    '📦 ' + pluralContenedores(lista.length, 'caja', 'cajas'),
    pluralContenedores(internos.length, 'ítem interno', 'ítems internos'),
    textoValor(internos),
  ].filter(Boolean).join(' · ');
  return { total, badge: pluralObjetos(total), detalle };
}

/** SECCIÓN · Objetos en Contenedor (lista plana con insignia de ubicación). */
export function resumenSeccionObjetosEnContenedor(
  items: ObjetoArbol[],
): ResumenSeccion {
  const lista = items || [];
  const valor = textoValor(lista);
  return {
    total: lista.length,
    badge: pluralObjetos(lista.length),
    detalle: [
      '📦 Guardados dentro de cajas, muebles o espacios',
      valor || (lista.length ? SIN_VALOR : ''),
    ].filter(Boolean).join(' · '),
  };
}

/** SECCIÓN · Muebles y Estructuras Móviles (+ muebles registrados como objeto). */
export function resumenSeccionMuebles(
  estructuras: GrupoEstructura[],
  mueblesObjetos: ObjetoArbol[],
): ResumenSeccion {
  const nodos: NodoContenedor[] = (estructuras || [])
    .flatMap((grupo) => (grupo && grupo.contenedores) || []);
  const internos = objetosDeNodos(nodos);
  const objetoMuebles = mueblesObjetos || [];
  const total = nodos.length + internos.length + objetoMuebles.length;
  const detalle = [
    '🗄 ' + pluralContenedores(nodos.length, 'mueble', 'muebles'),
    pluralContenedores(internos.length, 'ítem interno', 'ítems internos'),
    pluralContenedores(objetoMuebles.length, 'mueble como objeto', 'muebles como objeto'),
    textoValor([...internos, ...objetoMuebles]),
  ].filter(Boolean).join(' · ');
  return { total, badge: pluralObjetos(total), detalle };
}
