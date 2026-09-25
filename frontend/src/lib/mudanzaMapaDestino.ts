// =============================================================================
// MAPA DE MINIMAPAS INTERACTIVOS DEL ESTOK DESTINO (orquestación de vista)
// -----------------------------------------------------------------------------
// Reemplaza el viejo árbol de texto de la columna derecha de Mudanza: el
// usuario VE el plano REAL del Estok destino y suelta el ítem arrastrado sobre
// la silueta de la habitación (suelta GRUESA), del mueble / estante / caja
// (suelta FINA) o sobre la zona estática «En Tránsito».
//
// Responsabilidades (dependencia en UNA sola dirección, sin ciclos):
//   · mudanzaMapaDestinoRender.ts → dibujo puro (siluetas, chips, lienzo).
//   · ESTE módulo                 → estado de navegación (planta / nivel /
//                                   habitación) + API pública del mapa.
//   · mudanzaDnd.ts               → arrastre y suelta (data-drop-*).
//   · mudanzaBoard.ts             → orquestación y POST transaccional.
//
// La migaja de procedencia se pinta en el componente global
// components/MinimapaRuta.astro (host que inyecta mudanza.astro).
// =============================================================================

import { ASPECTO_LIENZO } from './minimapa';
import { renderMinimapasAnidados } from './minimapasAnidados';
import type { NodoRuta } from './minimapasAnidados';
import { sectoresDeItems } from './sectoresMinimapa';
import { iconoDeHabitacion } from './planoHabitaciones';
import {
  PISO_DEFECTO,
  habitacionesDePlanta,
  htmlNivelHabitaciones,
  htmlNivelMuebles,
  htmlPlantaSelector,
  plantasDe,
} from './mudanzaMapaDestinoRender';
import { habitacionesDe, htmlVacio } from './mudanzaInventario';
import type { ContenedorDto, UbicacionDto } from './mudanzaApi';
import type { FiltroDestino } from './mudanzaFiltros';

// El contador de la barra de filtros vive junto al resto de las derivaciones
// espaciales del mapa (misma fuente de verdad que el dibujo).
export { contarDestino } from './mudanzaMapaDestinoRender';

// =============================================================================
// ESTADO DE VISTA (planta / nivel / habitación abierta)
// =============================================================================

type NivelDestino = 'HABITACIONES' | 'MUEBLES';

interface VistaDestino {
  /** Planta visible (valor del campo `piso`). */
  planta: string;
  /** Nivel dibujado: plano de la planta o interior de una habitación. */
  nivel: NivelDestino;
  /** Habitación abierta (sólo en el nivel MUEBLES). */
  habitacionId: string | null;
}

const vistaDestino: VistaDestino = {
  planta: PISO_DEFECTO,
  nivel: 'HABITACIONES',
  habitacionId: null,
};

/** Vuelve al plano general de la planta. */
function volverAlPlano(): void {
  vistaDestino.nivel = 'HABITACIONES';
  vistaDestino.habitacionId = null;
}

/** Reinicia el mapa (cambio de Estok destino o intercambio Origen ⇄ Destino). */
export function reiniciarVistaDestino(): void {
  vistaDestino.planta = PISO_DEFECTO;
  volverAlPlano();
}

/** Habitación abierta en el nivel MUEBLES (null si la vista dejó de ser válida). */
function habitacionDeVista(ubicaciones: UbicacionDto[]): UbicacionDto | null {
  if (!vistaDestino.habitacionId) return null;
  return ubicaciones.find((u) => String(u.id) === String(vistaDestino.habitacionId)) || null;
}

/**
 * Sincroniza la vista con los datos recién cargados: si la planta o la
 * habitación guardada ya no existen (cambio de Estok destino), vuelve al plano
 * general. Se llama en cada render, así nunca queda un nivel vacío.
 */
function ajustarVistaDestino(ubicaciones: UbicacionDto[]): void {
  const plantas = plantasDe(ubicaciones);
  if (!plantas.length) {
    volverAlPlano();
    return;
  }
  if (!plantas.includes(vistaDestino.planta)) {
    vistaDestino.planta = plantas[0];
    volverAlPlano();
    return;
  }
  if (vistaDestino.nivel === 'MUEBLES' && !habitacionDeVista(ubicaciones)) volverAlPlano();
}

// =============================================================================
// API PÚBLICA (la consume mudanzaBoard.ts)
// =============================================================================

/** HTML completo del mapa del Estok destino para el nivel vigente. */
export function htmlMapaDestino(
  ubicaciones: UbicacionDto[],
  contenedores: ContenedorDto[],
  filtros: Set<FiltroDestino>,
): string {
  if (!habitacionesDe(ubicaciones).length) {
    return htmlVacio(
      'El Estok destino todavía no tiene habitaciones',
      'Modelá el plano desde «Mapa de Estok» en Almacenamiento para habilitar las zonas de suelta.',
    );
  }
  ajustarVistaDestino(ubicaciones);

  const habitacion = habitacionDeVista(ubicaciones);
  const cuerpo =
    vistaDestino.nivel === 'MUEBLES' && habitacion
      ? htmlNivelMuebles(habitacion, contenedores, filtros)
      : htmlNivelHabitaciones(ubicaciones, contenedores, vistaDestino.planta, filtros);
  const selector =
    vistaDestino.nivel === 'HABITACIONES'
      ? htmlPlantaSelector(ubicaciones, vistaDestino.planta)
      : '';
  return `${selector}${cuerpo}`;
}

/**
 * Rellena en caliente el componente global MinimapaRuta.astro (host inyectado
 * por mudanza.astro) con la migaja de procedencia del destino:
 * 🏠 Estok (planta activa) → 🚪 habitación abierta (sector en naranja).
 */
export function pintarRutaDestino(
  host: HTMLElement | null,
  nombreEstok: string,
  ubicaciones: UbicacionDto[],
): void {
  if (!host) return;
  const plantas = plantasDe(ubicaciones);
  const fila = Math.max(1, plantas.indexOf(vistaDestino.planta) + 1);
  const nodos: NodoRuta[] = [
    {
      tipo: 'estok',
      nombre: nombreEstok || 'Estok destino',
      filaActiva: fila,
      totalPlantas: Math.max(1, plantas.length),
    },
  ];

  const habitacion = habitacionDeVista(ubicaciones);
  if (habitacion) {
    const hermanas = habitacionesDePlanta(ubicaciones, vistaDestino.planta);
    nodos.push({
      tipo: 'habitacion',
      nombre: habitacion.nombre || 'Habitación',
      id: String(habitacion.id),
      sectores: sectoresDeItems(hermanas, String(habitacion.id), (h) =>
        iconoDeHabitacion(String(h.nombre || '')),
      ),
      aspecto: ASPECTO_LIENZO,
    });
  }

  host.innerHTML = renderMinimapasAnidados(nodos, {
    activoId: habitacion ? String(habitacion.id) : null,
  });
}

/** Abre el interior de una habitación (suelta fina sobre sus muebles). */
function entrarEnHabitacion(habitacionId: string): boolean {
  if (!habitacionId) return false;
  const yaAbierta =
    vistaDestino.nivel === 'MUEBLES' &&
    String(vistaDestino.habitacionId) === String(habitacionId);
  if (yaAbierta) return false;
  vistaDestino.nivel = 'MUEBLES';
  vistaDestino.habitacionId = habitacionId;
  return true;
}

/**
 * Interpreta la navegación del mapa desde los data-attributes del elemento
 * tocado (plantas, ambientes, volver). Devuelve true si hay que repintar.
 */
function manejarNavegacionDestino(el: HTMLElement | null): boolean {
  if (!el) return false;

  const planta = el.dataset.navegarPlanta;
  if (planta) {
    vistaDestino.planta = planta;
    volverAlPlano();
    return true;
  }

  const habitacion = el.dataset.navegarUbicacion;
  if (habitacion) return entrarEnHabitacion(habitacion);

  if (el.hasAttribute('data-navegar-volver')) {
    volverAlPlano();
    return true;
  }
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
 * Resuelve el clic sobre el panel del mapa del Destino:
 *   1. Botones `data-navegar-*` (planta, ambiente, volver) → cambian de nivel.
 *   2. Toque sobre la SILUETA de una habitación SIN tarjeta elegida → entra a
 *      ver sus muebles. Con una tarjeta elegida por toque, el clic es una
 *      SUELTA y la resuelve el motor de arrastre (acá no se navega).
 *
 * El tablero lo registra en FASE DE CAPTURA para resolver antes del motor DnD.
 */
export function resolverClickMapaDestino(e: MouseEvent, opts: NavegacionDestinoOpts): void {
  const objetivo = e.target as HTMLElement | null;
  const accion = objetivo?.closest(
    '[data-navegar-planta], [data-navegar-ubicacion], [data-navegar-volver]',
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
