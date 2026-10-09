// =============================================================================
// ANCLA Y NIVEL RAÍZ DE LOS PORTALES (plano del CONTENEDOR + minimapa ampliado)
// -----------------------------------------------------------------------------
// Resuelve la división (planta) activa del Estok, cachea las ubicaciones reales
// y pinta el MINI-MAPA AMPLIADO con las siluetas rotuladas de cada habitación.
//
// LEY DE ASIMETRÍA (Ignacio): el Panel Izquierdo SIEMPRE dibuja el plano del
// CONTENEDOR (el padre) con el nodo seleccionado entre sus hermanos; el sector
// resaltado viaja por identidad (`activoId`, naranja #f97316). La derecha nunca
// comparte nodo con la izquierda → se mata el espejo.
// =============================================================================

import { aspectoDelLienzo, el } from './domPortales';
import { estadoPortales } from './estadoPortales';
import type { NodoPortal } from './estadoPortales';
import { cargarPlantas, cargarUbicaciones, datosDeNivelPlanta } from './datosNodosPortales';
import type { PanelIzquierdo } from './panelesPortales';
import { listaHabitacionesHtml } from './tarjetasHabitaciones';
import type { UbicacionPlano } from '../../mapaJerarquico';

/** Caché local de ubicaciones del último nivel raíz resuelto. */
let cacheUbicacionesLocal: UbicacionPlano[] | null = null;

/** Ubicación real (habitación o planta) desde la caché del nivel raíz. */
export function roomDeCache(id: string): UbicacionPlano | null {
  return cacheUbicacionesLocal?.find((u) => String(u.id) === id) ?? null;
}

/** Id real de la división (planta) activa, resuelto por su fila del macro-plano. */
async function plantaIdActiva(): Promise<string | null> {
  const fila = estadoPortales.planta?.fila;
  if (!fila) return null;
  const plantas = await cargarPlantas();
  const div = plantas.find((p) => (p.parent_grid_row || 1) === fila);
  return div ? String(div.id) : null;
}

/**
 * Pinta el host de habitaciones (`listaHabitacionesPanel`): mini-mapa ampliado
 * de la planta con las siluetas rotuladas. `activoId` marca en NARANJA el cuarto
 * seleccionado (Ley 2: selección in-place sin mover el ancla).
 */
export async function renderNivelRaiz(activoId: string | null = null): Promise<void> {
  const plantaId = await plantaIdActiva();
  const datos = await datosDeNivelPlanta(plantaId);
  cacheUbicacionesLocal = await cargarUbicaciones();
  const host = el('listaHabitacionesPanel');
  if (host) {
    // MURIÓ EL TEXTO PLANO: la derecha/el ancla dibuja el polígono REAL de cada
    // habitación, rotulado con su nombre e icono semántico.
    host.innerHTML = listaHabitacionesHtml(
      datos.rooms,
      datos.espaciosPorRoom,
      aspectoDelLienzo(),
      datos.plant?.nombre ?? null,
      activoId,
    );
  }
}

/**
 * LEY 1 · Dibuja el PLANO DEL CONTENEDOR (padre) en el Panel Izquierdo. El nodo
 * seleccionado ya quedó como tope de la pila; su silueta se resalta aparte por
 * identidad (`resaltarSeleccionIzquierda`). No mueve la física de paneles.
 */
export async function pintarAncla(
  izquierdo: PanelIzquierdo,
  padre: NodoPortal | null,
  seleccionado: NodoPortal,
): Promise<void> {
  if (izquierdo === 'planoPlanta') return; // el mapa Estok ya está montado
  if (izquierdo === 'listaHabitaciones') {
    await renderNivelRaiz(seleccionado.id); // planta con el cuarto en naranja
    return;
  }
  if (izquierdo === 'visorHabitacion') {
    const room = padre ? roomDeCache(padre.id) : null;
    if (room) {
      window.dispatchEvent(
        new CustomEvent('estok:habitacion-seleccionada', { detail: { room } }),
      );
    }
    return;
  }
  if (izquierdo === 'grillaNodo' && padre) {
    window.dispatchEvent(
      new CustomEvent('estok:mueble-seleccionado', {
        detail: { id: padre.id, nombre: padre.nombre, hermanos: padre.hijos },
      }),
    );
  }
}
