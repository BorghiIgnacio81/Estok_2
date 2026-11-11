// =============================================================================
// VISTA DEL LISTADO JERÁRQUICO DE OBJETOS (capa de DOM pura)
// -----------------------------------------------------------------------------
// Extraído de listadoJerarquicoObjetos.ts (disciplina de modularidad: ningún
// archivo de UI supera las 400 líneas). Recibe el payload de
// GET /api/contenedores/arbol/ y vuelca las CUATRO secciones del inventario en
// el DOM:
//   1. 🧸 Objetos Sueltos o sin Caja
//   2. 📦 Cajas e Inventario Interno
//   3. 📦 Objetos en Contenedor (lista plana con insignia «📦 En Caja 02»)
//   4. 🗄 Muebles y Estructuras Móviles (+ `muebles_objetos`: Objetos de
//      categoría «Muebles» que no son cajas)
// La construcción del HTML no vive acá: se delega en listadoObjetosRender.ts y
// listadoObjetosEnContenedor.ts (capas 100% puras).
// =============================================================================

import {
  resumenInventarioHtml,
  seccionCajasHtml,
  seccionMueblesHtml,
  seccionSueltosHtml,
} from './listadoObjetosRender';
import type { PayloadArbol } from './listadoObjetosRender';
// OBJETOS de categoría «Muebles» sin caja: bloque propio dentro de la sección
// de muebles (capa pura separada para sostener el límite de 400 líneas).
import { seccionMueblesObjetosHtml } from './listadoMueblesObjetosRender';
import { seccionObjetosEnContenedorHtml } from './listadoObjetosEnContenedor';
// Resúmenes de las barras desplegables (badge + valor estimado / sub-ítems).
import {
  resumenSeccionCajas,
  resumenSeccionMuebles,
  resumenSeccionObjetosEnContenedor,
  resumenSeccionSueltos,
} from './resumenSeccionesAcordeon';

/** Referencias DOM de las secciones del inventario. */
export interface RefsInventario {
  resumen: HTMLElement | null;
  secciones: HTMLElement | null;
  seccionCajas: HTMLElement | null;
  cajasContainer: HTMLElement | null;
  badgeCajas: HTMLElement | null;
  detalleCajas: HTMLElement | null;
  seccionObjetosEnContenedor: HTMLElement | null;
  objetosEnContenedorGrid: HTMLElement | null;
  badgeObjetosEnContenedor: HTMLElement | null;
  detalleObjetosEnContenedor: HTMLElement | null;
  seccionMuebles: HTMLElement | null;
  mueblesContainer: HTMLElement | null;
  badgeMuebles: HTMLElement | null;
  detalleMuebles: HTMLElement | null;
  seccionSueltos: HTMLElement | null;
  gridSueltos: HTMLElement | null;
  badgeSueltos: HTMLElement | null;
  detalleSueltos: HTMLElement | null;
  empty: HTMLElement | null;
  sinResultados: HTMLElement | null;
}

/** Opciones del volcado en el DOM. */
export interface OpcionesRenderInventario {
  /**
   * Filtro por ubicación activo: despliega las secciones con resultados para
   * que el recorte se vea en el acto (por defecto todo queda colapsado).
   */
  filtroUbicacionActivo?: boolean;
}

/** Muestra u oculta un elemento por la clase `hidden` (idempotente). */
export function mostrar(el: HTMLElement | null, visible: boolean): void {
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

/** Vuelca un texto en un nodo (no-op si el nodo no existe). */
function setTexto(el: HTMLElement | null, texto: string): void {
  if (el) el.textContent = texto;
}

/**
 * Despliega/colapsa el acordeón de una sección. Se usa SOLO con un filtro de
 * ubicación activo: sin filtro, el estado abierto/cerrado lo decide el operador.
 */
function abrirAcordeon(seccion: HTMLElement | null, abrir: boolean): void {
  const details = seccion
    ? seccion.querySelector<HTMLDetailsElement>('details.acordeon-seccion')
    : null;
  if (details) details.open = abrir;
}

/** Recolecta las referencias DOM del markup de /objetos.astro. */
export function crearRefsInventario(): RefsInventario {
  return {
    resumen: document.getElementById('resumenInventario'),
    secciones: document.getElementById('seccionesInventario'),
    seccionCajas: document.getElementById('seccionCajas'),
    cajasContainer: document.getElementById('cajasContainer'),
    badgeCajas: document.getElementById('badgeCajas'),
    detalleCajas: document.getElementById('detalleCajas'),
    seccionObjetosEnContenedor: document.getElementById('seccionObjetosEnContenedor'),
    objetosEnContenedorGrid: document.getElementById('objetosEnContenedorGrid'),
    badgeObjetosEnContenedor: document.getElementById('badgeObjetosEnContenedor'),
    detalleObjetosEnContenedor: document.getElementById('detalleObjetosEnContenedor'),
    seccionMuebles: document.getElementById('seccionMuebles'),
    mueblesContainer: document.getElementById('mueblesContainer'),
    badgeMuebles: document.getElementById('badgeMuebles'),
    detalleMuebles: document.getElementById('detalleMuebles'),
    seccionSueltos: document.getElementById('seccionSueltos'),
    gridSueltos: document.getElementById('objetosGrid'),
    badgeSueltos: document.getElementById('badgeSueltos'),
    detalleSueltos: document.getElementById('detalleSueltos'),
    empty: document.getElementById('emptyState'),
    sinResultados: document.getElementById('sinResultados'),
  };
}

/**
 * Pinta el inventario completo del Estok activo.
 *
 * `objetos_en_contenedor` es la LISTA PLANA que garantiza que ningún ítem quede
 * oculto detrás del acordeón de su caja: con filtros activos muestra sólo los
 * que coinciden; sin filtros, todo el inventario interno.
 *
 * Cada sección es un ACORDEÓN colapsado por defecto: esta capa vuelca en su
 * barra el badge («12 objetos») y el resumen secundario (sub-ítems + valor
 * estimado acumulado). Con `filtroUbicacionActivo` las secciones con resultados
 * se despliegan solas para que el recorte se vea en el acto.
 */
export function renderInventario(
  refs: RefsInventario,
  payload: PayloadArbol,
  opciones: OpcionesRenderInventario = {},
): void {
  const estructuras = payload.estructuras || [];
  const cajas = payload.cajas || [];
  const sueltos = payload.sueltos || [];
  const objetosDentro = payload.objetos_en_contenedor || [];
  // OBJETOS de categoría «Muebles» sin caja: el backend los separa de
  // `sueltos` para que se pinten en la sección de muebles, no en la bandeja
  // de huérfanos.
  const mueblesObjetos = payload.muebles_objetos || [];
  const resumen = payload.resumen
    || { contenedores: 0, objetos_ubicados: 0, objetos_sueltos: 0 };

  // SECCIÓN 2 · 📦 Cajas e Inventario Interno (sólo cajas móviles).
  const cajasHtml = seccionCajasHtml(cajas);
  // SECCIÓN 3 · 📦 Objetos en Contenedor (lista plana con insignia).
  const objetosEnContenedorHtml = seccionObjetosEnContenedorHtml(objetosDentro);
  // SECCIÓN 4 · 🗄 Muebles y Estructuras Móviles (excluye inmuebles fijos) +
  // los Objetos de categoría «Muebles» que no son cajas.
  const mueblesHtml = seccionMueblesHtml(estructuras) + seccionMueblesObjetosHtml(mueblesObjetos);
  // SECCIÓN 1 · 🧸 Objetos Sueltos o sin Caja (bandeja de huérfanos).
  const sueltosHtml = seccionSueltosHtml(sueltos);

  const haySecciones = cajasHtml.length > 0
    || objetosEnContenedorHtml.length > 0
    || mueblesHtml.length > 0
    || sueltosHtml.length > 0;

  if (refs.resumen && haySecciones) {
    refs.resumen.innerHTML = resumenInventarioHtml(resumen, payload.filtros_activos);
    mostrar(refs.resumen, true);
  }

  // Caso borde: si TODOS los contenedores del Estok son inmuebles fijos
  // (descartados de forma absoluta) y no hay objetos sueltos ni contenido
  // interno, no queda nada que listar → estado vacío en vez de pantalla muda.
  if (!haySecciones) {
    ocultarSecciones(refs);
    mostrar(refs.resumen, false);
    if (payload.filtros_activos) {
      mostrar(refs.sinResultados, true);
    } else {
      mostrar(refs.empty, true);
    }
    return;
  }

  mostrar(refs.sinResultados, false);
  mostrar(refs.empty, false);

  if (refs.cajasContainer) refs.cajasContainer.innerHTML = cajasHtml;
  if (refs.objetosEnContenedorGrid) {
    refs.objetosEnContenedorGrid.innerHTML = objetosEnContenedorHtml;
  }
  if (refs.mueblesContainer) refs.mueblesContainer.innerHTML = mueblesHtml;
  if (refs.gridSueltos) refs.gridSueltos.innerHTML = sueltosHtml;

  // RESUMEN DE LAS BARRAS DESPLEGABLES: badge con el total de objetos de la
  // sección + detalle secundario (sub-ítems y valor estimado acumulado). Se
  // recalcula con CADA render, así el filtro por ubicación actualiza los
  // contadores en tiempo real.
  const resumenCajas = resumenSeccionCajas(cajas);
  const resumenContenedor = resumenSeccionObjetosEnContenedor(objetosDentro);
  const resumenMuebles = resumenSeccionMuebles(estructuras, mueblesObjetos);
  const resumenSueltos = resumenSeccionSueltos(sueltos);

  setTexto(refs.badgeCajas, resumenCajas.badge);
  setTexto(refs.detalleCajas, resumenCajas.detalle);
  setTexto(refs.badgeObjetosEnContenedor, resumenContenedor.badge);
  setTexto(refs.detalleObjetosEnContenedor, resumenContenedor.detalle);
  setTexto(refs.badgeMuebles, resumenMuebles.badge);
  setTexto(refs.detalleMuebles, resumenMuebles.detalle);
  setTexto(refs.badgeSueltos, resumenSueltos.badge);
  setTexto(refs.detalleSueltos, resumenSueltos.detalle);

  mostrar(refs.seccionCajas, cajasHtml.length > 0);
  mostrar(refs.seccionObjetosEnContenedor, objetosEnContenedorHtml.length > 0);
  mostrar(refs.seccionSueltos, sueltosHtml.length > 0);
  mostrar(refs.seccionMuebles, mueblesHtml.length > 0);
  // El lienzo de textura corporativa solo se muestra si hay alguna sección.
  mostrar(refs.secciones, true);

  // Con el filtro por ubicación activo se despliegan las secciones que tienen
  // resultados (las vacías quedan colapsadas y ocultas). Sin filtro se respeta
  // el estado que eligió el operador: nunca se cierra una sección a la fuerza.
  if (opciones.filtroUbicacionActivo) {
    abrirAcordeon(refs.seccionSueltos, sueltosHtml.length > 0);
    abrirAcordeon(refs.seccionCajas, cajasHtml.length > 0);
    abrirAcordeon(refs.seccionObjetosEnContenedor, objetosEnContenedorHtml.length > 0);
    abrirAcordeon(refs.seccionMuebles, mueblesHtml.length > 0);
  }
}

/** Deja todas las secciones ocultas (estado vacío / sin resultados). */
export function ocultarSecciones(refs: RefsInventario): void {
  mostrar(refs.sinResultados, false);
  mostrar(refs.secciones, false);
  mostrar(refs.seccionCajas, false);
  mostrar(refs.seccionObjetosEnContenedor, false);
  mostrar(refs.seccionSueltos, false);
  mostrar(refs.seccionMuebles, false);
}
