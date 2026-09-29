// =============================================================================
// MAPA DE MINIMAPAS JERÁRQUICOS DEL ESTOK DESTINO (navegación elástica)
// -----------------------------------------------------------------------------
// La columna derecha de Mudanza es una JERARQUÍA DE TRES NIVELES que se recorre
// hacia adentro y se desarma hacia afuera con UNA sola pila de estado:
//
//   Nivel 0 · ESTOK ENTERO → la casa completa (casita canónica del motor). Es el
//                            ÚNICO nivel en el que la casa grande vive en el
//                            cuerpo central del panel.
//   Nivel 1 · PISO ELEGIDO → el cuerpo central dibuja el plano REAL de la planta
//                            (siluetas asimétricas de sus habitaciones = zonas de
//                            suelta GRUESA) mientras la casa macro sube al
//                            cabezal de contexto como miniatura (miga de pan).
//   Nivel 2 · MUEBLES      → plano REAL de la habitación (suelta FINA).
//
// Al avanzar, cada plano abandonado SE ENCOGE (escala canónica 4× menor del
// motor) y se apila en el cabezal de contexto: la red de minimapas compactados de
// `nodosCascadaDestino` (mudanzaDestinoNiveles.ts). El botón «⬅ Volver» retrocede
// EXACTAMENTE un nivel y cada minimapa compactado del cabezal salta a SU nivel
// (guía de contexto activa).
//
// Responsabilidades (dependencia en UNA sola dirección, sin ciclos):
//   · mudanzaMapaDestinoRender.ts → dibujo puro del plano real (habitaciones,
//                                   muebles y estantes).
//   · mudanzaDestinoNiveles.ts    → Nivel 0 + Nivel 1 + cabezal de contexto.
//   · ESTE módulo                 → pila de navegación + API pública del mapa.
//   · mudanzaDnd.ts               → arrastre y suelta (data-drop-*).
//   · mudanzaBoard.ts             → orquestación y POST transaccional.
//
// El plano del nivel vigente y el cabezal se pintan con el COMPONENTE GLOBAL
// components/MinimapaRuta.astro (hosts que inyecta mudanza.astro).
// =============================================================================

import { htmlNivelMuebles, plantasDe } from './mudanzaMapaDestinoRender';
import type { NivelMapaDestino } from './mudanzaMapaDestinoRender';
import {
  htmlCascadaDestino,
  htmlNivelEstok,
  htmlNivelPlantas,
  nodosCascadaDestino,
  pasoInicialDestino,
} from './mudanzaDestinoNiveles';
import type { PasoDestino } from './mudanzaDestinoNiveles';
import { habitacionesDe, htmlVacio } from './mudanzaInventario';
import type { ContenedorDto, UbicacionDto } from './mudanzaApi';
import type { FiltroDestino } from './mudanzaFiltros';

// El contador de la barra de filtros vive junto al resto de las derivaciones
// espaciales del mapa (misma fuente de verdad que el dibujo).
export { contarDestino } from './mudanzaMapaDestinoRender';

// =============================================================================
// ESTADO DE NAVEGACIÓN (pila de niveles visitados)
// =============================================================================

/** Pasos visitados: el ÚLTIMO es el nivel vigente y se dibuja en grande. */
const pilaDestino: PasoDestino[] = [pasoInicialDestino()];

/** Nivel vigente (tope de la pila). */
function pasoActual(): PasoDestino {
  return pilaDestino[pilaDestino.length - 1];
}

/** Recorta la pila dejando vivo el paso `indice` (retroceso de niveles). */
function recortarPila(indice: number): boolean {
  if (!Number.isFinite(indice) || indice < 0 || indice >= pilaDestino.length - 1) return false;
  pilaDestino.length = Math.floor(indice) + 1;
  return true;
}

/** Reinicia la jerarquía en el Nivel 0 (cambio de Estok o intercambio). */
export function reiniciarVistaDestino(): void {
  pilaDestino.length = 0;
  pilaDestino.push(pasoInicialDestino());
}

/**
 * Retrocede EXACTAMENTE un nivel (botón «⬅ Volver»): de la vista interna de la
 * habitación vuelve al plano completo de la planta, y así hacia arriba.
 */
export function volverNivelDestino(): boolean {
  return recortarPila(pilaDestino.length - 2);
}

/** Salta al nivel de un minimapa compactado del cabezal de contexto. */
export function volverANivelDestino(indice: number): boolean {
  return recortarPila(indice);
}

/**
 * Sincroniza la pila con los datos recién cargados: si la planta o la
 * habitación del nivel vigente ya no existen (cambio de Estok destino), la
 * jerarquía se desarma sola hasta el último nivel válido. Corre en cada render,
 * así nunca queda un nivel vacío.
 */
function ajustarVistaDestino(ubicaciones: UbicacionDto[]): void {
  const plantas = plantasDe(ubicaciones);
  if (!plantas.length) {
    reiniciarVistaDestino();
    return;
  }
  // La planta de REFERENCIA del recorrido debe existir: si el Estok cambió de
  // modelo, el punto de partida se re-ancla en su primera planta real para que
  // el Nivel 1 resalte el chip correcto desde el primer render.
  if (!plantas.includes(pasoActual().planta)) {
    reiniciarVistaDestino();
    pilaDestino[0].planta = plantas[0];
    return;
  }
  const abierta = pasoActual().habitacionId;
  if (abierta && !habitacionesDe(ubicaciones).some((u) => String(u.id) === String(abierta))) {
    volverNivelDestino(); // la habitación abierta desapareció: vuelve a su planta
  }
}

// =============================================================================
// TRANSICIONES DE NIVEL
// =============================================================================

/** Nivel 0 → Nivel 1: abre el plano REAL de la planta de referencia. */
function entrarEnPlantas(): boolean {
  const actual = pasoActual();
  if (actual.nivel !== 'ESTOK') return false;
  pilaDestino.push({ nivel: 'PLANTAS', planta: actual.planta, habitacionId: null });
  return true;
}

/**
 * Nivel 1 → elige el piso. Con el piso YA abierto, el chip CAMBIA la planta EN
 * SITIO: no se apila un nivel intermedio idéntico (era la causa de los planos
 * repetidos en cascada vertical). Desde el Nivel 0 abre el piso elegido.
 */
function entrarEnPlanta(planta: string): boolean {
  if (!planta) return false;
  const actual = pasoActual();
  if (actual.nivel === 'PLANTAS') {
    if (actual.planta === planta) return false; // ese piso ya está abierto
    actual.planta = planta;
    actual.habitacionId = null;
    return true;
  }
  pilaDestino.push({ nivel: 'PLANTAS', planta, habitacionId: null });
  return true;
}

/** Nivel 1 → Nivel 2: abre el interior de la habitación (suelta fina). */
function entrarEnHabitacion(habitacionId: string): boolean {
  if (!habitacionId) return false;
  const actual = pasoActual();
  if (actual.nivel === 'MUEBLES' && String(actual.habitacionId) === String(habitacionId)) {
    return false; // ya está abierta: el toque es una suelta, no una navegación
  }
  pilaDestino.push({ nivel: 'MUEBLES', planta: actual.planta, habitacionId });
  return true;
}

// =============================================================================
// API PÚBLICA (la consume mudanzaBoard.ts)
// =============================================================================

/** Plano + chrome del nivel vigente y el cabezal de contexto del Estok destino. */
export interface VistaMapaDestino {
  /** SVG del plano: se inyecta DENTRO del host del componente global. */
  plano: string;
  /** Cabecera, avisos y chips del nivel vigente (hermanos del plano). */
  detalle: string;
  /** Red de minimapas COMPACTADOS de los niveles previos (cabezal). */
  cascada: string;
  /** ¿Hay niveles por encima del vigente? (muestra/oculta «⬅ Volver»). */
  hayVolver: boolean;
  /** El plano vigente es la silueta macro de la casa (sólo el Nivel 0). */
  casita: boolean;
}

/** Plano y chrome del nivel VIGENTE de la jerarquía del Estok destino. */
function renderNivelVigente(
  nombreEstok: string,
  ubicaciones: UbicacionDto[],
  contenedores: ContenedorDto[],
  filtros: Set<FiltroDestino>,
): NivelMapaDestino {
  const paso = pasoActual();
  if (paso.nivel === 'ESTOK') return htmlNivelEstok(nombreEstok, ubicaciones);
  if (paso.nivel === 'MUEBLES') {
    const abierta = habitacionesDe(ubicaciones).find(
      (u) => String(u.id) === String(paso.habitacionId),
    );
    if (abierta) return htmlNivelMuebles(abierta, contenedores, filtros);
  }
  // Nivel 1 «piso elegido» (y defensa si el ambiente abierto ya no existe): el
  // cuerpo central queda para el plano REAL de la planta; la casa macro vive
  // únicamente en el cabezal de contexto como miniatura.
  return htmlNivelPlantas(ubicaciones, contenedores, paso.planta, filtros);
}

/** Nivel vigente (plano grande) + cabezal de contexto + botón «⬅ Volver». */
export function htmlMapaDestino(
  ubicaciones: UbicacionDto[],
  contenedores: ContenedorDto[],
  filtros: Set<FiltroDestino>,
  nombreEstok: string,
): VistaMapaDestino {
  if (!habitacionesDe(ubicaciones).length) {
    return {
      plano: '',
      detalle: htmlVacio(
        'El Estok destino todavía no tiene habitaciones',
        'Modelá el plano desde «Mapa de Estok» en Almacenamiento para habilitar las zonas de suelta.',
      ),
      cascada: '',
      hayVolver: false,
      casita: false,
    };
  }
  ajustarVistaDestino(ubicaciones);

  const nivel = renderNivelVigente(nombreEstok, ubicaciones, contenedores, filtros);
  return {
    plano: nivel.plano,
    detalle: `<div class="mudanza-mapa">${nivel.detalle}</div>`,
    cascada: htmlCascadaDestino(nodosCascadaDestino(pilaDestino, nombreEstok, ubicaciones)),
    hayVolver: pilaDestino.length > 1,
    casita: Boolean(nivel.casita),
  };
}

/**
 * Vuelca el cabezal de contexto en el host del COMPONENTE GLOBAL (host inyectado
 * por mudanza.astro): la red de minimapas compactados de los niveles previos,
 * que se achican al avanzar, y el «⬅ Volver» visible sólo si hay niveles por
 * encima del vigente.
 *
 * Cada minimapa compactado es una guía de contexto ACTIVA: queda navegable
 * (`data-navegar-nivel` = índice de la pila) para saltar a ESE nivel.
 */
export function pintarCascadaDestino(
  host: HTMLElement | null,
  cascada: string,
  hayVolver: boolean,
  volver: HTMLElement | null,
): void {
  if (!host) return;
  host.innerHTML = cascada;
  host.classList.toggle('hidden', !cascada);
  volver?.classList.toggle('hidden', !hayVolver);
  // El motor global no conoce la pila: la pantalla marca cada miniatura con su
  // índice (el orden del DOM es el orden de profundidad de la jerarquía).
  host.querySelectorAll<HTMLElement>('.mini-anidado').forEach((nodo, i) => {
    nodo.dataset.navegarNivel = String(i);
    nodo.setAttribute('role', 'button');
    nodo.setAttribute('tabindex', '0');
  });
}

/**
 * Interpreta la navegación desde los data-attributes del elemento tocado
 * (Estok entero, plantas, ambientes, minimapas del cabezal, volver).
 * Devuelve true si hay que repintar.
 */
function manejarNavegacionDestino(el: HTMLElement | null): boolean {
  if (!el) return false;

  // Cabezal de contexto: salto directo al nivel de ese minimapa compactado.
  const nivel = el.dataset.navegarNivel;
  if (nivel != null) return volverANivelDestino(Number(nivel));

  const planta = el.dataset.navegarPlanta;
  if (planta) return entrarEnPlanta(planta);

  const habitacion = el.dataset.navegarUbicacion;
  if (habitacion) return entrarEnHabitacion(habitacion);

  // Nivel 0 «Estok entero»: la casa se abre en sus plantas.
  if (el.hasAttribute('data-navegar-estok')) return entrarEnPlantas();

  // «⬅ Volver»: retrocede EXACTAMENTE un nivel de la jerarquía.
  if (el.hasAttribute('data-navegar-volver')) return volverNivelDestino();

  return false;
}

// =============================================================================
// RESOLUCIÓN DEL CLIC EN EL MAPA (navegación vs. suelta por toque)
// =============================================================================

export interface NavegacionDestinoOpts {
  /** ¿Hay una tarjeta elegida por toque? (la suelta la resuelve mudanzaDnd). */
  haySeleccion: () => boolean;
  /** Limpia la selección por toque (el DOM del panel se reemplaza). */
  limpiarSeleccion: () => void;
  /** Repinta el tablero tras un cambio de nivel. */
  repintar: () => void;
}

/**
 * Resuelve el clic sobre el mapa del Destino (panel del plano y cabezal de
 * contexto en cascada):
 *   1. Botones `data-navegar-*` (Estok entero, planta, ambiente, minimapa del
 *      cabezal y «⬅ Volver») → cambian de nivel en la jerarquía.
 *   2. Toque sobre la SILUETA de una habitación SIN tarjeta elegida → entra a
 *      ver sus muebles. Con una tarjeta elegida por toque, el clic es una
 *      SUELTA y la resuelve el motor de arrastre (acá no se navega).
 *
 * El tablero lo registra en FASE DE CAPTURA para resolver antes del motor DnD.
 */
export function resolverClickMapaDestino(e: MouseEvent, opts: NavegacionDestinoOpts): void {
  const objetivo = e.target as HTMLElement | null;
  const accion = objetivo?.closest(
    '[data-navegar-estok], [data-navegar-planta], [data-navegar-ubicacion], [data-navegar-nivel], [data-navegar-volver]',
  ) as HTMLElement | null;
  if (accion) {
    opts.limpiarSeleccion();
    if (manejarNavegacionDestino(accion)) opts.repintar();
    return;
  }
  if (opts.haySeleccion()) return; // el toque es una suelta en curso
  const silueta = objetivo?.closest('[data-drop-ubicacion]') as HTMLElement | null;
  const habitacionId = silueta?.dataset.dropUbicacion;
  if (habitacionId && entrarEnHabitacion(habitacionId)) opts.repintar();
}
