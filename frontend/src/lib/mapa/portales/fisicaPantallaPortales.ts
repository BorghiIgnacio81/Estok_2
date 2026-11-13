// =============================================================================
// FÍSICA DE PANTALLA DEL NIVEL (hosts, columnas y canastas)
// -----------------------------------------------------------------------------
// Aplica al DOM la decisión PURA de `panelesPortales.ts`:
//   · enciende/apaga los hosts de la cascada y los mueve a su columna,
//   · en un ESPACIO FINAL oculta la COLUMNA IZQUIERDA (sin lienzo/mapa 2D),
//     deja el Panel de Contenido a todo el ancho y traslada la tira de
//     minimapas al panel derecho,
//   · gobierna la canasta del cuadrante derecho y la del contenedor activo.
//
// Sin estado propio: todo se resuelve con el estado vigente de la cascada.
// =============================================================================

import { refrescarBandeja } from '../../bandejaSinUbicar';
import { nodoActual } from './estadoPortales';
import { el, moverPanel, slotDer, slotIzq } from './domPortales';
import { hostsDe, TODOS_LOS_HOSTS } from './panelesPortales';
import type { Paneles } from './panelesPortales';

/** Aplica la física de pantalla completa del nivel recién resuelto. */
export function aplicarFisicaDePaneles(paneles: Paneles): void {
  // ESPACIO FINAL: el lienzo/mapa 2D tradicional queda DESACTIVADO y la columna
  // izquierda OCULTA; el Panel de Contenido ocupa todo el ancho disponible.
  const enEspacioFinal = paneles.izquierdo === 'oculto';
  document.documentElement.classList.toggle('portales-espacio-final', enEspacioFinal);
  el('panelIzquierdoCol')?.classList.toggle('hidden', enEspacioFinal);
  for (const id of TODOS_LOS_HOSTS) el(id)?.classList.add('hidden');
  const [idIzq, idDer] = hostsDe(paneles);
  moverPanel(el(idIzq), slotIzq());
  moverPanel(el(idDer), slotDer());
  // TIRA DE MINIMAPAS: en un Espacio Final la izquierda no existe, así que el
  // breadcrumb navegable viaja a la cima del Panel de Contenido (mismo host, no
  // se duplica el componente).
  const tira = el('minimapasAnidados');
  const destinoTira = enEspacioFinal ? slotDer() : slotIzq();
  if (tira && destinoTira && tira.parentElement !== destinoTira) {
    destinoTira.insertBefore(tira, destinoTira.firstChild);
  }
  aplicarCanastas(paneles);
}

/**
 * LEY 4 · LA CANASTA NUNCA SE APAGA EN EL NIVEL TERMINAL (Lote 29): en el Espacio
 * Final la canasta es la FUENTE del arrastre hacia el Panel de Contenido. Se
 * repinta de forma EXPLÍCITA (llamado directo, sin el latido global que
 * re-dispara el motor) y se INTEGRA al cuadrante derecho (Lote 31) para que haya
 * UNA sola canasta en pantalla. La canasta de la caja abierta se apaga en el
 * nivel terminal (ya está la del cuadrante) y en las habitaciones.
 */
function aplicarCanastas(paneles: Paneles): void {
  document.body.classList.remove('portales-canasta-oculta');
  if (paneles.derecho === 'contenidoFinal') refrescarBandeja();
  document.documentElement.classList.toggle(
    'portales-canasta-cuadrante',
    paneles.derecho === 'contenidoFinal',
  );
  // El host de la canasta del cuadrante se mantiene SIEMPRE último: los hosts de
  // portales se reinsertan con `appendChild` en cada nivel (moverPanel).
  const hostCanastaCuadrante = el('canastaCuadranteDerecho');
  if (hostCanastaCuadrante) slotDer()?.appendChild(hostCanastaCuadrante);
  // CANASTA DEL CONTENEDOR ACTIVO: sólo para CONTENEDORES modelables (la ficha
  // de la caja abierta). Las habitaciones no tienen ficha de caja.
  const nodoDelNivel = nodoActual();
  const mostrarCanastaCaja = Boolean(
    nodoDelNivel && nodoDelNivel.tipo === 'contenedor' && paneles.derecho === 'listaContenedores',
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
