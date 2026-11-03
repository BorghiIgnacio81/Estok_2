// =============================================================================
// WIDGET DE RUTA GEOGRÁFICA (texto con flechas + despliegue de minimapas)
// -----------------------------------------------------------------------------
// Cara VISUAL del replanteo geográfico del listado de Objetos. Reemplaza al
// render estático de la cadena de minimapas (que saturaba cada tarjeta) por:
//
//   1. TEXTO dinámico con la ruta jerárquica exacta y flechas:
//      «1er piso > Habitación Frente > Ropero empotrado > Estante Arriba».
//   2. TOOLTIP nativo de Tailwind al pasar el mouse: «Mostrar en minimapas».
//   3. CLIC sobre el texto → despliegue suave de la fila de minimapas
//      analíticos unificados (silueta real de la casa, plano proporcional de
//      habitaciones con bordes negros nítidos y el subcontenedor resaltado en
//      NARANJA #f97316). Un segundo clic lo colapsa.
//   4. BOTÓN «🗺️ Ver en el mapa» (opción `mapaUrl`): enlace directo a
//      /almacenamiento posicionado en la caja/contenedor de la tarjeta, para
//      abrir su POSICIÓN real en el mapa espacial.
//
// 100% puro: no hace fetch, no toca el DOM y no conoce el dominio. El texto y
// los minimapas llegan ya resueltos desde lib/rutaCajaMinimapas.ts (una sola
// fuente de la física espacial). La animación vive en
// styles/ruta-geografica.css y el clic en lib/rutaGeograficaDespliegue.ts.
// =============================================================================

import { escapeHtml } from './mapaJerarquico';

export interface WidgetRutaOpciones {
  /** Cadena jerárquica ya resuelta, con flechas entre niveles. */
  texto: string;
  /** Fila de minimapas analíticos (motor compartido). Vacío = sin despliegue. */
  minimapas: string;
  /** Clave de la entidad ubicable (id), para identificar el widget en el DOM. */
  clave?: string;
  /**
   * ENLACE DIRECTO AL MAPA: URL de /almacenamiento posicionada en la caja /
   * contenedor (lib/mapa/rutaMapaAlmacenamiento.ts → urlMapaContenedor). Con
   * valor se renderiza el botón «🗺️ Ver en el mapa» junto al texto de la ruta.
   */
  mapaUrl?: string;
}

/**
 * PIN ROJO DE UBICACIÓN (ancla visual de TODA cadena geográfica).
 *
 * Fuente ÚNICA del ícono: SVG compacto de pin de mapa en rojo estricto
 * (`text-red-600` = #dc2626), alineado verticalmente con el texto
 * (`inline-flex items-center mr-1.5`). Lo consumen tanto este widget (render
 * dinámico del cliente), garantizando SIMETRÍA ABSOLUTA sin duplicar el marcado.
 */
export const PIN_UBICACION_HTML =
  '<span class="inline-flex items-center mr-1.5 shrink-0 align-middle" aria-hidden="true">'
  + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"'
  + ' class="h-3.5 w-3.5 text-red-600">'
  + '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>'
  + '</svg>'
  + '</span>';

/**
 * BOTÓN «VER EN EL MAPA» (acceso directo a la posición de la caja).
 *
 * Se emite como `<a href>` real —nunca un botón con JS— para que funcione con
 * clic medio, «abrir en pestaña nueva» y navegación por teclado. Lleva
 * `data-ruta-mapa` para que la delegación de clic del widget
 * (lib/rutaGeograficaDespliegue.ts) NO cancele su navegación.
 */
export function botonMapaHtml(url: string): string {
  const destino = escapeHtml(url);
  return '<a href="' + destino + '" data-ruta-mapa'
    + ' class="inline-flex items-center gap-1 shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-1.5 py-1'
    + ' text-[10px] font-bold text-amber-900 transition-colors duration-150 hover:bg-amber-200"'
    + ' title="Abrir la posición de esta caja en el mapa de Almacenamiento">'
    + '<span aria-hidden="true">🗺️</span><span class="hidden sm:inline">Ver en el mapa</span>'
    + '</a>';
}

/**
 * HTML del widget. Sin `minimapas` degrada a una etiqueta de texto simple: el
 * widget JAMÁS inventa un plano ni un cajón de relleno.
 *
 * El botón del mapa (si llega `mapaUrl`) se emite SIEMPRE, tenga o no fila de
 * minimapas: el acceso directo a /almacenamiento no depende de que el contexto
 * geográfico esté cargado.
 */
export function rutaGeograficaWidgetHtml(opciones: WidgetRutaOpciones): string {
  const texto = escapeHtml(opciones.texto);
  const botonMapa = opciones.mapaUrl ? botonMapaHtml(opciones.mapaUrl) : '';
  if (!opciones.minimapas) {
    return '<span class="flex w-full min-w-0 items-center gap-1.5">'
      + '<span class="block min-w-0 flex-1 text-[11px] font-medium text-gray-500">' + PIN_UBICACION_HTML
      + '<span class="align-middle">' + texto + '</span></span>'
      + botonMapa
      + '</span>';
  }

  const clave = escapeHtml(opciones.clave || '');
  return '<div class="ruta-geo" data-ruta-geo data-ruta-clave="' + clave + '">'
    + '<div class="flex w-full min-w-0 items-center gap-1.5">'
    + '<button type="button" data-ruta-geo-toggle aria-expanded="false"'
    + ' class="ruta-geo-toggle group relative flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-amber-100/70 cursor-pointer">'
    // Cartel flotante nativo de Tailwind, oculto hasta el hover del botón.
    + '<span class="pointer-events-none absolute -top-7 left-1 z-30 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[10px] font-semibold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">Mostrar en minimapas</span>'
    + PIN_UBICACION_HTML
    + '<span class="ruta-geo-cadena text-[11px] font-semibold text-gray-600 line-clamp-2">' + texto + '</span>'
    + '<span class="ruta-geo-chevron shrink-0 text-[10px] text-gray-400" aria-hidden="true">▾</span>'
    + '</button>'
    + botonMapa
    + '</div>'
    // El panel de minimapas nace OCULTO (`hidden` + `data-ruta-geo-panel`): la
    // tarjeta se mantiene COMPACTA y solo se despliega al hacer clic en el texto.
    + '<div class="ruta-geo-panel hidden" data-ruta-geo-panel role="region" aria-label="Minimapas de la ruta geográfica">'
    + '<div class="ruta-geo-panel-interior">' + opciones.minimapas + '</div>'
    + '</div>'
    + '</div>';
}
