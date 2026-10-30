// =============================================================================
// ACCIONES DE LA CAJA / CONTENEDOR ACTIVO (Panel Derecho de Almacenamiento)
// -----------------------------------------------------------------------------
// Cuando el operador inspecciona una caja («Caja 01») el Panel Derecho muestra su
// interior (ficha + objetos guardados) y, debajo, la canasta de objetos
// disponibles. Este módulo aporta la barra de acciones DESTACADA de ese nivel:
//
//   · 🔎 «Abrir ficha completa» → /contenedores/{id} con TODO el inventario.
//   · La ZONA DE SUELTA que recibe los objetos/cajas arrastrados de la canasta
//     para guardarlos DENTRO del contenedor abierto.
//
// MODELO HÍBRIDO UNIFICADO (sin botón): mover una caja fuera de su espacio ya
// NO necesita una acción dedicada — la caja se arrastra y se suelta sobre otro
// espacio o sobre «🧺 Elementos por ubicar / A reubicar / En tránsito», igual que
// cualquier objeto (lib/arrastreTarjetasLienzo.ts + bandejaSinUbicar.ts).
// El botón «🚚 Poner Caja En Tránsito» se retiró por redundante.
//
// Módulo de DOM puro: no dibuja planos ni duplica la cascada. La recepción del
// Drag & Drop delega en el motor de portales (transitoInterno.ts).
// =============================================================================

import { escapeHtml } from '../../mapaJerarquico';
import type { NodoPortal } from './estadoPortales';
// Recepción del Drag & Drop de la canasta: la persistencia (PUT con la relación
// jerárquica y casillero fino nulo) es EXACTAMENTE la del motor de portales —
// acá no se reimplementa ninguna regla, sólo se declara la zona de suelta.
import { guardarEnContenedor, leerCargaArrastrada } from './transitoInterno';

/**
 * Barra de acciones del contenedor activo (vacía para habitaciones).
 * Sólo queda la ficha completa: mover la caja se hace arrastrándola.
 */
export function barraAccionesCajaHtml(nodo: NodoPortal): string {
  if (nodo.tipo !== 'contenedor') return '';
  return `<div class="portal-caja-acciones">
    <a href="/contenedores/${escapeHtml(nodo.id)}"
      class="portal-caja-btn portal-caja-btn-ficha"
      title="Abrir la ficha completa de «${escapeHtml(nodo.nombre)}» con todo su inventario interno">
      🔎 Abrir ficha completa
    </a>
  </div>`;
}

/**
 * ZONA DE SUELTA de la caja abierta: el operador arrastra un objeto o una caja
 * desde la bandeja (Panel Derecho) y la suelta para guardarla DENTRO del nodo
 * activo. Sin celda fina: el backend decide «directo» o «En Tránsito Interno».
 */
export function zonaDropCajaHtml(nodo: NodoPortal): string {
  if (nodo.tipo !== 'contenedor') return '';
  return `<div class="portal-caja-drop"
    data-caja-drop="${escapeHtml(nodo.id)}"
    data-caja-drop-nombre="${escapeHtml(nodo.nombre)}"
    data-caja-drop-divisiones="${nodo.conDivisiones ? '1' : '0'}"
    title="Soltá acá un objeto o una caja de la bandeja para guardarlo dentro de «${escapeHtml(nodo.nombre)}»">
    ⬇ Soltá acá los objetos de la bandeja para guardarlos dentro de «${escapeHtml(nodo.nombre)}»
  </div>`;
}

/** Conecta la zona de suelta del contenedor activo con el motor de portales. */
export function conectarDropCaja(host: HTMLElement, nodo: NodoPortal): void {
  const zona = host.querySelector<HTMLElement>('[data-caja-drop]');
  if (!zona) return;
  const limpiar = (): void => zona.classList.remove('portal-caja-drop-activo');
  zona.addEventListener('dragover', (ev) => {
    const de = ev as DragEvent;
    de.preventDefault();
    if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
    zona.classList.add('portal-caja-drop-activo');
  });
  zona.addEventListener('dragleave', limpiar);
  zona.addEventListener('drop', (ev) => {
    const de = ev as DragEvent;
    limpiar();
    if (de.defaultPrevented) return;
    const carga = leerCargaArrastrada(de);
    if (!carga) return;
    // Se aísla el evento: ningún otro handler del panel debe guardar dos veces.
    de.preventDefault();
    de.stopPropagation();
    void guardarEnContenedor(carga, {
      contenedorId: nodo.id,
      nombre: nodo.nombre,
      tieneDivisiones: nodo.conDivisiones,
      fila: null,
      col: null,
    });
  });
}

/**
 * Conecta la barra de acciones del contenedor activo (hoy sólo la zona de
 * suelta). Idempotente por render: el host se reescribe por innerHTML en cada
 * nivel, así que los listeners viejos desaparecen con sus nodos.
 */
export function conectarAccionesCaja(host: HTMLElement, nodo: NodoPortal): void {
  conectarDropCaja(host, nodo);
}
