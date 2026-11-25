// =============================================================================
// ANCLA DEL NIVEL SUPERIOR Y ESPERA DEL NIVEL RAÍZ (hosts separados por lado)
// -----------------------------------------------------------------------------
// LEY 1 (Ignacio): el Panel Izquierdo SIEMPRE dibuja el mapa del NIVEL SUPERIOR
// con el nodo seleccionado resaltado en NARANJA (#f97316). El Panel Derecho, en
// el nivel raíz, queda a la ESPERA (mini-mapas independientes por planta o las
// habitaciones de la planta elegida). Los hosts de ambos lados son DISTINTOS:
// así un mismo mapa jamás aparece en las dos columnas (se mata el espejo).
// =============================================================================

import { aspectoDelLienzo, el } from './domPortales';
import { estadoPortales } from './estadoPortales';
import type { NodoPortal } from './estadoPortales';
import { cargarPlantas, cargarUbicaciones, datosDeNivelPlanta } from './datosNodosPortales';
import { datosDePlantasIndependientes } from './datosPlantasEspera';
import { HOSTS } from './panelesPortales';
import type { PanelIzquierdo } from './panelesPortales';
import { listaHabitacionesHtml, listaPlantasHtml } from './tarjetasHabitaciones';
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
 * Id de la división raíz que oficia de PLANTA para el MINIMAPA del cuadrante
 * izquierdo (ancla del nivel superior).
 *
 *   · Con una planta fijada por fila → esa división raíz.
 *   · PLANTA ÚNICA (una sola división raíz y ninguna fila elegida) → esa única
 *     división ES la planta del minimapa. Sin este fallback el ancla quedaba
 *     vacía al entrar a una habitación de un Estok de una sola planta, cuando
 *     la regla exige SIEMPRE el gráfico de la planta con el cuarto en naranja.
 */
export async function plantaIdAncla(): Promise<string | null> {
  const fila = estadoPortales.planta?.fila ?? null;
  const plantas = await cargarPlantas();
  if (fila) {
    const div = plantas.find((p) => (p.parent_grid_row || 1) === fila);
    return div ? String(div.id) : null;
  }
  return plantas.length === 1 ? String(plantas[0].id) : null;
}

/** Dibuja el mapa de habitaciones de una planta en el host indicado. */
async function pintarHabitacionesEn(
  hostId: string,
  plantaId: string,
  activoId: string | null,
  zonasDeSuelta = false,
): Promise<void> {
  const host = el(hostId);
  if (!host) return;
  const datos = await datosDeNivelPlanta(plantaId);
  // El ancla (izquierda) y la espera (derecha) comparten el MISMO render puro,
  // pero viven en hosts DISTINTOS → nunca se clonan entre columnas.
  host.innerHTML = listaHabitacionesHtml(
    datos.rooms,
    datos.espaciosPorRoom,
    aspectoDelLienzo(),
    datos.plant?.nombre ?? null,
    activoId,
    zonasDeSuelta,
  );
}

/**
 * PANEL DERECHO EN ESPERA (nivel raíz, sin nodo activo).
 *   · Sin planta elegida → mini-mapas INDEPENDIENTES de cada planta del Estok.
 *   · Con planta elegida → habitaciones de ESA planta, a la espera de un cuarto.
 */
export async function renderNivelRaiz(): Promise<void> {
  cacheUbicacionesLocal = await cargarUbicaciones();
  const plantaId = await plantaIdActiva();
  if (!plantaId) {
    const host = el(HOSTS.plantasEnEspera);
    if (!host) return;
    const espera = await datosDePlantasIndependientes();
    host.innerHTML = listaPlantasHtml(
      espera.plantas,
      espera.habitacionesPorPlanta,
      espera.espaciosPorRoom,
      aspectoDelLienzo(),
    );
    return;
  }
  // CON PLANTA FIJADA el Panel Derecho es el EDITOR ELÁSTICO de habitaciones
  // («➕ Habitación», arrastre/fusión, «Espacio Único»): lo monta el orquestador
  // del Mapa Estok (mapaCasitaNavegable → montarEditorHabitacionesDerecha) en el
  // host `listaHabitacionesPanel`. La cascada sólo CONFIRMA que el host tenga
  // contenido y, si por cualquier motivo todavía está vacío, cae al mini-mapa de
  // lectura para que el panel NUNCA quede mudo.
  const hostDerecho = el(HOSTS.habitacionesEnEspera);
  if (hostDerecho && !hostDerecho.hasChildNodes()) {
    await pintarHabitacionesEn(HOSTS.habitacionesEnEspera, plantaId, null);
  }
}

/**
 * LEY 1 · ANCLA IZQUIERDA: dibuja el mapa del NIVEL SUPERIOR. El nodo activo se
 * resalta aparte por identidad (`resaltarSeleccionIzquierda`). NUNCA dibuja el
 * interior del activo → se mata el espejo entre ambos cuadrantes.
 *
 * Esta ancla NO se apaga jamás, tampoco en un ESPACIO FINAL: cuando el activo es
 * un Estante/Cajón/Caja, el cuadrante izquierdo sigue mostrando el plano del
 * padre (habitación o contenedor) con la pieza terminal en NARANJA.
 */
export async function pintarAncla(
  izquierdo: PanelIzquierdo,
  superior: NodoPortal | null,
  activo: NodoPortal,
): Promise<void> {
  if (izquierdo === 'planoPlanta') return; // el plano del Estok ya está montado
  cacheUbicacionesLocal = await cargarUbicaciones();

  if (izquierdo === 'plantaConHabitaciones') {
    const plantaId = await plantaIdAncla();
    // ANCLA IZQUIERDA: cada silueta del plano es además una DROPZONE receptora
    // del arrastre inter-cuadrantes (derecha → izquierda).
    if (plantaId) {
      await pintarHabitacionesEn(HOSTS.plantaConHabitaciones, plantaId, activo.id, true);
    }
    return;
  }
  if (izquierdo === 'visorHabitacion') {
    const room = superior ? roomDeCache(superior.id) : null;
    if (room) {
      // `esContextoAncla`: es un PINTADO del plano superior, no un gesto del
      // operador. El listener de la cascada lo ignora (no re-navega) y el Visor
      // de Habitación dibuja el cuarto con su ID REAL para resaltar al hijo.
      window.dispatchEvent(
        new CustomEvent('estok:habitacion-seleccionada', {
          detail: { room, esContextoAncla: true },
        }),
      );
    }
    return;
  }
  if (izquierdo === 'grillaNodo' && superior) {
    // El Visor Contenedor Grande dibuja la sub-grilla del SUPERIOR con el hijo
    // activo en naranja. Se publica como DESTAQUE (`estok:mueble-destacado`), NO
    // como una NAVEGACIÓN: reutilizar `estok:mueble-seleccionado` acá convertía el
    // id del padre en un descenso de nivel (el ancla terminaba abriendo el espacio
    // equivocado, siempre el mismo). El evento histórico se emite IGUAL pero
    // marcado `esContextoAncla` para los consumidores de lectura (bandeja de carga
    // fina), jamás para navegar.
    const detalle = { id: superior.id, nombre: superior.nombre, hermanos: superior.hijos, esContextoAncla: true };
    window.dispatchEvent(new CustomEvent('estok:mueble-destacado', { detail: detalle }));
    window.dispatchEvent(new CustomEvent('estok:mueble-seleccionado', { detail: detalle }));
  }
}
