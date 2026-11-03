// =============================================================================
// ENLACE PROFUNDO AL MAPA DE ALMACENAMIENTO (/almacenamiento?contenedor=<id>)
// -----------------------------------------------------------------------------
// FUENTE ÚNICA del contrato de la URL que abre la POSICIÓN de una caja / mueble
// dentro del mapa de /almacenamiento:
//
//   · `urlMapaContenedor(id)`  → la construye el widget de ruta geográfica de las
//     tarjetas de /objetos (lib/rutaGeograficaWidget.ts) para su botón
//     «🗺️ Ver en el mapa».
//   · `contenedorDesdeUrl(search)` → la lee el arranque de la cascada de portales
//     (lib/mapa/portales/enlaceProfundoPortales.ts) para posicionarse en ese nodo.
//
// Ninguno de los dos lados define su propio nombre de parámetro: si cambia, se
// cambia acá y ambos quedan sincronizados.
// =============================================================================

/** Ruta de la pantalla del mapa espacial. */
export const RUTA_MAPA_ALMACENAMIENTO = '/almacenamiento';

/** Parámetro de la URL con el UUID del contenedor a enfocar en el mapa. */
export const PARAM_MAPA_CONTENEDOR = 'contenedor';

/**
 * URL del mapa posicionada en un contenedor concreto.
 *
 * `id` vacío devuelve la ruta pelada: el mapa abre en su nivel raíz en vez de
 * arrastrar un parámetro inválido.
 */
export function urlMapaContenedor(id: string | null | undefined): string {
  const limpio = String(id ?? '').trim();
  if (!limpio) return RUTA_MAPA_ALMACENAMIENTO;
  return `${RUTA_MAPA_ALMACENAMIENTO}?${PARAM_MAPA_CONTENEDOR}=${encodeURIComponent(limpio)}`;
}

/**
 * UUID del contenedor pedido en la URL (o null si no hay enlace profundo).
 *
 * Acepta el alias `caja`, para que un enlace manual escrito por el operador
 * (`/almacenamiento?caja=<id>`) también funcione.
 */
export function contenedorDesdeUrl(search: string): string | null {
  const params = new URLSearchParams(search || '');
  const valor = params.get(PARAM_MAPA_CONTENEDOR) || params.get('caja') || '';
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}
