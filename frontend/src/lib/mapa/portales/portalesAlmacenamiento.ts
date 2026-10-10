// =============================================================================
// ORQUESTADOR DE PORTALES RECURSIVOS (máquina de pantallas asimétrica)
// -----------------------------------------------------------------------------
// Pila de nodos de profundidad libre (Miller Columns ∞). La decisión de pantalla
// vive en estadoPortales.ts + panelesPortales.ts (puros); acá se mueven los hosts
// del DOM, se cargan datos y se delega el render a los módulos puros.
//
// LEY 1 (Asimetría): el Panel Izquierdo dibuja el PLANO DEL CONTENEDOR (padre) con
// el nodo seleccionado resaltado en naranja; el derecho abre el interior del
// seleccionado. LEY 4: «Espacio Único» → derecha a la grilla directa de objetos.
// Los visores históricos (mapa Estok, Visor de Habitación y Visor Contenedor
// Grande) siguen siendo el PLANO del Panel Izquierdo por sus eventos públicos.
// =============================================================================

import { renderMinimapasAnidados } from '../../minimapasAnidados';
import type { NodoRuta } from '../../minimapasAnidados';
import { sectoresDeItems } from '../../sectoresMinimapa';
import {
  cargarHabitacionesDePlanta,
  contenedoresRaizDeUbicacion,
  objetosDeContenedor,
  cargarContenedores,
  cargarInteriorDeNodo,
  nodoDesdeContenedor,
  nodoDesdeHabitacion,
  geometriaDe,
} from './datosNodosPortales';
import type { InteriorNodo } from './datosNodosPortales';
import {
  desapilarHasta,
  estadoPortales,
  limpiarRuta,
  migas,
  nodoActual,
  nodoPadre,
  profundidad,
  reemplazarNodoActual,
  empujarNodo,
} from './estadoPortales';
import type { NodoPortal } from './estadoPortales';
import { cabecerasDe, hostsDe, panelesDe, TODOS_LOS_HOSTS } from './panelesPortales';
import { pintarAncla, renderNivelRaiz, roomDeCache } from './nivelRaizPortales';
import { sincronizarBarraComandos } from './barraComandosPortales';
import { listaHijosHtml } from './tarjetasContenedores';
import type { FichaHijo } from './tarjetasContenedores';
import { alternarEspacioUnico, pintarEditorDivisiones } from './editorDivisionesPortales';
import {
  bloqueMonoliticoHtml,
  grillaObjetosDirectosHtml,
  initGrillaObjetosDirectos,
} from './grillaObjetosDirectos';
import {
  aspectoDelLienzo,
  el,
  moverPanel,
  resaltarSeleccionIzquierda,
  setTexto,
  slotDer,
  slotIzq,
} from './domPortales';

/** Interior (hijos + objetos) del nodo activo, cacheado para los botones. */
let interiorActual: InteriorNodo | null = null;
/** Aviso anticolisión: evita re-entradas cuando un refresco dispara eventos. */
let refrescando = false;

// -----------------------------------------------------------------------------
// PUENTES PÚBLICOS HACIA LOS ENLACES (portalesEnlaces.ts)
// -----------------------------------------------------------------------------

/** ¿La máquina está en medio de un refresco? (guardia de los listeners). */
export function estaRefrescando(): boolean {
  return refrescando;
}

/** Interior del nivel activo (lo consumen los botones de la barra de acciones). */
export function interiorDelNivel(): InteriorNodo | null {
  return interiorActual;
}

/** Nodo de cascada de un contenedor real del padrón (a cualquier profundidad). */
export async function nodoDeContenedor(id: string): Promise<NodoPortal | null> {
  const conts = await cargarContenedores();
  const dto = conts.find((c) => c.id === id);
  return dto ? nodoDesdeContenedor(dto) : null;
}

/** Nodo de cascada de una HABITACIÓN real del padrón (con sus espacios). */
export async function nodoDeHabitacion(id: string): Promise<NodoPortal | null> {
  const rooms = await cargarHabitacionesDePlanta(null);
  const room = rooms.find((r) => String(r.id) === id) ?? roomDeCache(id);
  if (!room) return null;
  const espacios = await contenedoresRaizDeUbicacion(id);
  return nodoDesdeHabitacion(room, espacios);
}

// NOTA: `roomDeCache` ahora vive en nivelRaizPortales.ts (se importa arriba).

// -----------------------------------------------------------------------------
// MINIMAPAS ANIDADOS DE LA CADENA (migas reales de la pila)
// -----------------------------------------------------------------------------

function renderMinimapa(): void {
  const cont = el('minimapasAnidados');
  if (!cont) return;
  const aspecto = aspectoDelLienzo();
  const nodos: NodoRuta[] = [];
  const planta = estadoPortales.planta;
  if (planta?.fila) {
    nodos.push({
      tipo: 'estok',
      nombre: planta.nombre || 'Estok',
      filaActiva: planta.fila,
      totalPlantas: planta.total,
      sectores: sectoresDeItems(planta.hermanas, null),
      aspecto,
    });
  }
  for (const miga of migas()) {
    nodos.push({
      tipo: miga.tipo === 'habitacion' ? 'habitacion' : 'mueble',
      nombre: miga.nombre,
      id: miga.id,
      filas: miga.filas,
      columnasPorFila: miga.columnasPorFila,
      sectores: sectoresDeItems(miga.hijos, miga.id),
      aspecto,
    });
  }
  cont.innerHTML = renderMinimapasAnidados(nodos);
  cont.classList.toggle('hidden', nodos.length === 0);
}

// -----------------------------------------------------------------------------
// TRANSICIÓN DE PANTALLA (física dual)
// -----------------------------------------------------------------------------

/** Aplica la física dual: apaga todos los hosts y enciende los DOS del nivel. */
export function transicionar(): void {
  const nodo = nodoActual();
  const paneles = panelesDe(nodo, nodoPadre());
  for (const id of TODOS_LOS_HOSTS) el(id)?.classList.add('hidden');
  const [idIzq, idDer] = hostsDe(paneles);
  moverPanel(el(idIzq), slotIzq());
  moverPanel(el(idDer), slotDer());

  const cab = cabecerasDe(nodo, paneles);
  setTexto('tituloPanelIzquierdo', cab.tituloIzq);
  setTexto('descPanelIzquierdo', cab.descIzq);
  setTexto('tituloPanelDerecho', cab.tituloDer);
  setTexto('descPanelDerecho', cab.descDer);

  renderMinimapa();
  syncBotones();
  // Barra de comandos: el «✏️ Editar» se re-sincroniza en CADA nivel (visible y
  // operativo a cualquier profundidad de la pila de nodos).
  sincronizarBarraComandos();
  // FIN DE CADENA: en la grilla directa de objetos la canasta flotante se apaga
  // y el contenedor principal recupera el ancho completo (nada pisa el canvas).
  document.body.classList.toggle('portales-canasta-oculta', paneles.derecho === 'grillaObjetos');
}

/** Habilita/oculta los botones de navegación según la profundidad activa. */
function syncBotones(): void {
  const enRaiz = profundidad() === 0;
  const nodo = nodoActual();
  el('btnVolverNivel')?.classList.toggle('hidden', enRaiz);
  el('btnVolverEscena')?.classList.toggle('hidden', enRaiz);
  el('btnOrganizarEscena4')?.classList.toggle(
    'hidden',
    !(nodo?.tipo === 'habitacion' && (interiorActual?.piezas.length ?? 0) > 0),
  );
}

// -----------------------------------------------------------------------------
// DESCENSO Y VUELTA DE NIVEL
// -----------------------------------------------------------------------------

/** Repinta la guía de minimapas del nivel activo (latido de la planta). */
export function renderMinimapaDelNivel(): void {
  renderMinimapa();
}

/**
 * PORTAL GENÉRICO N → N+1: el nodo elegido pasa al Panel Izquierdo y la derecha
 * abre su interior. Si el nodo ya está activo sólo se refresca (sin duplicar).
 */
export async function portalANodo(nodo: NodoPortal): Promise<void> {
  const actual = nodoActual();
  if (!actual || actual.id !== nodo.id) empujarNodo(nodo);
  await refrescarNivel();
}

/**
 * LEY 2 · SELECCIÓN IN-PLACE: el elemento pulsado vive en el plano del CONTENEDOR
 * (mismo padre que el tope de la pila). Se REEMPLAZA el tope (no se empuja nivel)
 * para que el ancla izquierda quede QUIETA y sólo cambie el interior de la derecha.
 */
export async function seleccionarNodo(nodo: NodoPortal): Promise<void> {
  if (profundidad() > 0) desapilarHasta(profundidad() - 1);
  await portalANodo(nodo);
}

/** «⬅ Volver de Nivel»: desapila UN nivel a cualquier profundidad. */
export function volverNivel(): void {
  if (profundidad() === 0) return;
  if (profundidad() === 1) {
    // Desde una habitación se vuelve al plano general de la planta. El propio
    // Visor de Habitación limpia su montaje al recibir `room: null`.
    window.dispatchEvent(new CustomEvent('estok:habitacion-seleccionada', { detail: { room: null } }));
    return;
  }
  const anterior = desapilarHasta(profundidad() - 1);
  if (!anterior) {
    void volverARaiz();
    return;
  }
  // El refresco del nivel se encarga de re-dibujar el Panel Izquierdo del nodo
  // que quedó activo (avisa al visor histórico por el evento público).
  void refrescarNivel();
}

/** Vuelta a la raíz de la cascada (plano general de la planta). */
export async function volverARaiz(): Promise<void> {
  limpiarRuta();
  interiorActual = null;
  await renderNivelRaiz();
  transicionar();
}

// -----------------------------------------------------------------------------
// NIVEL RAÍZ Y ANCLA: ver nivelRaizPortales.ts (renderNivelRaiz / pintarAncla)
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// RENDER DEL INTERIOR (Panel Derecho recursivo + bloque monolítico)
// -----------------------------------------------------------------------------

/** Fichas del interior activo: hijos + contadores reales + geometría anidada. */
async function fichasDe(piezas: NodoPortal[]): Promise<FichaHijo[]> {
  const conts = await cargarContenedores();
  const fichas: FichaHijo[] = [];
  for (const nodo of piezas) {
    const nietos = conts.filter((c) => c.parent_contenedor === nodo.id);
    const objetos = await objetosDeContenedor(nodo.id);
    const dto = conts.find((c) => c.id === nodo.id);
    fichas.push({
      nodo,
      nietos: geometriaDe(nietos),
      subconteo: nietos.length,
      objetos: objetos.length,
      enTransito: objetos.filter((o) => o.en_transito_interno).length,
      tipo: dto?.tipo ?? '',
      esInmueble: dto?.es_inmueble ?? false,
      espacioUnico: nodo.espacioUnico,
    });
  }
  return fichas;
}

/**
 * Pinta el Panel Derecho del nivel activo. La decisión la toma panelesDe(): si el
 * nodo es «Espacio Único» / sin divisiones, la derecha salta a la grilla directa
 * de objetos reales (fin de cadena). La izquierda la pinta `pintarAncla`.
 */
async function pintarNivel(nodo: NodoPortal, interior: InteriorNodo): Promise<void> {
  const paneles = panelesDe(nodo, nodoPadre());
  if (paneles.derecho === 'listaContenedores') {
    const host = el('listaContenedoresPanel');
    if (!host) return;
    // LEY 2 · La HABITACIÓN despliega su EDITOR ELÁSTICO de divisiones (botón
    // «➕ Crear Espacio» + disyuntor «Espacio Único») en vez de un plano mudo.
    if (nodo.tipo === 'habitacion') {
      pintarEditorDivisiones(host, nodo, interior);
      return;
    }
    // Los CONTENEDORES conservan su mini-mapa de portales rotulado.
    const fichas = await fichasDe(interior.piezas);
    const aspecto = aspectoDelLienzo();
    host.innerHTML = listaHijosHtml(fichas, aspecto, nodo.nombre, interior.geometriaHijos);
    return;
  }
  // Fin de cadena / Espacio Único: grilla directa + disyuntor (Ley 4).
  iniciarGrillaDirecta(nodo, interior);
}

/**
 * LEY 4 · Fin de cadena: la DERECHA monta la grilla directa de objetos reales y
 * el disyuntor «Espacio Único» viaja a su encabezado (la izquierda ya no es el
 * bloque monolítico: es el plano del contenedor con la silueta en naranja).
 */
function iniciarGrillaDirecta(nodo: NodoPortal, interior: InteriorNodo): void {
  const host = el('grillaObjetosPanel');
  if (!host) return;
  const enTransito = interior.objetos.filter((o) => o.en_transito_interno).length;
  const disyuntor = nodo.espacioUnico ? bloqueMonoliticoHtml(nodo, enTransito) : '';
  host.innerHTML = disyuntor + grillaObjetosDirectosHtml(nodo, interior.objetos);
  initGrillaObjetosDirectos({
    contenedor: host,
    nodo,
    alCambiarEspacioUnico: (valor) => void alternarEspacioUnico(nodo, valor),
  });
}

/**
 * REFRESCO DEL NIVEL ACTIVO: re-resuelve el nodo SELECCIONADO contra el padrón,
 * dibuja el PLANO DEL CONTENEDOR (padre) en la izquierda con el seleccionado en
 * NARANJA, carga su interior jerárquico y repinta la derecha. Conserva la pila.
 */
export async function refrescarNivel(): Promise<void> {
  if (refrescando) return;
  refrescando = true;
  try {
    const nodo = nodoActual();
    if (!nodo) {
      await renderNivelRaiz();
      transicionar();
      return;
    }
    // 1) El nodo se re-resuelve contra el padrón (pudo cambiar su «Espacio Único»,
    //    sumar hijos o ser eliminado) sin perder sus migas ni su geometría.
    const fresco =
      nodo.tipo === 'habitacion' ? await nodoDeHabitacion(nodo.id) : await nodoDeContenedor(nodo.id);
    if (fresco) {
      fresco.hijos = nodo.hijos;
      fresco.celda = nodo.celda;
      reemplazarNodoActual(fresco);
    }
    const activo = nodoActual();
    if (!activo) return;

    // 2) LEY 1 (Asimetría Rígida): la IZQUIERDA dibuja el PLANO DEL CONTENEDOR
    //    (el padre) con el seleccionado resaltado en naranja. NUNCA el interior
    //    del propio seleccionado → se mata el espejo entre ambos cuadrantes.
    const padre = nodoPadre();
    const paneles = panelesDe(activo, padre);
    await pintarAncla(paneles.izquierdo, padre, activo);

    // 3) Interior jerárquico del nodo SELECCIONADO (derecha).
    interiorActual = await cargarInteriorDeNodo(activo);
    reemplazarNodoActual({
      hijos: interiorActual.geometriaHijos,
      conDivisiones: interiorActual.piezas.length > 0,
      filas: interiorActual.filas,
      columnasPorFila: interiorActual.columnasPorFila,
    });

    // 4) Paneles del nivel + física dual + resalte naranja del seleccionado.
    const actual = nodoActual() ?? activo;
    await pintarNivel(actual, interiorActual);
    transicionar();
    resaltarSeleccionIzquierda(actual.id);
    // El Visor de Habitación (cuando oficia de ancla) destaca la silueta elegida.
    if (paneles.izquierdo === 'visorHabitacion') {
      window.dispatchEvent(new CustomEvent('estok:mueble-destacado', { detail: { id: actual.id } }));
    }
  } finally {
    refrescando = false;
  }
}
