// =============================================================================
// GRILLA DIRECTA DE OBJETOS + BLOQUE MONOLÍTICO (fin de cadena «Espacio Único»)
// -----------------------------------------------------------------------------
// Cuando el nodo activo es un ESPACIO ÚNICO (o todavía no tiene divisiones):
//   · Panel Izquierdo → BLOQUE MONOLÍTICO: el modelador geométrico queda
//     BLOQUEADO y sólo se ofrece el control «Espacio Único» con su leyenda.
//   · Panel Derecho    → GRILLA DIRECTA de los objetos reales que aloja el nodo
//     (stock puro) y Drop Zone que guarda objetos/cajas de forma directa.
//     En este nivel la canasta flotante se oculta (lo decide el orquestador).
// =============================================================================

import { escapeHtml, toast } from '../../mapaJerarquico';
import { indicadorTransitoHtml } from '../../indicadorTransito';
import { checkboxEspacioUnicoHtml, GUIA_ESPACIO_UNICO, ETIQUETA_ESPACIO_UNICO } from '../../espacioUnico';
import { leerCargaArrastrada, guardarEnContenedor, guardarEnUbicacion } from './transitoInterno';
import type { NodoPortal } from './estadoPortales';
import type { ObjetoDto } from './datosNodosPortales';

const IMG_OBJETO = '/mueble.png';

/** Bloque monolítico del Panel Izquierdo: sin modelador, con el disyuntor. */
export function bloqueMonoliticoHtml(nodo: NodoPortal, enTransito: number): string {
  const transito = enTransito
    ? `<span class="portal-badge portal-badge-transito">${indicadorTransitoHtml('interno')} · ${enTransito}</span>`
    : '';
  return `<div class="portal-monolitico">
    <div class="portal-monolitico-cab">
      <span class="portal-monolitico-ico" aria-hidden="true">🧱</span>
      <span class="portal-monolitico-nombre">${escapeHtml(nodo.nombre)}</span>
      <span class="portal-badge portal-badge-monolitico">🧱 ${ETIQUETA_ESPACIO_UNICO}</span>
      ${transito}
    </div>
    <p class="portal-monolitico-texto">Bloque monolítico: este contenedor no se subdivide en estantes ni cajones y el modelador geométrico queda bloqueado. Los objetos que aloja viven directo acá, en la grilla de la derecha.</p>
    ${checkboxEspacioUnicoHtml({ id: 'portalEspacioUnico', marcado: nodo.espacioUnico, valor: nodo.id })}
    <p class="portal-monolitico-guia">${GUIA_ESPACIO_UNICO}</p>
  </div>`;
}

/** Tarjeta de un objeto real guardado directamente en el nodo. */
function tarjetaObjetoHtml(o: ObjetoDto): string {
  const transito = o.en_transito_interno
    ? ` ${indicadorTransitoHtml('interno', '🔴 pendiente de estante')}`
    : '';
  const casillero =
    o.parent_grid_row != null && o.parent_grid_col != null
      ? `F${o.parent_grid_row}·C${o.parent_grid_col}`
      : 'sin casillero';
  return `<article class="portal-objeto${o.en_transito_interno ? ' portal-objeto-transito' : ''}"
    draggable="true"
    data-portal-objeto-dnd="${escapeHtml(o.id)}"
    title="Objeto «${escapeHtml(o.nombre)}» · ${escapeHtml(casillero)}. Arrastralo a la canasta para extraerlo.">
    <img src="${escapeHtml(o.foto || IMG_OBJETO)}" alt="" class="portal-objeto-img" draggable="false" />
    <span class="portal-objeto-nombre">${escapeHtml(o.nombre)}</span>
    <span class="portal-objeto-casillero">${escapeHtml(casillero)}</span>${transito}
  </article>`;
}

/** Grilla directa de objetos reales del nodo (Drop Zone de guardado directo). */
export function grillaObjetosDirectosHtml(nodo: NodoPortal, objetos: ObjetoDto[]): string {
  const encabezado = `<div class="portal-grilla-cab">
    <span class="portal-grilla-titulo">📦 Objetos guardados directamente</span>
    <span class="portal-grilla-num">${objetos.length}</span>
  </div>`;
  const cuerpo = objetos.length
    ? objetos.map(tarjetaObjetoHtml).join('')
    : `<p class="portal-grilla-vacio">Todavía no hay objetos acá. Arrastrá uno desde la canasta y soltalo en este recuadro para guardarlo de forma directa.</p>`;
  return `<div class="portal-grilla-directa">
    ${encabezado}
    <div class="portal-grilla-objetos" data-portal-objetos-drop="${escapeHtml(nodo.id)}">${cuerpo}</div>
  </div>`;
}

/**
 * Conecta la grilla: Drop de guardado DIRECTO (sin celda fina) y origen de
 * arrastre de los objetos reales. El control «Espacio Único» avisa al
 * orquestador por callback para persistir y re-transicionar en caliente.
 */
export function initGrillaObjetosDirectos(opts: {
  contenedor: HTMLElement | null;
  nodo: NodoPortal;
  alCambiarEspacioUnico: (valor: boolean) => void;
}): void {
  const host = opts.contenedor;
  if (!host) return;

  // Drop de guardado directo dentro del nodo activo.
  host.querySelectorAll<HTMLElement>('[data-portal-objetos-drop]').forEach((zona) => {
    const nodoId = zona.dataset.portalObjetosDrop ?? opts.nodo.id;
    zona.addEventListener('dragover', (e) => {
      const de = e as DragEvent;
      e.preventDefault();
      if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
      zona.classList.add('portal-drop-activo');
    });
    zona.addEventListener('dragleave', () => zona.classList.remove('portal-drop-activo'));
    zona.addEventListener('drop', (e) => {
      const de = e as DragEvent;
      e.preventDefault();
      zona.classList.remove('portal-drop-activo');
      const carga = leerCargaArrastrada(de);
      if (!carga) return;
      // Guardado DIRECTO, sin estante y sin casillero. El backend jamás marca
      // «En Tránsito Interno» en un bloque monolítico (Espacio Único). El destino
      // es la HABITACIÓN (Ubicación) o el CONTENEDOR según el nodo activo.
      if (opts.nodo.tipo === 'habitacion') {
        void guardarEnUbicacion(carga, nodoId, opts.nodo.nombre);
        return;
      }
      void guardarEnContenedor(carga, {
        contenedorId: nodoId,
        nombre: opts.nodo.nombre,
        tieneDivisiones: false,
        fila: null,
        col: null,
      });
    });
  });

  // Origen de arrastre: los objetos reales vuelven a la canasta o viajan a otra pieza.
  host.querySelectorAll<HTMLElement>('[data-portal-objeto-dnd]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      const de = e as DragEvent;
      const id = el.dataset.portalObjetoDnd;
      if (!id) {
        de.preventDefault();
        return;
      }
      de.dataTransfer?.setData('application/x-estok-objeto', id);
      de.dataTransfer?.setData('text/plain', id);
      if (de.dataTransfer) de.dataTransfer.effectAllowed = 'move';
      el.classList.add('portal-objeto-arrastrando');
    });
    el.addEventListener('dragend', () => el.classList.remove('portal-objeto-arrastrando'));
  });

  // Disyuntor: destildar «Espacio Único» vuelve a habilitar el modelador.
  const chk = host.querySelector<HTMLInputElement>('[data-espacio-unico]');
  chk?.addEventListener('change', () => {
    opts.alCambiarEspacioUnico(chk.checked);
    toast(
      chk.checked
        ? '🧱 Marcado como Espacio Único: se bloquea el modelador y los objetos se guardan directo.'
        : '🧩 Destildado: ahora podés subdividirlo en estantes o cajones en la grilla de la izquierda.',
    );
  });
}

