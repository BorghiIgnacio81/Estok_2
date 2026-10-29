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
// 🎒 Disyuntor de movilidad (Lote 26): SIEMPRE debajo del control «Espacio Único».
import { lineaMuebleMovilHtml } from '../../muebleMovil';
// Propiedades del Objeto declarado (Dueño/Categoría/Estado/Valor estimado).
import { conectarPropiedadesObjetoEspacio } from '../../objetoEspacio';
import { leerCargaArrastrada, guardarEnContenedor, guardarEnUbicacion } from './transitoInterno';
import type { NodoPortal } from './estadoPortales';
import type { ObjetoDto } from './datosNodosPortales';
// Iconografía de interfaz: rutas canónicas (WebP optimizados) en UN solo módulo.
import { ASSET_MUEBLE } from '../../assetsUi';

const IMG_OBJETO = ASSET_MUEBLE;

/** Bloque monolítico: sin modelador, con el disyuntor y ZONA DE SUELTA propia. */
export function bloqueMonoliticoHtml(nodo: NodoPortal, enTransito: number): string {
  const transito = enTransito
    ? `<span class="portal-badge portal-badge-transito">${indicadorTransitoHtml('interno')} · ${enTransito}</span>`
    : '';
  // 🔒 LOTE 29 · ZONA DE SUELTA DEL ESPACIO ÚNICO: el bloque ENTERO acepta el
  // Drop de la canasta (antes sólo la grilla de abajo lo hacía, y soltar sobre el
  // bloque no disparaba nada). Usa los MISMOS ganchos estándar del motor, así que
  // no duplica ninguna lógica:
  //   · `data-portal-objetos-drop` → lo conecta initGrillaObjetosDirectos().
  //   · `data-drop-destino`        → id del contenedor que recibe la carga.
  //   · `zona-drop-espacio`        → gancho semántico de estilo.
  return `<div class="portal-monolitico zona-drop-espacio"
    data-portal-objetos-drop="${escapeHtml(nodo.id)}"
    data-drop-destino="${escapeHtml(nodo.id)}"
    title="Soltá acá una caja u objeto de la canasta para guardarlo directo en este espacio (sin estante ni casillero).">
    <div class="portal-monolitico-cab">
      <span class="portal-monolitico-ico" aria-hidden="true">🧱</span>
      <span class="portal-monolitico-nombre">${escapeHtml(nodo.nombre)}</span>
      <span class="portal-badge portal-badge-monolitico">🧱 ${ETIQUETA_ESPACIO_UNICO}</span>
      ${transito}
    </div>
    <p class="portal-monolitico-texto">Bloque monolítico: este contenedor no se subdivide en estantes ni cajones y el modelador geométrico queda bloqueado. Los objetos que aloja viven directo acá, en la grilla de la derecha.</p>
    ${checkboxEspacioUnicoHtml({ id: 'portalEspacioUnico', marcado: nodo.espacioUnico, valor: nodo.id })}
    ${lineaMuebleMovilHtml(nodo, 'portalMuebleMovil')}
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
  /** 🎒 Declaración de movilidad de la celda activa (PUT parcial al Contenedor). */
  alCambiarMuebleMovil: (valor: boolean) => void;
}): void {
  const host = opts.contenedor;
  if (!host) return;

  // Drop de guardado directo dentro del nodo activo. Los receptores pueden estar
  // ANIDADOS (el bloque monolítico contiene a la grilla directa): la guarda
  // `defaultPrevented` garantiza que sólo el receptor MÁS INTERNO procese la
  // suelta, sin doble resalte ni doble mutación (mismo criterio que
  // `transitoInterno.conectarDropCiego`).
  host.querySelectorAll<HTMLElement>('[data-portal-objetos-drop]').forEach((zona) => {
    const nodoId =
      zona.dataset.dropDestino ?? zona.dataset.portalObjetosDrop ?? opts.nodo.id;
    zona.addEventListener('dragover', (e) => {
      const de = e as DragEvent;
      if (de.defaultPrevented) return;
      e.preventDefault();
      if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
      zona.classList.add('portal-drop-activo');
    });
    zona.addEventListener('dragleave', () => zona.classList.remove('portal-drop-activo'));
    zona.addEventListener('drop', (e) => {
      const de = e as DragEvent;
      zona.classList.remove('portal-drop-activo');
      // El receptor interno ya procesó la suelta: se ignora el rebote hacia afuera.
      if (de.defaultPrevented) return;
      e.preventDefault();
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

  // 🎒 Disyuntor de movilidad: vive DEBAJO de «Espacio Único» y persiste el flag
  // del Contenedor activo (la Ubicación no tiene `declarado_movible`).
  const chkMovible = host.querySelector<HTMLInputElement>('[data-mueble-movil]');
  chkMovible?.addEventListener('change', () => {
    opts.alCambiarMuebleMovil(chkMovible.checked);
  });
  // Propiedades del Objeto espejo: despliegue + precarga al abrir la pieza.
  conectarPropiedadesObjetoEspacio(host, opts.nodo);
}

