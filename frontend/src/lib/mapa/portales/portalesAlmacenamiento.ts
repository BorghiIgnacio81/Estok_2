// =============================================================================
// ORQUESTADOR DE PORTALES RECURSIVOS (máquina de pantallas asimétrica)
// -----------------------------------------------------------------------------
// Pila de nodos de profundidad libre (Miller Columns ∞). La decisión de pantalla
// vive en estadoPortales.ts + panelesPortales.ts (puros); acá se mueven los hosts
// del DOM, se cargan datos y se delega el render a los módulos puros.
//
// LEY 1 (Asimetría): el Panel Izquierdo CONSERVA el mapa del NIVEL SUPERIOR (el
// padre) con el hijo seleccionado resaltado en naranja; el derecho avanza al
// interior del seleccionado. LEY 4: «Espacio Único» → derecha a la grilla directa
// de objetos. Los visores históricos (mapa Estok, Visor de Habitación y Visor
// Contenedor Grande) siguen siendo el PLANO del Panel Izquierdo por sus eventos
// públicos, pero ahora viven en un host EXCLUSIVO de la izquierda.
// =============================================================================

import { aplicarModo } from '../../modoLienzo';
// VIEWPORT CONGELADO: el re-render del nivel conserva scroll, foco y caret.
import { conservarViewportAsync } from '../../edicionEspacioActiva';
import {
  cargarHabitacionesDePlanta,
  contenedoresRaizDeUbicacion,
  cargarContenedores,
  cargarInteriorDeNodo,
  nodoDesdeContenedor,
  nodoDesdeHabitacion,
} from './datosNodosPortales';
import type { InteriorNodo } from './datosNodosPortales';
import {
  desapilarHasta,
  estadoPortales,
  limpiarRuta,
  nodoActual,
  nodoPadre,
  profundidad,
  reemplazarNodoActual,
  empujarNodo,
} from './estadoPortales';
import type { NodoPortal } from './estadoPortales';
import { cabecerasDe, esMinimapaPadre, hostsDe, HOSTS, panelesDe, TODOS_LOS_HOSTS } from './panelesPortales';
import type { ContextoNivel } from './panelesPortales';
import { pintarAncla, renderNivelRaiz, roomDeCache } from './nivelRaizPortales';
import { sincronizarBarraComandos } from './barraComandosPortales';
import { alternarEspacioUnico, alternarMuebleMovil, pintarEditorDivisiones } from './editorDivisionesPortales';
import {
  bloqueMonoliticoHtml,
  grillaObjetosDirectosHtml,
  initGrillaObjetosDirectos,
} from './grillaObjetosDirectos';
// Barra DESTACADA del contenedor activo: «🔎 Abrir ficha completa» del
// inventario interno, con la zona de suelta que recibe los objetos arrastrados
// desde la bandeja del mismo panel. Mover la caja ya no tiene botón propio.
import { barraAccionesCajaHtml, conectarAccionesCaja } from './accionesCajaPortales';
import {
  el,
  moverPanel,
  resaltarSeleccionIzquierda,
  setTexto,
  slotDer,
  slotIzq,
} from './domPortales';
// MINIMAPA GRÁFICO PADRE: vector/SVG del nivel anterior (silueta del contenedor
// padre con el hijo activo en naranja) en la zona superior del contexto. El
// módulo es dueño de su host (`#minimapaPadreContexto`).
import { pintarMinimapaPadreContexto } from './minimapaPadreContexto';
// Canasta derecha: refresco EXPLÍCITO del fin de cadena («Espacio Único», Ley 4).
import { refrescarBandeja } from '../../bandejaSinUbicar';

/** Interior (hijos + objetos) del nodo activo, cacheado para los botones. */
let interiorActual: InteriorNodo | null = null;
/** Aviso anticolisión: evita re-entradas cuando un refresco dispara eventos. */
let refrescando = false;
/** Firma del último nivel pintado (profundidad + nodo activo + planta). */
let firmaNivel = '';

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

/**
 * LEY 1 · CONTEXTO RELACIONAL DEL NIVEL: aísla los DOS contextos que nunca deben
 * mezclarse. `activo` (tope de la pila) lo dibuja el Panel Derecho; `superior`
 * (nivel N-1) lo mantiene el Panel Izquierdo como MINIMAPA PADRE (gráfico puro).
 * Cuando la pila tiene un solo nodo, el SUPERIOR es la PLANTA (`null`).
 */
export function contextoDeNivel(): ContextoNivel {
  return {
    activo: nodoActual(),
    superior: nodoPadre(),
    plantaFijada: Boolean(estadoPortales.planta?.fila),
  };
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
// TRANSICIÓN DE PANTALLA (física dual asimétrica)
// -----------------------------------------------------------------------------

/** Aplica la física dual: apaga todos los hosts y enciende los DOS del nivel. */
export function transicionar(): void {
  const ctx = contextoDeNivel();
  const paneles = panelesDe(ctx);
  for (const id of TODOS_LOS_HOSTS) el(id)?.classList.add('hidden');
  const [idIzq, idDer] = hostsDe(paneles);
  moverPanel(el(idIzq), slotIzq());
  moverPanel(el(idDer), slotDer());

  const cab = cabecerasDe(ctx, paneles);
  setTexto('tituloPanelIzquierdo', cab.tituloIzq);
  setTexto('descPanelIzquierdo', cab.descIzq);
  setTexto('tituloPanelDerecho', cab.tituloDer);
  setTexto('descPanelDerecho', cab.descDer);
  // MINIMAPA PADRE: el cuadrante izquierdo conserva su TÍTULO (nombre del nivel
  // donde está parado el operador) y sólo se retira la leyenda larga. El
  // minimapa gráfico del nivel superior se monta en `#minimapaPadreContexto`.
  const enMinimapaPadre = esMinimapaPadre(ctx);
  slotIzq()?.classList.toggle('minimapa-padre', enMinimapaPadre);
  el('tituloPanelIzquierdo')?.classList.toggle('hidden', cab.tituloIzq.trim().length === 0);
  el('descPanelIzquierdo')?.classList.toggle('hidden', cab.descIzq.trim().length === 0);
  // El badge de nivel («Nivel 2 · Planta Alta») es un TÍTULO de contexto: se
  // conserva visible a cualquier profundidad (antes se apagaba en el minimapa).
  el('mapaJerarquicoBadge')?.classList.remove('hidden');
  // MINIMAPA GRÁFICO PADRE: se (re)dibuja en CADA transición con la geometría
  // real del nivel anterior y el nodo activo en naranja.
  void pintarMinimapaPadreContexto();

  // LEY 5 · ARRANQUE SIEMPRE EN NAVEGACIÓN: cada SALTO de la pila (cambio de
  // profundidad, de nodo activo o de planta) devuelve el lienzo a modo
  // navegación. El botón visible vuelve a ser «✏️ Editar» y el «💾 Guardar» SOLO
  // aparece si el operador toca el lápiz de forma voluntaria. Un refresco del
  // MISMO nivel (p. ej. tras arrastrar una tarjeta) conserva el modo vigente para
  // no expulsar al operador de la edición.
  const firma = `${profundidad()}|${ctx.activo?.id ?? ''}|${estadoPortales.planta?.fila ?? ''}`;
  if (firma !== firmaNivel) {
    firmaNivel = firma;
    aplicarModo('navegacion');
  }
  syncBotones();
  // Barra de comandos: el «✏️ Editar» se re-sincroniza en CADA nivel (visible y
  // operativo a cualquier profundidad de la pila de nodos).
  sincronizarBarraComandos();
  // ---------------------------------------------------------------------------
  // LEY 4 · LA CANASTA NUNCA SE APAGA EN EL ESPACIO ÚNICO (Lote 29)
  // ---------------------------------------------------------------------------
  // El fin de cadena («Espacio Único» o nodo todavía sin divisiones) es
  // justamente el nivel donde el operador MÁS necesita la canasta: es la FUENTE
  // del arrastre hacia la grilla directa de objetos. El motor la ocultaba con la
  // clase `portales-canasta-oculta` (ver styles/portales-recursivos.css), así
  // que el panel derecho quedaba vacío y no había nada que soltar sobre el
  // bloque monolítico. Ahora la canasta queda SIEMPRE viva —el contenedor ya
  // reserva su ancho con `md:pr-80`— y en este nivel se repinta de forma
  // EXPLÍCITA (llamado directo, sin el latido global que re-dispara el motor)
  // para que no arrastre el estado del nivel anterior.
  document.body.classList.remove('portales-canasta-oculta');
  if (paneles.derecho === 'grillaObjetos') refrescarBandeja();
  // ---------------------------------------------------------------------------
  // LOTE 31 · PUNTO 2 · CANASTA DEL CUADRANTE DERECHO («Espacio Único»)
  // ---------------------------------------------------------------------------
  // En el fin de cadena la canasta no sólo sigue viva (Lote 29): se INTEGRA al
  // cuadrante derecho del visor, junto al bloque monolítico y a la grilla directa
  // de objetos, para que un ambiente sin muebles internos se lea con la MISMA
  // consistencia que el lienzo habitual. La clase en <html> mueve la canasta al
  // host `#canastaCuadranteDerecho` y libera el `md:pr-80` reservado al panel
  // flotante (styles/almacenamiento-canasta-cuadrante.css): sigue habiendo UNA
  // sola canasta en pantalla, nunca dos.
  document.documentElement.classList.toggle(
    'portales-canasta-cuadrante',
    paneles.derecho === 'grillaObjetos',
  );
  // El host de la canasta del cuadrante se mantiene SIEMPRE último del cuadrante
  // derecho: los hosts de portales se reinsertan con `appendChild` en cada nivel
  // (moverPanel) y, sin este reordenamiento, la canasta quedaría por ENCIMA del
  // bloque monolítico y de su grilla directa de objetos.
  const hostCanastaCuadrante = el('canastaCuadranteDerecho');
  if (hostCanastaCuadrante) slotDer()?.appendChild(hostCanastaCuadrante);
  // CANASTA DEL PANEL DERECHO PARA LA CAJA / CONTENEDOR ACTIVO (inspección
  // interna): al abrir «Caja 01» el operador ve, debajo de su ficha y de la
  // lista de objetos guardados, la bandeja de objetos DISPONIBLES para
  // arrastrar adentro. Es el MISMO módulo de canasta montado sobre un host
  // estático (`#bandejaCajaContenido`): no hay estado ni lógica duplicada.
  // En «Espacio Único» la canasta ya vive en el cuadrante derecho, así que este
  // host se apaga para que nunca haya dos canastas en pantalla.
  const nodoDelNivel = nodoActual();
  const mostrarCanastaCaja = Boolean(
    nodoDelNivel && nodoDelNivel.tipo === 'contenedor' && !nodoDelNivel.espacioUnico,
  );
  const hostBandejaCaja = el('bandejaCajaHost');
  if (hostBandejaCaja) {
    hostBandejaCaja.classList.toggle('hidden', !mostrarCanastaCaja);
    // ORDEN DEL CUADRANTE: `moverPanel` reinserta el host activo con
    // `appendChild`, así que la canasta de la caja se re-ancla al FINAL para
    // quedar SIEMPRE debajo de su ficha y del editor (nunca arriba).
    if (mostrarCanastaCaja) slotDer()?.appendChild(hostBandejaCaja);
  }
}

/** Habilita/oculta los botones de navegación según la profundidad activa. */
function syncBotones(): void {
  const enRaiz = profundidad() === 0;
  // NIVEL RAÍZ CON PLANTA FIJADA: también hay un camino de vuelta (a la vista
  // general de Plantas), así que «⬅ Volver» sigue visible y operativo.
  const sinNavegacion = enRaiz && !estadoPortales.planta?.fila;
  const nodo = nodoActual();
  el('btnVolverNivel')?.classList.toggle('hidden', sinNavegacion);
  el('btnVolverEscena')?.classList.toggle('hidden', sinNavegacion);
  el('btnOrganizarEscena4')?.classList.toggle(
    'hidden',
    !(nodo?.tipo === 'habitacion' && (interiorActual?.piezas.length ?? 0) > 0),
  );
}

// -----------------------------------------------------------------------------
// DESCENSO Y VUELTA DE NIVEL
// -----------------------------------------------------------------------------

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
  if (profundidad() === 0) {
    // NIVEL RAÍZ CON PLANTA FIJADA: «Volver» regresa a la vista GENERAL de
    // Plantas (mini-mapas independientes del Estok) limpiando la planta activa.
    // El orquestador del lienzo acepta `fila: 0` como «soltar la planta».
    if (estadoPortales.planta?.fila) {
      window.dispatchEvent(new CustomEvent('estok:planta-elegida', { detail: { fila: 0 } }));
    }
    return;
  }
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
// RENDER DEL INTERIOR (Panel Derecho recursivo + bloque monolítico)
// -----------------------------------------------------------------------------

/**
 * Pinta el Panel Derecho del nivel activo. La decisión la toma panelesDe(): si el
 * nodo fue declarado «Espacio Único» la derecha salta a la grilla directa de
 * objetos reales; en CUALQUIER otro caso monta el editor elástico recursivo. La
 * izquierda (ancla del nivel superior) la pinta `pintarAncla` + `resaltarSeleccionIzquierda`.
 */
async function pintarNivel(nodo: NodoPortal, interior: InteriorNodo): Promise<void> {
  const paneles = panelesDe(contextoDeNivel());
  if (paneles.derecho === 'listaContenedores') {
    const host = el(HOSTS.listaContenedores);
    if (!host) return;
    // LEY 2 · DESCENSO RECURSIVO INFINITO Y REVERSIBLE: TODO nivel NO monolítico
    // (habitación, mueble, estante, caja o pieza VACÍA recién creada) despliega el
    // MISMO editor elástico («➕ Crear Espacio» + disyuntor «Espacio Único»). Sólo
    // un «Espacio Único» declarado salta a la grilla directa; destildarlo devuelve
    // el editor en caliente a CUALQUIER profundidad de la pila.
    pintarEditorDivisiones(host, nodo, interior);
    return;
  }
  // Fin de cadena / Espacio Único: grilla directa + disyuntor (Ley 4).
  iniciarGrillaDirecta(nodo, interior);
}

/**
 * LEY 4 · Fin de cadena: la DERECHA monta la grilla directa de objetos reales y
 * el disyuntor «Espacio Único» viaja a su encabezado. La IZQUIERDA conserva el
 * mapa del NIVEL SUPERIOR con el nodo monolítico resaltado en naranja.
 */
function iniciarGrillaDirecta(nodo: NodoPortal, interior: InteriorNodo): void {
  const host = el(HOSTS.grillaObjetos);
  if (!host) return;
  const enTransito = interior.objetos.filter((o) => o.en_transito_interno).length;
  const disyuntor = nodo.espacioUnico ? bloqueMonoliticoHtml(nodo, enTransito) : '';
  host.innerHTML =
    disyuntor + barraAccionesCajaHtml(nodo) + grillaObjetosDirectosHtml(nodo, interior.objetos);
  // Barra del contenedor activo («🔎 Abrir ficha completa») + zona de suelta.
  conectarAccionesCaja(host, nodo);
  initGrillaObjetosDirectos({
    contenedor: host,
    nodo,
    alCambiarEspacioUnico: (valor) => void alternarEspacioUnico(nodo, valor),
    alCambiarMuebleMovil: (valor) => void alternarMuebleMovil(nodo, valor),
  });
}

/**
 * REFRESCO DEL NIVEL ACTIVO: re-resuelve el nodo SELECCIONADO contra el padrón,
 * dibuja el mapa del NIVEL SUPERIOR (el padre) en la izquierda con el
 * seleccionado en NARANJA, carga su interior jerárquico y repinta la derecha.
 * Conserva la pila (migas, geometría y profundidad).
 */
export async function refrescarNivel(): Promise<void> {
  if (refrescando) return;
  // VIEWPORT CONGELADO: `refrescarNivel` se dispara con la respuesta de la API
  // (latido `estok:espacios-cambiados`) y repinta ambos paneles por innerHTML.
  // Se capturan scroll, foco y caret al entrar y se reponen al terminar, para
  // que el toast de éxito y el re-render no muevan la página ni un píxel (ni
  // expulsen al operador del campo que está editando).
  await conservarViewportAsync(refrescarNivelInterno);
}

async function refrescarNivelInterno(): Promise<void> {
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

    // 2) LEY 1 (Asimetría Rígida): la IZQUIERDA CONSERVA el mapa del NIVEL
    //    SUPERIOR con el seleccionado resaltado en naranja. NUNCA dibuja el
    //    interior del propio seleccionado → se mata el espejo entre cuadrantes.
    const ctx = contextoDeNivel();
    const paneles = panelesDe(ctx);
    await pintarAncla(paneles.izquierdo, ctx.superior, activo);

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
    // 4-bis) El Visor de Habitación (cuando oficia de ancla) destaca la silueta
    //     elegida en NARANJA. El cuadrante izquierdo NO pinta fichas de texto:
    //     es el MINIMAPA gráfico del nivel superior (ver transicionar).
    if (paneles.izquierdo === 'visorHabitacion') {
      window.dispatchEvent(new CustomEvent('estok:mueble-destacado', { detail: { id: actual.id } }));
    }
  } finally {
    refrescando = false;
  }
}

