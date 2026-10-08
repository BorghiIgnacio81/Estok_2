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
import { cargarHabitacionesDePlanta, invalidarCachePortales } from './datosNodosPortales';
import { panelesDe } from './panelesPortales';
import { el, slotDer, slotIzq } from './domPortales';
import {
  desapilarHasta,
  fijarPlanta,
  limpiarRuta,
  nodoActual,
  profundidad,
} from './estadoPortales';
import {
  estaRefrescando,
  interiorDelNivel,
  nodoDeContenedor,
  nodoDeHabitacion,
  portalANodo,
  refrescarNivel,
  renderMinimapaDelNivel,
  roomDeCache,
  volverARaiz,
  volverNivel,
} from './portalesAlmacenamiento';
import { conectarDropCiego, guardarEnContenedor, leerCargaArrastrada } from './transitoInterno';
import type { DestinoCiego } from './transitoInterno';

// -----------------------------------------------------------------------------
// CLIC EN TARJETAS (portales recursivos)
// -----------------------------------------------------------------------------

/** Abre el nodo de una tarjeta tocada (habitación o contenedor de cualquier nivel). */
async function abrirNodoPorId(id: string, tipo: string): Promise<void> {
  if (estaRefrescando() || !id) return;
  if (tipo === 'habitacion') {
    const rooms = await cargarHabitacionesDePlanta(null);
    const room = rooms.find((r) => String(r.id) === id) ?? roomDeCache(id);
    if (!room) return;
    // Se publica el evento público de siempre: el Visor de Habitación dibuja el
    // cuarto y la máquina de portales lo traslada al Panel Izquierdo.
    window.dispatchEvent(new CustomEvent('estok:habitacion-seleccionada', { detail: { room } }));
    return;
  }
  const nodo = await nodoDeContenedor(id);
  if (nodo) await portalANodo(nodo);
}

/** Conecta los clics por delegación (tarjetas de la derecha y grillas de la izquierda). */
function conectarPortalesPorDelegacion(): void {
  slotDer()?.addEventListener('click', (ev) => {
    const carta = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-portal-abrir]');
    if (!carta) return;
    void abrirNodoPorId(carta.dataset.portalAbrir ?? '', carta.dataset.portalTipo ?? 'contenedor');
  });
  // Grillas del Panel Izquierdo (modo NAVEGACIÓN): tocar una pieza adentro baja
  // un nivel más, de forma recursiva, sin límite de profundidad.
  slotIzq()?.addEventListener('click', (ev) => {
    if (modoLienzoActual() !== 'navegacion') return;
    const objetivo = ev.target as HTMLElement | null;
    const carta = objetivo?.closest<HTMLElement>('[data-inplace-card][data-id]');
    if (!carta || !carta.closest('#visorContenedorGrande')) return;
    void abrirNodoPorId(String(carta.dataset.id ?? ''), 'contenedor');
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
  const paneles = panelesDe(nodo);
  if (paneles.izquierdo === 'bloqueMonolitico') {
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
    if (nodo) await portalANodo(nodo);
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
    await portalANodo(nodo);
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
  conectarDropTarjetas();
  const izquierda = slotIzq();
  if (izquierda) conectarDropCiego(izquierda, destinoCiegoDe);
  // ARRANQUE: nivel raíz (plano de la planta + habitaciones con mini-mapas).
  void volverARaiz();
}


