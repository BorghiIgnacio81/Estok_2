// =============================================================================
// ACCIONES DE LA CAJA / CONTENEDOR ACTIVO (Panel Derecho de Almacenamiento)
// -----------------------------------------------------------------------------
// Cuando el operador inspecciona una caja («Caja 01») el Panel Derecho muestra su
// interior (ficha + objetos guardados) y, debajo, la canasta de objetos
// disponibles. Este módulo aporta la barra de acciones DESTACADA de ese nivel:
//
//   · 🔎 «Abrir ficha completa» → /contenedores/{id} con TODO el inventario.
//   · 📍 «Mover caja a…» → reubica la caja ACTIVA sin depender del arrastre:
//     «🚚 Cajas en Tránsito», cualquier habitación/espacio físico, o un mueble,
//     estante o caja (queda DENTRO de él). Es la vía explícita para desvincular
//     las cajas que quedaron guardadas por error como una división del cuarto.
//     La mutación vive en lib/cajaReubicar.ts (POST en_transito ⇄ PUT).
//   · La ZONA DE SUELTA que recibe los objetos/cajas arrastrados de la canasta
//     para guardarlos DENTRO del contenedor abierto.
//
// El arrastre del lienzo sigue vigente como atajo (lib/arrastreTarjetasLienzo.ts
// + bandejaSinUbicar.ts); el selector es el camino equivalente para móvil y para
// las piezas que se dibujaron como división y no exponen el asa ⠿.
//
// Módulo de DOM puro: no dibuja planos ni duplica la cascada. La recepción del
// Drag & Drop delega en el motor de portales (transitoInterno.ts).
// =============================================================================

import { escapeHtml, toast } from '../../mapaJerarquico';
import type { NodoPortal } from './estadoPortales';
// Payload EXPLÍCITO del arrastre (id real + tipo_entidad): única fuente del
// contrato, compartida por canastas, lienzos y panel de contenido.
import { publicarArrastre } from '../../arrastreEntidad';
import { guardarEnContenedor, leerCargaArrastrada } from './transitoInterno';
// Reubicación de una caja existente: FUENTE ÚNICA de las mutaciones
// (POST en_transito ⇄ PUT ubicación/parent_contenedor).
import {
  listarDestinosCaja,
  moverCajaADestino,
} from '../../cajaReubicar';
import type { GrupoDestino } from '../../cajaReubicar';

/** Grupos y rótulos del selector «📍 Mover caja a…». */
const GRUPOS_MOVER: { clave: GrupoDestino; etiqueta: string }[] = [
  { clave: 'transito', etiqueta: 'En tránsito' },
  { clave: 'espacio', etiqueta: 'Espacios y habitaciones' },
  { clave: 'mueble', etiqueta: 'Muebles, estantes y cajas' },
];

/**
 * ¿La pieza activa puede reubicarse?
 *
 * Sólo bultos móviles: una CAJA, un MUEBLE_MOVIL o un OBJETO. La arquitectura
 * ANCLADA al cuarto (`CONJUNTO` = estante/cajón interno, `MUEBLE_INMUEBLE` =
 * mueble fijo) nunca cambia de habitación: el backend la rechaza con HTTP 403.
 */
function puedeReubicarse(nodo: NodoPortal): boolean {
  if (nodo.tipo !== 'contenedor') return false;
  if (nodo.esInmueble === true) return false;
  const tipo = String(nodo.tipoFisico || '').toUpperCase();
  return tipo !== 'CONJUNTO' && tipo !== 'MUEBLE_INMUEBLE';
}

/**
 * Barra de acciones del contenedor activo (vacía para habitaciones).
 *
 * La ficha completa está siempre. El selector de reubicación sólo se ofrece a
 * piezas móviles: la arquitectura anclada al cuarto no se mueve.
 */
export function barraAccionesCajaHtml(nodo: NodoPortal): string {
  if (nodo.tipo !== 'contenedor') return '';
  const mover = !puedeReubicarse(nodo)
    ? ''
    : `<label class="portal-caja-mover"
      title="Mover «${escapeHtml(nodo.nombre)}» a «🚚 Cajas en Tránsito», a otra habitación o dentro de un mueble/estante/caja">
      <span class="portal-caja-mover-ico" aria-hidden="true">📍</span>
      <select class="portal-caja-mover-select" data-caja-mover="${escapeHtml(nodo.id)}"
        aria-label="Mover «${escapeHtml(nodo.nombre)}» a otro espacio o a Cajas en Tránsito">
        <option value="">Mover a…</option>
      </select>
    </label>`;
  return `<div class="portal-caja-acciones">
    <a href="/contenedores/${escapeHtml(nodo.id)}"
      class="portal-caja-btn portal-caja-btn-ficha"
      title="Abrir la ficha completa de «${escapeHtml(nodo.nombre)}» con todo su inventario interno">
      🔎 Abrir ficha completa
    </a>
    ${mover}
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
 * Conecta el selector «📍 Mover caja a…» de la barra de acciones.
 *
 * Carga los destinos en segundo plano (una sola consulta cacheada) agrupados en
 * «En tránsito» · «Espacios y habitaciones» · «Muebles, estantes y cajas» y
 * persiste el cambio con `moverCajaADestino` (fuente única de la mutación). Es la
 * vía explícita para desvincular una caja guardada como división de un cuarto o
 * reubicarla directamente en otro espacio/mueble.
 */
export function conectarMoverCaja(host: HTMLElement, nodo: NodoPortal): void {
  if (!puedeReubicarse(nodo)) return;
  const select = host.querySelector<HTMLSelectElement>('[data-caja-mover]');
  if (!select) return;
  const cajaId = select.dataset.cajaMover ?? '';
  if (!cajaId) return;

  select.disabled = true;
  void (async () => {
    const destinos = await listarDestinosCaja(cajaId);
    // El panel se repinta con innerHTML: si este select ya no está en el DOM,
    // no se escribe nada (evita duplicar opciones en el nodo nuevo).
    if (!select.isConnected) return;
    for (const grupo of GRUPOS_MOVER) {
      const items = destinos.filter((d) => d.grupo === grupo.clave);
      if (!items.length) continue;
      const optgroup = document.createElement('optgroup');
      optgroup.label = grupo.etiqueta;
      for (const destino of items) {
        const opt = document.createElement('option');
        opt.value = destino.valor;
        opt.textContent = destino.etiqueta;
        optgroup.appendChild(opt);
      }
      select.appendChild(optgroup);
    }
    select.disabled = false;
  })();

  select.addEventListener('change', () => {
    const destino = select.value;
    if (!destino) return;
    select.disabled = true;
    void (async () => {
      const res = await moverCajaADestino(cajaId, destino);
      toast(res.ok ? `✅ ${res.mensaje}` : `❌ ${res.mensaje}`);
      // Tras una mutación exitosa el latido global repinta el panel completo; en
      // el error se rehabilita el selector para reintentar sin recargar.
      select.value = '';
      select.disabled = false;
    })();
  });
}

/**
 * Conecta la barra de acciones del contenedor activo: la zona de suelta
 * destacada, las filas del selector de cajas del nivel, su origen de arrastre y
 * el selector de reubicación de la caja abierta.
 * Idempotente por render: el host se reescribe por innerHTML en cada nivel, así
 * que los listeners viejos desaparecen con sus nodos.
 */
export function conectarAccionesCaja(host: HTMLElement, nodo: NodoPortal): void {
  conectarDropCaja(host, nodo);
  conectarDropPiezasCaja(host);
  conectarArrastrePiezasCaja(host);
  conectarMoverCaja(host, nodo);
}
