// =============================================================================
// DROP INTER-CUADRANTES · SILUETAS DEL PLANO IZQUIERDO
// -----------------------------------------------------------------------------
// El cuadrante izquierdo (ANCLA) dibuja el plano del NIVEL SUPERIOR y, cuando el
// espacio activo tiene subdivisiones internas, SU PROPIO plano de subdivisiones
// (lib/mapa/portales/planoSubdivisionesActivo.ts). Ambos tipos de silueta son
// Dropzones receptoras del arrastre que nace en el cuadrante DERECHO (tarjetas de
// cajas de la cascada, objetos del nodo activo o de la canasta):
//
//   · `[data-drop-ubicacion]`  → silueta de HABITACIÓN: reubica el bulto a esa
//     habitación (`PUT /api/{contenedores|objetos}/{id}/` con `ubicacion`).
//   · `[data-drop-contenedor]` → silueta de SUBDIVISIÓN del espacio activo:
//     guarda el bulto DENTRO de esa subdivisión con el MISMO contrato relacional
//     del Drop sobre tarjetas (`parent_contenedor` = espacio_id real).
//
// Al soltar:
//   1. se captura el id REAL del objeto/caja arrastrado (contrato de arrastre de
//      lib/arrastreEntidad.ts: `objeto` | `caja` | `espacio`);
//   2. se delega la persistencia en transitoInterno (reubicarEnUbicacion /
//      guardarEnContenedor): NUNCA se duplica el PUT acá;
//   3. se refresca la vista en el acto con el latido global.
//
// El receptor marca `preventDefault()` ANTES de cualquier await, así el «drop a
// ciegas» del Panel Izquierdo (conectarDropCiego) ignora la suelta ya consumida.
// =============================================================================

import { guardarEnContenedor, leerCargaArrastrada, reubicarEnUbicacion } from './transitoInterno';

/** Silueta de habitación que declara su id real como destino de la suelta. */
const SELECTOR_SILUETA = '[data-drop-ubicacion]';
/**
 * Silueta de SUBDIVISIÓN del espacio activo (plano del cuadrante izquierdo,
 * lib/mapa/portales/planoSubdivisionesActivo.ts). Declara el UUID REAL del
 * contenedor que recibe el bulto.
 */
const SELECTOR_SUBDIVISION = '[data-drop-contenedor]';
/** Clase de realce mientras el bulto viaja sobre la silueta (styles/almacenamiento-portales.css). */
const CLASE_RECEPTORA = 'minimapa-sector-drop-activo';

/** Silueta receptora bajo el puntero (SVG `<g>` o cualquier descendiente). */
function siluetaDe(ev: Event): Element | null {
  const objetivo = ev.target as Element | null;
  return objetivo && typeof objetivo.closest === 'function'
    ? objetivo.closest(SELECTOR_SILUETA)
    : null;
}

/** Subdivisión receptora bajo el puntero (plano izquierdo del espacio activo). */
function subdivisionDe(ev: Event): Element | null {
  const objetivo = ev.target as Element | null;
  return objetivo && typeof objetivo.closest === 'function'
    ? objetivo.closest(SELECTOR_SUBDIVISION)
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

  /** Zona receptora válida bajo el puntero (habitación o subdivisión del activo). */
  const zonaDe = (ev: Event): Element | null => siluetaDe(ev) ?? subdivisionDe(ev);

  host.addEventListener('dragover', (ev) => {
    const de = ev as DragEvent;
    const zona = zonaDe(de);
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
    const subdivision = subdivisionDe(de);
    const zona = subdivision ?? siluetaDe(de);
    marcar(null);
    if (!zona) return;
    const carga = leerCargaArrastrada(de);
    // Sin payload no hay nada que reubicar: el drop a ciegas decide.
    if (!carga) return;
    // La suelta ya se consume acá: ningún otro receptor debe repetir el PUT.
    de.preventDefault();
    de.stopPropagation();
    // ── SUBDIVISIÓN del espacio activo: se guarda DENTRO de esa subdivisión con
    //    el MISMO contrato relacional del Drop sobre tarjetas («En Tránsito
    //    Interno» si la subdivisión tiene divisiones propias).
    if (subdivision) {
      const contenedorId = subdivision.getAttribute('data-drop-contenedor') ?? '';
      if (!contenedorId || carga.id === contenedorId) return;
      void guardarEnContenedor(carga, {
        contenedorId,
        nombre: subdivision.getAttribute('data-drop-nombre') ?? 'la subdivisión',
        tieneDivisiones: subdivision.getAttribute('data-drop-divisiones') === '1',
        fila: null,
        col: null,
      });
      return;
    }
    // ── SILUETA DE HABITACIÓN del plano superior: reasigna la ubicación.
    const ubicacionId = zona.getAttribute('data-drop-ubicacion') ?? '';
    const nombre = zona.getAttribute('data-drop-nombre') ?? 'la habitación';
    if (!ubicacionId) return;
    // Una habitación nunca se contiene a sí misma.
    if (carga.id === ubicacionId) return;
    void reubicarEnUbicacion(carga, ubicacionId, nombre);
  });
}
