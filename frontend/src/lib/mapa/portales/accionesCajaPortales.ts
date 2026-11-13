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
// Payload EXPLÍCITO del arrastre (id real + tipo_entidad): única fuente del
// contrato, compartida por canastas, lienzos y panel de contenido.
import { publicarArrastre } from '../../arrastreEntidad';
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

/**
 * Destino de una zona de suelta: la caja ACTIVA o una de las piezas del
 * selector de cajas del nivel (`contenidoInternoNodo.selectorPiezasHtml`).
 */
interface DestinoCaja {
  contenedorId: string;
  nombre: string;
  tieneDivisiones: boolean;
}

/**
 * Conecta UNA zona de suelta con el motor de portales.
 *
 * FUENTE ÚNICA del handler de Drop: la usan la zona destacada de la caja
 * abierta y cada fila del selector de piezas, sin duplicar la persistencia
 * (`guardarEnContenedor` decide «guardado directo» o «En Tránsito Interno»).
 */
function conectarZonaDrop(zona: HTMLElement, destino: DestinoCaja): void {
  const limpiar = (): void => zona.classList.remove('portal-caja-drop-activo');
  zona.addEventListener('dragover', (ev) => {
    const de = ev as DragEvent;
    de.preventDefault();
    // AISLAMIENTO DE RECEPTORES ANIDADOS: la tarjeta de una caja vive DENTRO de
    // la zona de suelta del contenedor padre; sin este freno, arrastrar sobre la
    // tarjeta resaltaría también el área general y el Drop podría duplicarse.
    de.stopPropagation();
    if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
    zona.classList.add('portal-caja-drop-activo');
  });
  zona.addEventListener('dragleave', (ev) => {
    const de = ev as DragEvent;
    // Cambio entre hijos de la MISMA zona: no se apaga el realce.
    if (de.relatedTarget && zona.contains(de.relatedTarget as Node)) return;
    ev.stopPropagation();
    limpiar();
  });
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
      contenedorId: destino.contenedorId,
      nombre: destino.nombre,
      tieneDivisiones: destino.tieneDivisiones,
      fila: null,
      col: null,
      // ASIGNACIÓN EXPLÍCITA: el operador soltó el elemento sobre el área o la
      // tarjeta de ESTE contenedor; el PUT viaja con `en_transito_interno=false`
      // y la pieza sale del limbo «En Tránsito» en la misma transacción.
      enTransito: false,
    });
  });
}

/** Conecta la zona de suelta del contenedor activo con el motor de portales. */
export function conectarDropCaja(host: HTMLElement, nodo: NodoPortal): void {
  const zona = host.querySelector<HTMLElement>('[data-caja-drop]');
  if (!zona) return;
  conectarZonaDrop(zona, {
    contenedorId: nodo.id,
    nombre: nodo.nombre,
    tieneDivisiones: nodo.conDivisiones,
  });
}

/**
 * Conecta CADA fila del selector de cajas como zona de suelta de su PROPIA
 * caja: arrastrar un objeto (o una caja) de la bandeja y soltarlo sobre «Caja
 * 03» lo guarda DENTRO de «Caja 03» sin tener que abrirla primero. La
 * persistencia es la misma del motor de portales: acá sólo se declara el
 * destino de cada fila.
 */
export function conectarDropPiezasCaja(host: HTMLElement): void {
  host.querySelectorAll<HTMLElement>('[data-caja-drop-pieza]').forEach((zona) => {
    const id = zona.dataset.cajaDropPieza ?? '';
    if (!id) return;
    conectarZonaDrop(zona, {
      contenedorId: id,
      nombre: zona.dataset.cajaDropNombre || 'la caja',
      tieneDivisiones: zona.dataset.cajaDropDivisiones === '1',
    });
  });
}

/**
 * ORIGEN DEL ARRASTRE de las tarjetas de cajas/sub-espacios contenidos
 * (`[data-arrastre-entidad]`, que emite `contenidoInternoNodo.selectorPiezasHtml`
 * en modo `arrastrables`).
 *
 * El payload se publica con el ID REAL de la tarjeta y su `tipo_entidad`
 * explícito: `caja` para bultos móviles, `espacio` para divisiones fijas. Se
 * frena la propagación porque la tarjeta vive DENTRO de la zona de suelta del
 * contenedor activo y ningún ancestro debe reescribir el identificador.
 */
export function conectarArrastrePiezasCaja(host: HTMLElement): void {
  host.querySelectorAll<HTMLElement>('[data-arrastre-entidad]').forEach((tarjeta) => {
    const id = tarjeta.dataset.arrastreEntidad ?? '';
    if (!id) return;
    const tipoEntidad = tarjeta.dataset.arrastreTipo === 'espacio' ? 'espacio' : 'caja';
    tarjeta.addEventListener('dragstart', (ev) => {
      const de = ev as DragEvent;
      publicarArrastre(de, { id, tipoEntidad, origen: 'panel' });
      de.stopPropagation();
      tarjeta.classList.add('portal-pieza-arrastrando');
    });
    tarjeta.addEventListener('dragend', () => {
      tarjeta.classList.remove('portal-pieza-arrastrando');
    });
  });
}

/**
 * Conecta la barra de acciones del contenedor activo: la zona de suelta
 * destacada, las filas del selector de cajas del nivel y su origen de arrastre.
 * Idempotente por render: el host se reescribe por innerHTML en cada nivel, así
 * que los listeners viejos desaparecen con sus nodos.
 */
export function conectarAccionesCaja(host: HTMLElement, nodo: NodoPortal): void {
  conectarDropCaja(host, nodo);
  conectarDropPiezasCaja(host);
  conectarArrastrePiezasCaja(host);
}
