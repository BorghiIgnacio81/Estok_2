// =============================================================================
// PANEL DE CONTENIDO DEL «ESPACIO FINAL» (sin lienzo/mapa 2D)
// -----------------------------------------------------------------------------
// Cuando el operador navega a un ESPACIO FINAL —un Estante, Cajón o Caja, es
// decir un nivel que NO contiene sub-espacios arquitectónicos— el lienzo 2D
// tradicional queda DESACTIVADO y oculto, y el Panel Derecho pasa a ser este
// Panel de Contenido limpio:
//
//   · CABECERA: nombre del espacio, badge «🧱 Espacio Final», contadores reales
//     (cajas/objetos/en tránsito), «🔎 Abrir ficha completa», el disyuntor de
//     movilidad y el botón «🧩 Modelar divisiones» (reabre el modelador).
//
//   · TARJETAS de los elementos CONTENIDOS: cada caja/sub-espacio con sus
//     contadores, cada objeto suelto. Tocarlas desciende a su interior
//     (`data-portal-abrir`) y se pueden arrastrar (payload explícito).
//
//   · ZONA RECEPTORA DE ÁREA COMPLETA (`data-caja-drop`): soltar en cualquier
//     punto del panel guarda el elemento en ESTE espacio.
//
//   · DROP TARGETS ANIDADOS (requisito de las pruebas): soltar directamente
//     sobre la tarjeta de una caja contenedora guarda el elemento DENTRO de esa
//     caja (`data-caja-drop-pieza`), no en el espacio general.
//
// No duplica persistencia: los receptores delegan en el motor de portales
// (`accionesCajaPortales.conectarZonaDrop` → `transitoInterno.guardarEnContenedor`)
// y las tarjetas de objeto en `grillaObjetosDirectos.initGrillaObjetosDirectos`.
// =============================================================================

import { escapeHtml, toast } from '../../mapaJerarquico';
import { indicadorTransitoHtml } from '../../indicadorTransito';
import { ETIQUETA_ESPACIO_FINAL } from '../../espacioFinal';
// 🎒 Disyuntor de movilidad de la pieza activa (PUT parcial al Contenedor).
import { lineaMuebleMovilHtml } from '../../muebleMovil';
import { forzarModelador } from './estadoPortales';
import type { NodoPortal } from './estadoPortales';
import type { InteriorNodo } from './datosNodosPortales';
import { barraAccionesCajaHtml, conectarAccionesCaja } from './accionesCajaPortales';
import { selectorPiezasHtml } from './contenidoInternoNodo';
import { grillaObjetosDirectosHtml, initGrillaObjetosDirectos } from './grillaObjetosDirectos';
import { alternarEspacioFinal, alternarMuebleMovil } from './editorDivisionesPortales';

/** Cabecera del panel: identidad del espacio, contadores y acciones. */
function cabeceraHtml(nodo: NodoPortal, interior: InteriorNodo): string {
  const piezas = interior.piezas.length;
  const objetos = interior.objetos.length;
  const enTransito = interior.objetos.filter((o) => o.en_transito_interno).length;
  const transito = enTransito
    ? `<span class="pfinal-pill pfinal-pill-transito">${indicadorTransitoHtml('interno')} ${enTransito}</span>`
    : '';
  return `<header class="pfinal-cab">
    <div class="pfinal-cab-izq">
      <span class="pfinal-ico" aria-hidden="true">🧱</span>
      <div class="pfinal-titulos">
        <h3 class="pfinal-nombre">${escapeHtml(nodo.nombre)}</h3>
        <div class="pfinal-badges">
          <span class="pfinal-badge">${ETIQUETA_ESPACIO_FINAL}</span>
          <span class="pfinal-pill">📦 ${piezas}</span>
          <span class="pfinal-pill">🧸 ${objetos}</span>
          ${transito}
        </div>
      </div>
    </div>
    <div class="pfinal-cab-der">
      <button type="button" class="pfinal-btn" data-pfinal-modelar
        title="Reabrir el modelador geométrico de «${escapeHtml(nodo.nombre)}» para subdividirlo en estantes o cajones">
        🧩 Modelar divisiones
      </button>
    </div>
  </header>
  ${barraAccionesCajaHtml(nodo)}
  ${lineaMuebleMovilHtml(nodo, 'pfinalMuebleMovil')}`;
}

/**
 * Markup COMPLETO del Panel de Contenido del Espacio Final.
 * Módulo PURO (devuelve string HTML): no toca el DOM ni hace fetch.
 */
export function panelEspacioFinalHtml(nodo: NodoPortal, interior: InteriorNodo): string {
  const piezas = interior.piezas ?? [];
  const objetos = interior.objetos ?? [];
  const sinCajas =
    'Este Espacio Final todavía no tiene cajas adentro. Arrastrá una desde la canasta y soltala en cualquier punto del panel.';
  return `<section class="pfinal" data-pfinal-nodo="${escapeHtml(nodo.id)}"
    aria-label="Panel de contenido del Espacio Final «${escapeHtml(nodo.nombre)}»">
    ${cabeceraHtml(nodo, interior)}
    <div class="pfinal-zona zona-drop-espacio"
      data-caja-drop="${escapeHtml(nodo.id)}"
      data-caja-drop-nombre="${escapeHtml(nodo.nombre)}"
      data-caja-drop-divisiones="${nodo.conDivisiones ? '1' : '0'}"
      title="Toda esta área es una zona de suelta: soltá una caja u objeto para guardarlo en «${escapeHtml(nodo.nombre)}». Sobre la tarjeta de una caja, el elemento se guarda DENTRO de esa caja.">
      <p class="pfinal-hint">
        ⬇ Soltá acá cajas u objetos de la canasta · sobre la TARJETA de una caja, el elemento se guarda DENTRO de esa caja.
      </p>
      ${selectorPiezasHtml(piezas, {
        // SIN RÓTULO INTERNO: el TÍTULO EXACTO del nivel
        // («📦 Cajas y piezas de este nivel · tocá una para ver su contenido y
        // soltarle objetos») ya lo muestra el ENCABEZADO del Panel Derecho, así
        // que repetirlo acá sería duplicar la misma frase en pantalla.
        titulo: '',
        arrastrables: true,
      })}
      ${piezas.length ? '' : `<p class="pfinal-vacio">${sinCajas}</p>`}
      ${grillaObjetosDirectosHtml(nodo, objetos)}
    </div>
  </section>`;
}

/**
 * Conecta el Panel de Contenido: zona receptora de área completa, Drop Targets
 * anidados de cada caja, origen de arrastre de tarjetas y objetos, disyuntores y
 * el botón que reabre el modelador geométrico.
 *
 * Idempotente por render: el host se reescribe con `innerHTML` en cada nivel, así
 * que los listeners viejos desaparecen junto con sus nodos.
 */
export function conectarPanelEspacioFinal(opts: {
  host: HTMLElement;
  nodo: NodoPortal;
}): void {
  const { host, nodo } = opts;

  // ÁREA COMPLETA + TARJETAS ANIDADAS: el wrapper declara `data-caja-drop` y cada
  // tarjeta `data-caja-drop-pieza`; el motor aísla ambos receptores para que la
  // suelta sobre una tarjeta NO se replique en el espacio general.
  conectarAccionesCaja(host, nodo);

  // Objetos sueltos: drop directo + origen de arrastre (payload `objeto`).
  initGrillaObjetosDirectos({
    contenedor: host,
    nodo,
    alCambiarMuebleMovil: (valor) => void alternarMuebleMovil(nodo, valor),
  });

  // 🧩 «Modelar divisiones»: único escape del nivel terminal. Si el espacio está
  // declarado como final se destilda el flag (PUT parcial); si fue detectado
  // automáticamente se fuerza el modelador en esta sesión. En ambos casos la
  // cascada re-transiciona en caliente y el lienzo 2D vuelve.
  host
    .querySelector<HTMLButtonElement>('[data-pfinal-modelar]')
    ?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (nodo.espacioUnico) {
        void alternarEspacioFinal(nodo, false);
        return;
      }
      forzarModelador(nodo.id, true);
      toast('🧩 Modelador habilitado: ya podés subdividir este espacio en estantes o cajones.');
      window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    });
}
