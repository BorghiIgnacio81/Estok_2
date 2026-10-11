// =============================================================================
// ENLACES DEL MOTOR DE PORTALES (delegación, Drop y eventos públicos)
// -----------------------------------------------------------------------------
// Une el DOM con la máquina de la cascada (portalesAlmacenamiento.ts):
//   · CLIC en una tarjeta del Panel Derecho  → portal N → N+1 (recursivo).
//   · CLIC en una pieza de la grilla izquierda → descenso recursivo.
//   · DROP sobre una tarjeta con divisiones  → «En Tránsito Interno» nativo.
//   · DROP a ciegas sobre el nodo activo     → ubicación general (sin celda).
//   · Eventos públicos históricos (estok:*)  → alimentan la pila de niveles.
//
// Conserva EXACTAMENTE los mismos nombres de evento que usaban los módulos
// existentes (mapa Estok, Visor de Habitación y Visor Contenedor Grande), de modo
// que ninguno de ellos cambia su API.
// =============================================================================

import type { UbicacionPlano } from '../../mapaJerarquico';
import type { ItemGeometria } from '../../sectoresMinimapa';
import { modoLienzoActual } from '../../modoLienzo';
import { invalidarCachePortales } from './datosNodosPortales';
import { el, slotDer, slotIzq } from './domPortales';
import {
  desapilarHasta,
  fijarPlanta,
  limpiarRuta,
  nodoActual,
  profundidad,
} from './estadoPortales';
import type { NodoPortal } from './estadoPortales';
import {
  estaRefrescando,
  interiorDelNivel,
  nodoDeContenedor,
  nodoDeHabitacion,
  portalANodo,
  refrescarNivel,
  renderMinimapaDelNivel,
  seleccionarNodo,
  volverARaiz,
  volverNivel,
} from './portalesAlmacenamiento';
import { conectarDropCiego, guardarEnContenedor, leerCargaArrastrada } from './transitoInterno';
import type { DestinoCiego } from './transitoInterno';

// -----------------------------------------------------------------------------
// CLIC EN TARJETAS (portales recursivos)
// -----------------------------------------------------------------------------

/** Resuelve el nodo de portal de un id real (habitación o contenedor). */
async function nodoDelPortal(id: string, tipo: string): Promise<NodoPortal | null> {
  if (!id) return null;
  return tipo === 'habitacion' ? nodoDeHabitacion(id) : nodoDeContenedor(id);
}

/**
 * LEY 3 · CLIC EN EL PANEL DERECHO (Traslación + Descenso N+1): el mapa que estaba
 * a la derecha pasa al Panel Izquierdo como ancla, el elemento pulsado queda en
 * NARANJA y la derecha avanza al interior jerárquico del nodo.
 */
async function descenderDesdeDerecha(id: string, tipo: string): Promise<void> {
  if (estaRefrescando()) return;
  const nodo = await nodoDelPortal(id, tipo);
  if (nodo) await portalANodo(nodo);
}

/**
 * LEY 2 · CLIC EN EL PANEL IZQUIERDO (Selección In-Place): el ancla NO se mueve,
 * el elemento se resalta en NARANJA y la derecha transmuta al interior fino de
 * ESE nodo (sin bajar de nivel el ancla izquierda).
 */
async function seleccionarEnIzquierda(id: string, tipo: string): Promise<void> {
  if (estaRefrescando()) return;
  const nodo = await nodoDelPortal(id, tipo);
  if (nodo) await seleccionarNodo(nodo);
}

/**
 * Controles del EDITOR ELÁSTICO —compartido por habitaciones y por CUALQUIER
 * contenedor con sub-divisiones (recursivo ∞)— que NO disparan un portal al
 * tocarlos: fusionar, eliminar, renombrar, estirar una tarjeta interna y los
 * TIRADORES DEL PERÍMETRO ámbar (ancho/alto del marco completo).
 */
const CONTROLES_EDITOR =
  '[data-fusion-check],[data-eliminar-item],[data-eliminar-grupo],[data-inplace-renombrar],[data-libre-resize],[data-grupo-resize],[data-perimetro-resize],[data-lienzo-crear],[data-espacio-unico]';

/**
 * LEY 2 · Resuelve una silueta del EDITOR ELÁSTICO del Panel Derecho (habitación
 * o contenedor con sub-divisiones) como portal de contenedor: en modo NAVEGACIÓN
 * cada rectángulo navega a su interior jerárquico; en modo EDICIÓN el clic edita
 * (arrastrar/estirar/fusionar/estirar el perímetro).
 */
function contenedorDeEditor(objetivo: HTMLElement | null): string | null {
  if (modoLienzoActual() !== 'navegacion') return null;
  if (!objetivo || objetivo.closest(CONTROLES_EDITOR)) return null;
  const card = objetivo.closest<HTMLElement>('[data-lienzo-pu] [data-inplace-card][data-id]');
  return card?.dataset.id ?? null;
}

/** Conecta los clics por delegación de AMBOS paneles del flujo asimétrico. */
function conectarPortalesPorDelegacion(): void {
  // LEY 3: la derecha desciende (el mapa viaja al ancla izquierda).
  slotDer()?.addEventListener('click', (ev) => {
    const objetivo = ev.target as HTMLElement | null;
    const carta = objetivo?.closest<HTMLElement>('[data-portal-abrir]');
    if (carta) {
      void descenderDesdeDerecha(carta.dataset.portalAbrir ?? '', carta.dataset.portalTipo ?? 'contenedor');
      return;
    }
    // LEY 2 · El EDITOR ELÁSTICO del cuarto (derecha): en modo NAVEGACIÓN cada
    // silueta es un portal que baja al interior jerárquico de esa división.
    const idEditor = contenedorDeEditor(objetivo);
    if (idEditor) void descenderDesdeDerecha(idEditor, 'contenedor');
  });
  // LEY 2: la izquierda selecciona in-place (el ancla queda quieta).
  slotIzq()?.addEventListener('click', (ev) => {
    if (modoLienzoActual() !== 'navegacion') return;
    const carta = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-portal-abrir]');
    if (!carta) return;
    void seleccionarEnIzquierda(carta.dataset.portalAbrir ?? '', carta.dataset.portalTipo ?? 'contenedor');
  });
  // ESTADO DE ESPERA INICIAL: la tarjeta de PLANTA del Panel Derecho elige esa
  // planta → el orquestador del lienzo sube de nivel (planta fija a la
  // izquierda con sus habitaciones + derecha a la espera de una habitación).
  slotDer()?.addEventListener('click', (ev) => {
    const tarjeta = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-planta-fila]');
    if (!tarjeta) return;
    const fila = Number(tarjeta.dataset.plantaFila);
    if (!fila) return;
    window.dispatchEvent(
      new CustomEvent('estok:planta-elegida', {
        detail: { fila, nombre: tarjeta.dataset.plantaNombre ?? '' },
      }),
    );
  });
}

// -----------------------------------------------------------------------------
// DROP SOBRE LAS TARJETAS DEL PANEL DERECHO (guardado jerárquico)
// -----------------------------------------------------------------------------

/**
 * Soltar un bulto sobre una tarjeta = guardarlo DENTRO de esa pieza.
 * Si la pieza tiene divisiones internas y no se eligió estante, el backend la
 * marca «En Tránsito Interno» (figura preexistente del sistema); si es un
 * «Espacio Único» el guardado es directo.
 */
function conectarDropTarjetas(): void {
  const host = slotDer();
  if (!host) return;
  const cartaDe = (ev: Event): HTMLElement | null =>
    (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-portal-drop]') ?? null;

  host.addEventListener('dragover', (ev) => {
    const carta = cartaDe(ev);
    if (!carta) return;
    const de = ev as DragEvent;
    ev.preventDefault();
    if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
    carta.classList.add('portal-drop-activo');
  });
  host.addEventListener('dragleave', (ev) => cartaDe(ev)?.classList.remove('portal-drop-activo'));
  host.addEventListener('drop', (ev) => {
    const de = ev as DragEvent;
    const carta = cartaDe(ev);
    if (!carta) return;
    ev.preventDefault();
    ev.stopPropagation();
    carta.classList.remove('portal-drop-activo');
    const id = carta.dataset.portalDrop ?? '';
    const carga = leerCargaArrastrada(de);
    if (!id || !carga) return;
    void guardarEnContenedor(carga, {
      contenedorId: id,
      nombre: carta.dataset.portalNombre ?? 'la pieza',
      tieneDivisiones: carta.dataset.portalDivisiones === '1',
      fila: null,
      col: null,
    });
  });
}

// -----------------------------------------------------------------------------
// DROP A CIEGAS SOBRE EL NODO ACTIVO (Panel Izquierdo)
// -----------------------------------------------------------------------------

/** Destino del Drop a ciegas: el contenedor/cuarto que ocupa la izquierda. */
function destinoCiegoDe(): DestinoCiego | null {
  const nodo = nodoActual();
  if (!nodo) return null;
  // Un CUARTO es una Ubicación: su drop general guarda la ubicación, no un padre.
  if (nodo.tipo === 'habitacion') {
    return { tipo: 'ubicacion', id: nodo.id, nombre: nodo.nombre, tieneDivisiones: nodo.conDivisiones };
  }
  if (nodo.espacioUnico) {
    return { tipo: 'contenedor', id: nodo.id, nombre: nodo.nombre, tieneDivisiones: false };
  }
  return { tipo: 'contenedor', id: nodo.id, nombre: nodo.nombre, tieneDivisiones: nodo.conDivisiones };
}

/** «📦 Organizar Contenido»: entra al primer espacio del cuarto activo. */
function organizarContenido(): void {
  const primera = interiorDelNivel()?.piezas[0];
  if (primera) void portalANodo(primera);
}

// -----------------------------------------------------------------------------
// LISTENERS DE LA CASCADA (eventos públicos de siempre)
// -----------------------------------------------------------------------------

function alSeleccionarPlanta(e: Event): void {
  if (estaRefrescando()) return;
  const detalle =
    (e as CustomEvent<{
      fila: number | null;
      nombre?: string | null;
      total?: number;
      hermanas?: ItemGeometria[];
    }>).detail ?? ({} as never);
  fijarPlanta({
    fila: detalle.fila ?? null,
    nombre: detalle.nombre ?? '',
    total: Math.max(1, Math.floor(Number(detalle.total) || 1)),
    hermanas: detalle.hermanas ?? [],
  });
  // PERSISTENCIA DE NIVEL: un re-latido (estok:espacios-cambiados) con la cascada
  // abierta NO devuelve al operador al plano: sólo refresca planta y minimapa.
  if (profundidad() > 0) {
    renderMinimapaDelNivel();
    return;
  }
  if (!detalle.fila) {
    void volverARaiz();
    return;
  }
  void refrescarNivel();
}

/**
 * ¿El último clic partió del Panel Izquierdo? Ley 2: ese gesto es SELECCIÓN
 * in-place (el ancla queda quieta), no un descenso de nivel.
 */
let clicEnIzquierda = false;

/** Marca el origen del clic en fase de CAPTURA sobre el ancla izquierda. */
function vigilarOrigenDelClic(): void {
  slotIzq()?.addEventListener(
    'click',
    () => {
      clicEnIzquierda = true;
      setTimeout(() => {
        clicEnIzquierda = false;
      }, 0);
    },
    true,
  );
}

function alSeleccionarHabitacion(e: Event): void {
  if (estaRefrescando()) return;
  const room = (e as CustomEvent<{ room: UbicacionPlano | null }>).detail?.room ?? null;
  void (async () => {
    if (!room) {
      limpiarRuta();
      await refrescarNivel();
      return;
    }
    const nodo = await nodoDeHabitacion(String(room.id));
    if (!nodo) return;
    await (clicEnIzquierda ? seleccionarNodo(nodo) : portalANodo(nodo));
  })();
}

function alSeleccionarMueble(e: Event): void {
  if (estaRefrescando()) return;
  const detalle = (e as CustomEvent<{ id?: string | null; nombre?: string }>).detail ?? {};
  const id = detalle.id ?? null;
  if (!id) {
    // «← Ver todos los muebles»: se vuelve al nivel de la habitación.
    desapilarHasta(1);
    void refrescarNivel();
    return;
  }
  if (profundidad() === 0) return;
  void (async () => {
    const nodo = await nodoDeContenedor(id);
    if (!nodo) return;
    if (detalle.nombre) nodo.nombre = detalle.nombre;
    await (clicEnIzquierda ? seleccionarNodo(nodo) : portalANodo(nodo));
  })();
}

function alCambiarEspacios(): void {
  if (estaRefrescando()) return;
  invalidarCachePortales();
  void refrescarNivel();
}

// -----------------------------------------------------------------------------
// ENTRADA
// -----------------------------------------------------------------------------

export function iniciarPortalesAlmacenamiento(): void {
  window.addEventListener('estok:planta-seleccionada', alSeleccionarPlanta);
  window.addEventListener('estok:habitacion-seleccionada', alSeleccionarHabitacion);
  window.addEventListener('estok:mueble-seleccionado', alSeleccionarMueble);
  window.addEventListener('estok:espacios-cambiados', alCambiarEspacios);
  el('btnVolverNivel')?.addEventListener('click', () => volverNivel());
  el('btnVolverEscena')?.addEventListener('click', () => volverNivel());
  el('btnOrganizarEscena4')?.addEventListener('click', () => organizarContenido());
  conectarPortalesPorDelegacion();
  vigilarOrigenDelClic();
  conectarDropTarjetas();
  const izquierda = slotIzq();
  if (izquierda) conectarDropCiego(izquierda, destinoCiegoDe);
  // ARRANQUE: nivel raíz (plano de la planta + habitaciones con mini-mapas).
  void volverARaiz();
}


