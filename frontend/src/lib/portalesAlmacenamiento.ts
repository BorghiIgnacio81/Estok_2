// =============================================================================
// NAVEGACIÓN POR PORTALES (izquierda ⟵ derecha) DE LA PANTALLA DE ALMACENAMIENTO
// -----------------------------------------------------------------------------
// Reestructura la cascada como un flujo de MILLER COLUMNS con estado en caliente:
//   Nivel 0 · Estok      → Izq = Mapa Estok (casa)      · Der = plantas
//   Nivel 1 · Planta     → Izq = Plano de habitaciones  · Der = habitaciones
//   Nivel 2 · Habitación → Izq = Visor de Habitación    · Der = muebles + objetos
//   Nivel 3 · Mueble     → Izq = grilla interna mueble  · Der = estanterías/cajones
//   Nivel 4 · Caja       → Izq = canvas de la caja      · Der = objetos finos
//
// En MODO NAVEGACIÓN el clic sobre una tarjeta actúa como PORTAL: la pieza
// clickeada "pasa al LADO IZQUIERDO" y el LADO DERECHO carga asíncronamente su
// contenido interno. En MODO EDICIÓN el clic edita in-place (renombrar/arrastrar/
// fusionar/estirar) — el gate vive en modoLienzo.ts.
//
// La red de MINIMAPAS ANIDADOS (cima del panel derecho) se refresca en cada
// transición (minimapasAnidados.ts) con el nodo activo en NARANJA (#f97316).
// =============================================================================

import { renderMinimapasAnidados } from './minimapasAnidados';
import type { NodoRuta } from './minimapasAnidados';
import { sectoresDeItems } from './sectoresMinimapa';
import type { ItemGeometria } from './sectoresMinimapa';
import { ASPECTO_LIENZO } from './minimapa';
import { modoLienzoActual } from './modoLienzo';
import { filasInternasDe, columnasDeFilaInterna } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';
import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import type { CajaSeleccionada } from './cajaDetalle';

export type NivelPortales = 0 | 1 | 2 | 3 | 4;

interface EstadoPortales {
  nivel: NivelPortales;
  plantaFila: number | null;
  plantaTotal: number;
  plantaNombre: string;
  room: UbicacionPlano | null;
  /** Habitaciones hermanas de la planta activa (geometría real para el minimapa). */
  hermanasRoom: ItemGeometria[];
  mueble: { id: string; nombre: string } | null;
  /** Muebles hermanos de la habitación activa (geometría real para el minimapa). */
  hermanosMueble: ItemGeometria[];
  muebleFilas: number;
  muebleColumnas: number[];
  caja: CajaSeleccionada | null;
}

const estado: EstadoPortales = {
  nivel: 0,
  plantaFila: null,
  plantaTotal: 1,
  plantaNombre: '',
  room: null,
  hermanasRoom: [],
  mueble: null,
  hermanosMueble: [],
  muebleFilas: 1,
  muebleColumnas: [1],
  caja: null,
};

// -----------------------------------------------------------------------------
// HELPERS DE DOM
// -----------------------------------------------------------------------------

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

const slotIzq = (): HTMLElement | null => el('contenidoPanelIzquierdo');
const slotDer = (): HTMLElement | null => el('contenidoPanelDerecho');

function moverPanel(panel: HTMLElement | null, slot: HTMLElement | null): void {
  if (!panel || !slot) return;
  slot.appendChild(panel);
  panel.classList.remove('hidden');
}

/** Grilla asimétrica (columnas por fila) de una Ubicación, en vivo. */
function columnasPorFilaDe(obj: UbicacionPlano): number[] {
  const filas = filasInternasDe(obj);
  const cols: number[] = [];
  for (let i = 1; i <= filas; i++) cols.push(columnasDeFilaInterna(obj, i));
  return cols;
}

// -----------------------------------------------------------------------------
// ORQUESTACIÓN DE NIVELES (mueve los planos entre los dos paneles)
// -----------------------------------------------------------------------------

function irANivel(nivel: NivelPortales): void {
  estado.nivel = nivel;
  const izq = slotIzq();
  const der = slotDer();
  const mapa = el('mapaEstokPanel');
  const visor = el('visorHabitacion');
  const cg = el('visorContenedorGrande');
  const carga = el('cargaFinaPanel');
  const cajaCanvas = el('cajaCanvas');
  const cajaObjetos = el('cajaObjetos');

  // Todos los planos arrancan ocultos: cada nivel enciende solo los suyos.
  [mapa, visor, cg, carga, cajaCanvas, cajaObjetos].forEach((p) => p?.classList.add('hidden'));
  if (!izq || !der) return;

  if (nivel <= 1) {
    moverPanel(mapa, izq);
    moverPanel(visor, der);
  } else if (nivel === 2) {
    // Habitación: el Visor de Habitación pasa a la IZQUIERDA y los muebles a la derecha.
    moverPanel(visor, izq);
    moverPanel(cg, der);
  } else if (nivel === 3) {
    // Mueble: la grilla interna pasa a la IZQUIERDA y la Bandeja de Carga Fina a la derecha.
    moverPanel(cg, izq);
    moverPanel(carga, der);
  } else {
    // Caja: la caja pasa a la IZQUIERDA y el listado fino de objetos a la derecha.
    moverPanel(cajaCanvas, izq);
    moverPanel(cajaObjetos, der);
  }

  actualizarCabeceras();
  renderMinimapa();
  syncBotones();
}

interface Cabecera {
  tituloIzq: string;
  tituloDer: string;
  descIzq: string;
  descDer: string;
}

const CABECERAS: Record<NivelPortales, Cabecera> = {
  0: {
    tituloIzq: '🏠 Mapa Estok',
    tituloDer: '🗺️ Plantas del Estok',
    descIzq: 'Navegación táctil: tocá una planta para desplegar el plano de sus habitaciones.',
    descDer: 'Vista general de las plantas del Estok activo. Seleccioná una planta para descender al nivel de habitaciones.',
  },
  1: {
    tituloIzq: '🏠 Plano de Habitaciones',
    tituloDer: '🚪 Habitaciones de la planta',
    descIzq: 'Plano de la planta activa. Tocá una habitación para entrar a su interior.',
    descDer: 'Habitaciones de la planta seleccionada. Elegí una para abrir su Visor en el nivel siguiente.',
  },
  2: {
    tituloIzq: '🧭 Visor de Habitación',
    tituloDer: '📦 Muebles Grandes y Objetos Sueltos',
    descIzq: 'Interior de la habitación activa. Tocá un mueble para entrar en su organización interna.',
    descDer: 'Muebles y archivadores de la habitación más los objetos sueltos. Clic en un mueble para abrir sus estanterías.',
  },
  3: {
    tituloIzq: '🧰 Organización Interna del Mueble',
    tituloDer: '🧺 Estanterías y Cajoneras',
    descIzq: 'Grilla interna del mueble activo. Tocá una caja o estante para inspeccionar su contenido fino.',
    descDer: 'Carga fina del mueble activo: cajas internas y objetos sueltos listos para mudarlos a la grilla de la izquierda.',
  },
  4: {
    tituloIzq: '📦 Caja / Estante',
    tituloDer: '🔎 Listado Fino de Objetos',
    descIzq: 'Contenido interno de la caja seleccionada, con sus casilleros en formato de tiles.',
    descDer: 'Objetos de la caja activa con su ubicación exacta F·C. Usá «⬅ Volver de Nivel» para regresar.',
  },
};

function actualizarCabeceras(): void {
  const cab = CABECERAS[estado.nivel];
  const tituloIzq = el('tituloPanelIzquierdo');
  const tituloDer = el('tituloPanelDerecho');
  const descIzq = el('descPanelIzquierdo');
  const descDer = el('descPanelDerecho');
  if (tituloIzq) tituloIzq.textContent = cab.tituloIzq;
  if (tituloDer) tituloDer.textContent = cab.tituloDer;
  if (descIzq) descIzq.textContent = cab.descIzq;
  if (descDer) descDer.textContent = cab.descDer;
  const badge = el('mapaJerarquicoBadge');
  if (badge) {
    badge.classList.toggle('hidden', estado.nivel >= 2);
    if (estado.nivel <= 1) badge.textContent = `Nivel ${estado.nivel}`;
  }
}

/** Habilita/oculta los botones de navegación según el nivel activo. */
function syncBotones(): void {
  const enRaiz = estado.nivel === 0;
  el('btnOrganizarEscena4')?.classList.toggle('hidden', estado.nivel !== 2);
  el('btnVolverEscena')?.classList.toggle('hidden', enRaiz);
  el('btnVolverNivel')?.classList.toggle('hidden', enRaiz);
}


// -----------------------------------------------------------------------------
// RED DE MINIMAPAS ANIDADOS (cima del panel derecho)
// -----------------------------------------------------------------------------

function renderMinimapa(): void {
  const cont = el('minimapasAnidados');
  if (!cont) return;
  const nodos: NodoRuta[] = [];
  // Proporción real del lienzo en pantalla: el minimapa no deforma la geometría.
  const aspecto = aspectoDelLienzo();
  if (estado.nivel >= 1) {
    nodos.push({
      tipo: 'planta',
      nombre: estado.plantaNombre || `Planta ${estado.plantaFila ?? 1}`,
      filaActiva: estado.plantaFila,
      totalPlantas: estado.plantaTotal,
    });
  }
  if (estado.nivel >= 2 && estado.room) {
    nodos.push({
      tipo: 'habitacion',
      nombre: estado.room.nombre,
      filas: filasInternasDe(estado.room),
      columnasPorFila: columnasPorFilaDe(estado.room),
      // Sectores con las medidas REALES (ui_width/ui_height) de cada habitación.
      sectores: sectoresDeItems(estado.hermanasRoom, estado.room.id),
      aspecto,
    });
  }
  if (estado.nivel >= 3 && estado.mueble) {
    nodos.push({
      tipo: 'mueble',
      nombre: estado.mueble.nombre,
      filas: estado.muebleFilas,
      columnasPorFila: estado.muebleColumnas,
      // Sectores con las medidas REALES de cada mueble de la habitación.
      sectores: sectoresDeItems(estado.hermanosMueble, estado.mueble.id),
      aspecto,
    });
  }
  if (estado.nivel >= 4 && estado.caja) {
    nodos.push({
      tipo: 'caja',
      nombre: estado.caja.nombre,
      filas: estado.muebleFilas,
      columnasPorFila: estado.muebleColumnas,
      celdaFila: estado.caja.fila ?? null,
      celdaCol: estado.caja.col ?? null,
    });
  }
  cont.innerHTML = renderMinimapasAnidados(nodos);
  cont.classList.toggle('hidden', nodos.length === 0);
}

/**
 * Relación alto/ancho del lienzo elástico visible. Los minimapas de orientación
 * la usan para conservar las proporciones reales (un pasillo alargado no puede
 * dibujarse como un cuadrado). Cae al aspecto por defecto si no hay lienzo.
 */
function aspectoDelLienzo(): number {
  const lienzo = Array.from(document.querySelectorAll<HTMLElement>('[data-lienzo-pu]')).find(
    (candidato) => candidato.getBoundingClientRect().height > 0,
  );
  const rect = lienzo?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return ASPECTO_LIENZO;
  return Math.max(0.35, Math.min(1.8, rect.height / rect.width));
}

/** Carga la grilla del mueble (Contenedor) para el minimapa anidado del Nivel 3/4. */
async function cargarGrillaMueble(id: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${id}/`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const filas = Math.max(1, Math.floor(Number(data.grid_filas) || 1));
    const config: number[] | null = Array.isArray(data.grid_filas_config) ? data.grid_filas_config : null;
    const uniforme = Math.max(1, Math.floor(Number(data.grid_columnas) || 1));
    estado.muebleFilas = filas;
    estado.muebleColumnas = Array.from({ length: filas }, (_, i) =>
      config && Number(config[i]) > 0 ? Math.floor(Number(config[i])) : uniforme,
    );
    renderMinimapa();
  } catch {
    /* el minimapa conserva su última grilla conocida */
  }
}

// -----------------------------------------------------------------------------
// ACCIONES DE NAVEGACIÓN (portales + volver de nivel)
// -----------------------------------------------------------------------------

/** «⬅ Volver de Nivel»: desanda el camino de forma fluida, nivel por nivel. */
export function volverNivel(): void {
  if (estado.nivel === 4) {
    estado.caja = null;
    irANivel(3);
    return;
  }
  if (estado.nivel === 3) {
    irANivel(2);
    return;
  }
  if (estado.nivel === 2) {
    window.dispatchEvent(new CustomEvent('estok:habitacion-seleccionada', { detail: { room: null } }));
    return;
  }
  if (estado.nivel === 1) {
    document.querySelector<HTMLElement>('#mapaEstokPanel [data-casita-volver]')?.click();
  }
}

/**
 * PORTAL de Nivel 3 → Nivel 4: clic (en modo navegación) sobre una caja/estante
 * del mueble en la grilla izquierda. La pieza pasa a la izquierda y el listado
 * fino de objetos se carga en caliente a la derecha.
 */
function conectarPortalCaja(): void {
  const izq = slotIzq();
  if (!izq) return;
  izq.addEventListener('click', (ev) => {
    if (modoLienzoActual() !== 'navegacion' || estado.nivel !== 3) return;
    const objetivo = ev.target as HTMLElement | null;
    const carta = objetivo?.closest<HTMLElement>('[data-inplace-card][data-id]');
    if (!carta || !carta.closest('#visorContenedorGrande')) return;
    const id = carta.dataset.id ?? '';
    if (!id) return;
    const nombre =
      carta.querySelector<HTMLElement>('[data-inplace-renombrar]')?.textContent?.trim() || 'Caja / Estante';
    const detalle: CajaSeleccionada = { id, nombre, fila: null, col: null };
    estado.caja = detalle;
    irANivel(4);
    window.dispatchEvent(new CustomEvent('estok:caja-seleccionada', { detail: detalle }));
  });
}


// -----------------------------------------------------------------------------
// ENTRADA
// -----------------------------------------------------------------------------

export function iniciarPortalesAlmacenamiento(): void {
  // Nivel 0 → 1: la planta elegida en el Mapa Estok se vuelve el contexto activo.
  window.addEventListener('estok:planta-seleccionada', (e) => {
    const detalle = (e as CustomEvent<{ fila: number | null; nombre?: string | null; total?: number }>).detail;
    const fila = detalle?.fila ?? null;
    estado.plantaFila = fila;
    estado.plantaNombre = detalle?.nombre ?? '';
    estado.plantaTotal = Math.max(1, Math.floor(Number(detalle?.total) || estado.plantaTotal || 1));
    if (!fila) {
      // Vuelta a la casa: se limpia toda la descendencia.
      estado.room = null;
      estado.mueble = null;
      estado.caja = null;
      irANivel(0);
      return;
    }
    irANivel(1);
  });

  // Nivel 1 → 2: la habitación elegida pasa al panel izquierdo (Visor). El evento
  // trae las habitaciones HERMANAS con su geometría real (ui_width/ui_height)
  // para que el minimapa superior dibuje proporciones verdaderas.
  window.addEventListener('estok:habitacion-seleccionada', (e) => {
    const detalle = (e as CustomEvent<{ room: UbicacionPlano | null; hermanas?: ItemGeometria[] }>).detail;
    const room = detalle?.room ?? null;
    estado.room = room;
    estado.hermanasRoom = detalle?.hermanas ?? [];
    if (!room) {
      estado.mueble = null;
      estado.hermanosMueble = [];
      estado.caja = null;
      irANivel(estado.plantaFila ? 1 : 0);
      return;
    }
    irANivel(2);
  });

  // Nivel 2 → 3: el mueble elegido abre su organización interna (solo navegando).
  window.addEventListener('estok:mueble-seleccionado', (e) => {
    const detalle =
      (e as CustomEvent<{ id?: string | null; nombre?: string; hermanos?: ItemGeometria[] }>).detail ?? {};
    estado.hermanosMueble = detalle.hermanos ?? [];
    estado.mueble = detalle.id ? { id: detalle.id, nombre: detalle.nombre || 'Mueble' } : null;
    estado.caja = null;
    if (estado.mueble) void cargarGrillaMueble(estado.mueble.id);
    if (modoLienzoActual() === 'navegacion' && estado.nivel === 2 && estado.mueble) {
      irANivel(3);
    } else {
      renderMinimapa();
    }
  });

  // Vuelta desde el canvas del Nivel 4 (la caja dejó de estar activa).
  window.addEventListener('estok:caja-seleccionada', (e) => {
    const detalle = (e as CustomEvent<CajaSeleccionada | null>).detail ?? null;
    if (!detalle) {
      estado.caja = null;
      renderMinimapa();
    }
  });

  // Botones de navegación (izquierda y derecha + «Organizar Contenido»).
  el('btnVolverNivel')?.addEventListener('click', () => volverNivel());
  el('btnVolverEscena')?.addEventListener('click', () => volverNivel());
  el('btnOrganizarEscena4')?.addEventListener('click', () => irANivel(3));

  conectarPortalCaja();
  irANivel(0);
}

