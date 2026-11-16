// =============================================================================
// DROP INTER-CUADRANTES · SILUETAS DE HABITACIÓN DEL PLANO IZQUIERDO
// -----------------------------------------------------------------------------
// El cuadrante izquierdo (ANCLA) dibuja el plano del NIVEL SUPERIOR. Sus
// siluetas de HABITACIÓN (`[data-drop-ubicacion]`, emitidas por
// tarjetasHabitaciones.ts) actúan como Dropzones receptoras del arrastre que
// nace en el cuadrante DERECHO (tarjetas de cajas de la cascada, objetos del
// nodo activo o de la canasta).
//
// Al soltar:
//   1. se captura el id REAL del objeto/caja arrastrado (contrato de arrastre de
//      lib/arrastreEntidad.ts: `objeto` | `caja` | `espacio`);
//   2. se actualiza en el backend su ubicación al `espacio_id` de la habitación
//      receptora (PUT /api/{contenedores|objetos}/{id}/ con `ubicacion`);
//   3. se avisa «Objeto reubicado a «Habitación»» y se refresca la vista en el
//      acto con el latido global (`estok:espacios-cambiados`).
//
// La persistencia NO se duplica: delega en transitoInterno.reubicarEnUbicacion.
// El receptor marca `preventDefault()` ANTES de cualquier await, así el «drop a
// ciegas» del Panel Izquierdo (conectarDropCiego) ignora la suelta ya consumida.
// =============================================================================

import { leerCargaArrastrada, reubicarEnUbicacion } from './transitoInterno';

/** Silueta de habitación que declara su id real como destino de la suelta. */
const SELECTOR_SILUETA = '[data-drop-ubicacion]';
/** Clase de realce mientras el bulto viaja sobre la silueta (styles/almacenamiento-portales.css). */
const CLASE_RECEPTORA = 'minimapa-sector-drop-activo';

/** Silueta receptora bajo el puntero (SVG `<g>` o cualquier descendiente). */
function siluetaDe(ev: Event): Element | null {
  const objetivo = ev.target as Element | null;
  return objetivo && typeof objetivo.closest === 'function'
    ? objetivo.closest(SELECTOR_SILUETA)
    : null;
}

/**
 * Conecta por DELEGACIÓN el host del Panel Izquierdo: el host persiste entre
 * refrescos (sólo se reescribe su contenido), así que un único conjunto de
 * listeners sigue vigente para todas las siluetas re-renderizadas.
 */
export function conectarDropSiluetasAncla(host: HTMLElement | null): void {
  if (!host) return;
  /** Silueta actualmente resaltada (una sola a la vez). */
  let receptor: Element | null = null;

  const marcar = (zona: Element | null): void => {
    if (receptor === zona) return;
    receptor?.classList.remove(CLASE_RECEPTORA);
    receptor = zona;
    receptor?.classList.add(CLASE_RECEPTORA);
  };

  host.addEventListener('dragover', (ev) => {
    const de = ev as DragEvent;
    const zona = siluetaDe(de);
    if (!zona) {
      marcar(null);
      return;
    }
    // Receptor válido: se habilita la suelta y se frena el «drop a ciegas».
    de.preventDefault();
    de.stopPropagation();
    if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
    marcar(zona);
  });

  host.addEventListener('dragleave', () => marcar(null));

  host.addEventListener('drop', (ev) => {
    const de = ev as DragEvent;
    const zona = siluetaDe(de);
    marcar(null);
    if (!zona) return;
    const ubicacionId = zona.getAttribute('data-drop-ubicacion') ?? '';
    const nombre = zona.getAttribute('data-drop-nombre') ?? 'la habitación';
    if (!ubicacionId) return;
    const carga = leerCargaArrastrada(de);
    // Sin payload no hay nada que reubicar: el drop a ciegas decide.
    if (!carga) return;
    // La suelta ya se consume acá: ningún otro receptor debe repetir el PUT.
    de.preventDefault();
    de.stopPropagation();
    // Una habitación nunca se contiene a sí misma.
    if (carga.id === ubicacionId) return;
    void reubicarEnUbicacion(carga, ubicacionId, nombre);
  });
}
