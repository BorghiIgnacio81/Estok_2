// =============================================================================
// DESPLIEGUE DE LA RUTA GEOGRÁFICA (clic sobre el texto → minimapas)
// -----------------------------------------------------------------------------
// ÚNICA delegación de eventos del widget de ruta (lib/rutaGeograficaWidget.ts).
// Se registra una sola vez (idempotente) y trabaja por delegación en el
// documento, así funciona para las tarjetas que el listado re-inyecta en
// caliente con cada recarga/filtro (no hay que re-enlazar nada).
//
// REGLA CLAVE: la ruta vive DENTRO del `<summary>` de las tarjetas de
// contenedor; por eso el clic dentro del widget cancela SIEMPRE el evento
// (default + propagación) y el acordeón de la tarjeta no se pliega ni se
// despliega al abrir o cerrar los minimapas.
//
// La animación (grid-template-rows 0fr → 1fr) está en
// styles/ruta-geografica.css: acá solo se alterna la clase de estado.
// =============================================================================

const SELECTOR_ZONA = '[data-ruta-geo]';
const SELECTOR_DISPARADOR = '[data-ruta-geo-toggle]';

let enlazado = false;

/** Registra la delegación de clic del widget (una única vez). */
export function initRutaGeograficaDespliegue(): void {
  if (enlazado || typeof document === 'undefined') return;
  enlazado = true;

  document.addEventListener('click', (evento) => {
    const objetivo = evento.target as Element | null;
    if (!objetivo || typeof objetivo.closest !== 'function') return;

    const zona = objetivo.closest(SELECTOR_ZONA) as HTMLElement | null;
    if (!zona) return;

    // Nunca se propaga al <summary> contenedor: la ruta no abre/cierra la tarjeta.
    evento.preventDefault();
    evento.stopPropagation();

    const disparador = objetivo.closest(SELECTOR_DISPARADOR);
    if (!disparador) return;

    const abierta = zona.classList.toggle('ruta-geo-abierta');
    disparador.setAttribute('aria-expanded', abierta ? 'true' : 'false');
  });
}
