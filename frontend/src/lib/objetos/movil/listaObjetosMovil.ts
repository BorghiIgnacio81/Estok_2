// =============================================================================
// LISTA MÓVIL DE OBJETOS (/objetos) · CONTROLADOR (DOM + estado de filtros)
// -----------------------------------------------------------------------------
// Orquesta la vista móvil del inventario:
//   · Combobox 1 (criterio) → Combobox 2 (opciones del criterio, en cascada).
//   · Cada opción elegida se ACUMULA como píldora activa (una por criterio) y
//     el listado se re-filtra en memoria, sin refetch.
//   · «Limpiar filtros» borra todas las píldoras, la búsqueda y (vía callback)
//     también los filtros del escritorio, devolviendo el inventario completo.
// La lógica pura vive en listaObjetosMovilDatos.ts y el HTML en
// listaObjetosMovilVista.ts: acá sólo hay DOM y estado de los filtros.
// =============================================================================

import type { PayloadArbol } from '../../listadoObjetosPiezas';
import {
  CRITERIOS_FILTRO_MOVIL,
  construirItemsMoviles,
  filtrarItemsMoviles,
  opcionesFiltroMovil,
} from './listaObjetosMovilDatos';
import type {
  CriterioFiltroMovil,
  FiltroMovilActivo,
  ItemListaMovil,
} from './listaObjetosMovilDatos';
import { filasListaMovilHtml, pildorasFiltrosHtml } from './listaObjetosMovilVista';

/** Referencias DOM de la vista móvil (null si la pantalla no la renderiza). */
interface RefsMovil {
  lista: HTMLElement;
  criterio: HTMLSelectElement;
  opcion: HTMLSelectElement;
  pildoras: HTMLElement;
  buscar: HTMLInputElement | null;
  limpiar: HTMLElement | null;
  resumen: HTMLElement | null;
  sinResultados: HTMLElement | null;
}

let refs: RefsMovil | null = null;
let items: ItemListaMovil[] = [];
/** Un filtro activo por criterio (elegir otra opción lo reemplaza). */
const filtros = new Map<CriterioFiltroMovil, FiltroMovilActivo>();
let busqueda = '';
let alLimpiarFiltros: () => void = () => {};

// ---------------------------------------------------------------------------
// Comboboxes en cascada
// ---------------------------------------------------------------------------

/** Carga estática del combobox de criterios (fuente: CRITERIOS_FILTRO_MOVIL). */
function poblarCriterios(select: HTMLSelectElement): void {
  for (const criterio of CRITERIOS_FILTRO_MOVIL) {
    const option = document.createElement('option');
    option.value = criterio.valor;
    option.textContent = criterio.etiqueta;
    select.appendChild(option);
  }
}

/**
 * Reconstruye el combobox de OPCIONES para el criterio elegido. Sin criterio
 * (o sin opciones en el inventario) el combo queda oculto y deshabilitado.
 */
function poblarOpciones(criterio: CriterioFiltroMovil | ''): void {
  if (!refs) return;
  const select = refs.opcion;
  select.innerHTML = '';

  const marcador = document.createElement('option');
  marcador.value = '';
  marcador.textContent = 'Elegí una opción…';
  select.appendChild(marcador);

  if (!criterio) {
    select.disabled = true;
    select.classList.add('hidden');
    return;
  }

  const opciones = opcionesFiltroMovil(criterio, items);
  let grupo: HTMLOptGroupElement | null = null;
  let grupoActual = '';
  for (const opcion of opciones) {
    if (opcion.grupo && opcion.grupo !== grupoActual) {
      grupo = document.createElement('optgroup');
      grupo.label = opcion.grupo;
      grupoActual = opcion.grupo;
      select.appendChild(grupo);
    } else if (!opcion.grupo) {
      grupo = null;
      grupoActual = '';
    }
    const option = document.createElement('option');
    option.value = opcion.valor;
    option.textContent = opcion.etiqueta;
    (grupo || select).appendChild(option);
  }

  select.classList.remove('hidden');
  select.disabled = opciones.length === 0;
  if (opciones.length === 0) marcador.textContent = 'Sin opciones disponibles';
}

/** Devuelve ambos comboboxes a su estado inicial (sin criterio elegido). */
function resetearSelectores(): void {
  if (!refs) return;
  refs.criterio.value = '';
  poblarOpciones('');
}

// ---------------------------------------------------------------------------
// Estado de filtros + pintado
// ---------------------------------------------------------------------------

/** Acumula (o reemplaza) el filtro del criterio y agrega su píldora. */
function agregarFiltro(criterio: CriterioFiltroMovil, valor: string): void {
  const opcion = opcionesFiltroMovil(criterio, items).find((o) => o.valor === valor);
  if (!opcion) return;
  filtros.set(criterio, { criterio, valor, etiqueta: opcion.etiqueta });
  resetearSelectores();
  pintar();
}

/** Quita la píldora de un criterio (el resto de los filtros se conserva). */
function quitarFiltro(criterio: CriterioFiltroMovil): void {
  filtros.delete(criterio);
  pintar();
}

/**
 * Blanquea píldoras, búsqueda y comboboxes de la vista móvil SIN recargar.
 * La invoca el «Limpiar Filtros» del escritorio para que ambas vistas queden
 * siempre espejadas (el listado móvil queda oculto en pantallas grandes, pero
 * su estado no debe sobrevivir a un blanqueo global).
 */
export function limpiarFiltrosMovil(): void {
  filtros.clear();
  busqueda = '';
  if (refs && refs.buscar) refs.buscar.value = '';
  resetearSelectores();
  pintar();
}

/** «Limpiar filtros» (botón móvil): blanquea la vista y los filtros del escritorio. */
function limpiarTodo(): void {
  limpiarFiltrosMovil();
  alLimpiarFiltros();
}

/** Vuelca píldoras, contador y renglones de la lista en el DOM. */
function pintar(): void {
  if (!refs) return;
  const activos = Array.from(filtros.values());
  const visibles = filtrarItemsMoviles(items, activos, busqueda);

  refs.pildoras.innerHTML = pildorasFiltrosHtml(activos);
  refs.pildoras.classList.toggle('hidden', activos.length === 0);
  refs.lista.innerHTML = filasListaMovilHtml(visibles);
  refs.lista.classList.toggle('hidden', visibles.length === 0);

  if (refs.sinResultados) {
    refs.sinResultados.classList.toggle(
      'hidden',
      !(items.length > 0 && visibles.length === 0),
    );
  }
  if (refs.resumen) {
    refs.resumen.textContent = items.length
      ? visibles.length + ' de ' + items.length + ' ítem(s)'
      : '';
  }
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

/**
 * Inicializa la vista móvil. Idempotente por pantalla: si el markup no existe
 * (cualquier otra pantalla) no hace nada.
 *
 * `alLimpiarFiltros` lo aporta el controlador del listado: además de las
 * píldoras móviles, «Limpiar filtros» devuelve los filtros del escritorio a su
 * valor inicial y recarga el árbol (una sola consulta, todo consistente).
 */
export function initListaObjetosMovil(
  opciones: { alLimpiarFiltros?: () => void } = {},
): void {
  alLimpiarFiltros = opciones.alLimpiarFiltros || (() => {});
  const lista = document.getElementById('listaObjetosMovil');
  const criterio = document.getElementById('movilCriterio') as HTMLSelectElement | null;
  const opcion = document.getElementById('movilOpcion') as HTMLSelectElement | null;
  const pildoras = document.getElementById('movilPildoras');
  if (!lista || !criterio || !opcion || !pildoras) return;

  const buscar = document.getElementById('movilBuscar') as HTMLInputElement | null;
  const limpiar = document.getElementById('movilLimpiar');
  refs = {
    lista,
    criterio,
    opcion,
    pildoras,
    buscar,
    limpiar,
    resumen: document.getElementById('movilResumen'),
    sinResultados: document.getElementById('movilSinResultados'),
  };

  poblarCriterios(criterio);
  poblarOpciones('');

  criterio.addEventListener('change', () => {
    poblarOpciones((criterio.value || '') as CriterioFiltroMovil | '');
  });

  opcion.addEventListener('change', () => {
    const activo = (criterio.value || '') as CriterioFiltroMovil | '';
    if (!activo || !opcion.value) return;
    agregarFiltro(activo, opcion.value);
  });

  pildoras.addEventListener('click', (evento) => {
    const target = evento.target as HTMLElement | null;
    const btn = target && target.closest
      ? target.closest('button[data-quitar-filtro]') as HTMLElement | null
      : null;
    if (!btn) return;
    evento.preventDefault();
    const activo = btn.getAttribute('data-quitar-filtro') as CriterioFiltroMovil | null;
    if (activo) quitarFiltro(activo);
  });

  let timeout: number | null = null;
  if (buscar) {
    buscar.addEventListener('input', () => {
      if (timeout) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        busqueda = buscar.value;
        pintar();
      }, 180);
    });
  }

  if (limpiar) limpiar.addEventListener('click', limpiarTodo);
  enlazarCierreMenus();
  pintar();
}

/** Cierra los menús «⋯» abiertos al tocar fuera o al elegir una acción. */
function enlazarCierreMenus(): void {
  document.addEventListener('click', (evento) => {
    const target = evento.target as HTMLElement | null;
    if (!target || !target.closest) return;
    const abierto = target.closest('details.js-menu-movil') as HTMLDetailsElement | null;
    if (!abierto && !target.closest('#listaObjetosMovil')) return;
    document.querySelectorAll<HTMLDetailsElement>('#listaObjetosMovil details.js-menu-movil[open]')
      .forEach((menu) => {
        if (menu !== abierto || target.closest('a, button')) menu.open = false;
      });
  });
}

/**
 * Vuelca en la vista móvil el payload recién cargado (lo invoca el controlador
 * del listado tras cada carga o recarga del árbol). Mantiene los filtros
 * activos: si un criterio quedó elegido en el combobox, repuebla sus opciones.
 */
export function actualizarListaObjetosMovil(payload: PayloadArbol): void {
  items = construirItemsMoviles(payload);
  if (!refs) return;
  const criterio = (refs.criterio.value || '') as CriterioFiltroMovil | '';
  if (criterio) poblarOpciones(criterio);
  pintar();
}
