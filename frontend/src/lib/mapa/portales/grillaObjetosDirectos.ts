// =============================================================================
// GRILLA DIRECTA DE OBJETOS DEL NIVEL TERMINAL (panel del Espacio Final)
// -----------------------------------------------------------------------------
// Bloque de contenido que lista los OBJETOS que cuelgan DIRECTAMENTE del nodo
// activo (stock puro, sin contenedor intermedio) y los declara:
//   · DESTINO del arrastre (`[data-portal-objetos-drop]`): soltar una caja u
//     objeto de la canasta lo guarda directo en el nodo.
//   · ORIGEN del arrastre (`[data-portal-objeto-dnd]`): cada tarjeta viaja a
//     otra caja, al área general del panel o a la canasta, con el payload
//     EXPLÍCITO id + tipo_entidad (`objeto`) de lib/arrastreEntidad.ts.
//
// El PANEL completo (cabecera, tarjetas de cajas y zona receptora de área
// completa) vive en ./panelEspacioFinal.ts; acá sólo se resuelve el bloque de
// objetos, para no duplicar el render ni la persistencia.
// =============================================================================

import { escapeHtml } from '../../mapaJerarquico';
import { indicadorTransitoHtml } from '../../indicadorTransito';
// Propiedades del Objeto declarado (Dueño/Categoría/Estado/Valor estimado).
import { conectarPropiedadesObjetoEspacio } from '../../objetoEspacio';
import { publicarArrastre } from '../../arrastreEntidad';
import { leerCargaArrastrada, guardarEnContenedor, guardarEnUbicacion } from './transitoInterno';
import type { NodoPortal } from './estadoPortales';
import type { ObjetoDto } from './datosNodosPortales';
// Iconografía de interfaz: rutas canónicas (WebP optimizados) en UN solo módulo.
import { ASSET_MUEBLE } from '../../assetsUi';

const IMG_OBJETO = ASSET_MUEBLE;

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
 * arrastre de los objetos reales (payload explícito `objeto`).
 */
export function initGrillaObjetosDirectos(opts: {
  contenedor: HTMLElement | null;
  nodo: NodoPortal;
  /** 🎒 Declaración de movilidad de la celda activa (PUT parcial al Contenedor). */
  alCambiarMuebleMovil: (valor: boolean) => void;
}): void {
  const host = opts.contenedor;
  if (!host) return;

  // Drop de guardado directo dentro del nodo activo. Los receptores pueden estar
  // ANIDADOS (el área general del panel contiene a la grilla directa): la guarda
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
      // «En Tránsito Interno» en un Espacio Final. El destino es la HABITACIÓN
      // (Ubicación) o el CONTENEDOR según el nodo activo.
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
        // ASIGNACIÓN DEFINITIVA del operador: la pieza sale del limbo «En
        // Tránsito» en la misma transacción.
        enTransito: false,
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
      // PAYLOAD EXPLÍCITO: id real del objeto + `tipo_entidad: 'objeto'`.
      publicarArrastre(de, { id, tipoEntidad: 'objeto', origen: 'panel' });
      // Ningún ancestro arrastrable debe reescribir el identificador.
      de.stopPropagation();
      el.classList.add('portal-objeto-arrastrando');
    });
    el.addEventListener('dragend', () => el.classList.remove('portal-objeto-arrastrando'));
  });

  // 🎒 Disyuntor de movilidad: declara la pieza como bulto movible (la Ubicación
  // no tiene `declarado_movible`). El «Espacio Final» se declara/destilda desde
  // el acordeón de divisiones o desde el botón «Modelar divisiones» del panel.
  const chkMovible = host.querySelector<HTMLInputElement>('[data-mueble-movil]');
  chkMovible?.addEventListener('change', () => {
    opts.alCambiarMuebleMovil(chkMovible.checked);
  });
  // Propiedades del Objeto espejo: despliegue + precarga al abrir la pieza.
  conectarPropiedadesObjetoEspacio(host, opts.nodo);
}

