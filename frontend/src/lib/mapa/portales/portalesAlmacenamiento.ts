// =============================================================================
// ORQUESTADOR DE PORTALES RECURSIVOS (Miller Columns INFINITO)
// -----------------------------------------------------------------------------
// Máquina de pantallas de la sección Almacenamiento. Reemplaza la escala fija de
// niveles (0..4) por una PILA de nodos de profundidad libre:
//
//   · El nodo elegido en el Panel Derecho se traslada DE INMEDIATO al Panel
//     Izquierdo, donde se dibuja su sub-grilla elástica interna de divisiones.
//   · El Panel Derecho TRANSMUTA y abre el interior jerárquico de ese nodo
//     (sub-contenedores, estantes, cajones o cajas) de forma recursiva.
//   · Disyuntor «Espacio Único»: se bloquea el modelador de la izquierda y la
//     derecha pasa a la GRILLA DIRECTA de objetos reales (fin de cadena).
//   · Drop a ciegas sobre el nodo activo → «En Tránsito Interno» nativo.
//
// La decisión de pantalla vive en estadoPortales.ts + panelesPortales.ts (puros);
// acá sólo se mueven los hosts del DOM, se cargan los datos y se delega el render
// a los módulos puros (tarjetasHabitaciones / tarjetasContenedores /
// grillaObjetosDirectos).
//
// Los visores históricos (mapa Estok, Visor de Habitación y Visor Contenedor
// Grande) se siguen usando como PLANO del Panel Izquierdo: la máquina los mueve y
// les avisa con los MISMOS eventos públicos de siempre (estok:habitacion-seleccionada
// / estok:mueble-seleccionado), así que ningún módulo existente cambia su API.
// =============================================================================

import { renderMinimapasAnidados } from '../../minimapasAnidados';
import type { NodoRuta } from '../../minimapasAnidados';
import { sectoresDeItems } from '../../sectoresMinimapa';
import type { UbicacionPlano } from '../../mapaJerarquico';
import {
  cargarHabitacionesDePlanta,
  cargarPlantas,
  cargarUbicaciones,
  contenedoresRaizDeUbicacion,
  datosDeNivelPlanta,
  guardarEspacioUnico,
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
  profundidad,
  reemplazarNodoActual,
  empujarNodo,
} from './estadoPortales';
import type { NodoPortal } from './estadoPortales';
import { cabecerasDe, hostsDe, panelesDe, TODOS_LOS_HOSTS } from './panelesPortales';
import { listaHabitacionesHtml } from './tarjetasHabitaciones';
import { listaHijosHtml } from './tarjetasContenedores';
import type { FichaHijo } from './tarjetasContenedores';
import {
  bloqueMonoliticoHtml,
  grillaObjetosDirectosHtml,
  initGrillaObjetosDirectos,
} from './grillaObjetosDirectos';
import { aspectoDelLienzo, el, moverPanel, setTexto, slotDer, slotIzq } from './domPortales';

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

/** Ubicación real (habitación o planta) desde la caché del nivel raíz. */
export function roomDeCache(id: string): UbicacionPlano | null {
  return cacheUbicacionesLocal?.find((u) => String(u.id) === id) ?? null;
}

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
  const paneles = panelesDe(nodo);
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
// RENDER DEL NIVEL RAÍZ (plano general + habitaciones con mini-mapas internos)
// -----------------------------------------------------------------------------

/** Caché local de ubicaciones del último nivel raíz resuelto. */
let cacheUbicacionesLocal: UbicacionPlano[] | null = null;

/** Id real de la división (planta) activa, resuelto por su fila del macro-plano. */
async function plantaIdActiva(): Promise<string | null> {
  const fila = estadoPortales.planta?.fila;
  if (!fila) return null;
  const plantas = await cargarPlantas();
  const div = plantas.find((p) => (p.parent_grid_row || 1) === fila);
  return div ? String(div.id) : null;
}

/** Pinta el Panel Derecho del nivel raíz: habitaciones + mini-mapas internos. */
async function renderNivelRaiz(): Promise<void> {
  const plantaId = await plantaIdActiva();
  const datos = await datosDeNivelPlanta(plantaId);
  cacheUbicacionesLocal = await cargarUbicaciones();
  const host = el('listaHabitacionesPanel');
  if (host) {
    host.innerHTML = listaHabitacionesHtml(datos.rooms, datos.espaciosPorRoom, aspectoDelLienzo());
  }
}


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

/** Persiste el disyuntor «Espacio Único» y re-transiciona en caliente. */
async function alternarEspacioUnico(nodo: NodoPortal, valor: boolean): Promise<void> {
  // La habitación persiste su flag en Ubicación; los contenedores en Contenedor.
  const recurso = nodo.tipo === 'habitacion' ? 'ubicaciones' : 'contenedores';
  const ok = await guardarEspacioUnico(nodo.id, valor, recurso);
  if (!ok) return;
  reemplazarNodoActual({ espacioUnico: valor });
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
}

/**
 * Pinta los DOS paneles del nivel activo. La decisión la toma panelesDe(): si el
 * nodo es «Espacio Único» / sin divisiones, la izquierda monta el bloque
 * monolítico y la derecha la grilla directa de objetos reales.
 */
async function pintarNivel(nodo: NodoPortal, interior: InteriorNodo): Promise<void> {
  const paneles = panelesDe(nodo);
  if (paneles.derecho === 'listaContenedores') {
    const host = el('listaContenedoresPanel');
    if (host) {
      host.innerHTML = listaHijosHtml(await fichasDe(interior.piezas), aspectoDelLienzo(), nodo.nombre);
    }
    return;
  }
  const host = el('grillaObjetosPanel');
  if (host) host.innerHTML = grillaObjetosDirectosHtml(nodo, interior.objetos);
  iniciarGrillaDirecta(nodo, interior);
}

/** Bloque monolítico del Panel Izquierdo + grilla directa del derecho. */
function iniciarGrillaDirecta(nodo: NodoPortal, interior: InteriorNodo): void {
  const izquierda = el('bloqueMonoliticoPanel');
  if (izquierda) {
    const enTransito = interior.objetos.filter((o) => o.en_transito_interno).length;
    izquierda.innerHTML = bloqueMonoliticoHtml(nodo, enTransito);
    // Disyuntor de estructura: destildar «Espacio Único» devuelve el modelador.
    izquierda.querySelector<HTMLInputElement>('[data-espacio-unico]')?.addEventListener('change', (ev) => {
      const chk = ev.target as HTMLInputElement;
      void alternarEspacioUnico(nodo, chk.checked);
    });
  }
  initGrillaObjetosDirectos({
    contenedor: el('grillaObjetosPanel'),
    nodo,
    alCambiarEspacioUnico: (valor) => void alternarEspacioUnico(nodo, valor),
  });
}

/**
 * REFRESCO DEL NIVEL ACTIVO: re-resuelve el nodo contra el padrón real, avisa a
 * los visores históricos para que dibujen el PLANO de la izquierda, carga el
 * interior jerárquico y repinta la derecha. Conserva siempre la profundidad.
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

    // 2) Los visores históricos dibujan el PLANO del Panel Izquierdo: el nodo se
    //    traslada a la izquierda con su sub-grilla elástica interna. Con el
    //    modelador BLOQUEADO (bloque monolítico) no se pide ningún render.
    const paneles = panelesDe(activo);
    if (paneles.izquierdo === 'visorHabitacion') {
      const room = roomDeCache(activo.id);
      if (room) {
        window.dispatchEvent(
          new CustomEvent('estok:habitacion-seleccionada', { detail: { room } }),
        );
      }
    } else if (paneles.izquierdo === 'grillaNodo') {
      window.dispatchEvent(
        new CustomEvent('estok:mueble-seleccionado', {
          detail: { id: activo.id, nombre: activo.nombre, hermanos: activo.hijos },
        }),
      );
    }

    // 3) Interior jerárquico del nodo activo (hijos + objetos reales).
    interiorActual = await cargarInteriorDeNodo(activo);
    reemplazarNodoActual({
      hijos: interiorActual.geometriaHijos,
      conDivisiones: interiorActual.piezas.length > 0,
      filas: interiorActual.filas,
      columnasPorFila: interiorActual.columnasPorFila,
    });

    // 4) Paneles del nivel + física dual.
    await pintarNivel(nodoActual() ?? activo, interiorActual);
    transicionar();
  } finally {
    refrescando = false;
  }
}
