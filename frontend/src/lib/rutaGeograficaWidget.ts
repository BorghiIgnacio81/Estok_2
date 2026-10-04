// =============================================================================
// WIDGET DE RUTA GEOGRÁFICA (texto con flechas + despliegue de minimapas)
// -----------------------------------------------------------------------------
// Cara VISUAL del replanteo geográfico del listado de Objetos. Reemplaza al
// render estático de la cadena de minimapas (que saturaba cada tarjeta) por:
//
//   1. TEXTO dinámico con la ruta jerárquica exacta y flechas:
//      «1er piso -> Habitación Frente -> Ropero empotrado -> Estante Arriba».
//   2. TOOLTIP nativo de Tailwind al pasar el mouse: «Mostrar en minimapas».
//   3. CLIC sobre el texto → despliegue suave de la fila de minimapas
//      analíticos unificados (silueta real de la casa, plano proporcional de
//      habitaciones con bordes negros nítidos y el subcontenedor resaltado en
//      NARANJA #f97316). Un segundo clic lo colapsa.
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
}

/**
 * HTML del widget. Sin `minimapas` degrada a una etiqueta de texto simple: el
 * widget JAMÁS inventa un plano ni un cajón de relleno.
 */
export function rutaGeograficaWidgetHtml(opciones: WidgetRutaOpciones): string {
  const texto = escapeHtml(opciones.texto);
  if (!opciones.minimapas) {
    return '<span class="block text-[11px] font-medium text-gray-500">🗺️ ' + texto + '</span>';
  }

  const clave = escapeHtml(opciones.clave || '');
  return '<div class="ruta-geo" data-ruta-geo data-ruta-clave="' + clave + '">'
    + '<button type="button" data-ruta-geo-toggle aria-expanded="false"'
    + ' class="ruta-geo-toggle group relative flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-amber-100/70 cursor-pointer">'
    // Cartel flotante nativo de Tailwind, oculto hasta el hover del botón.
    + '<span class="pointer-events-none absolute -top-7 left-1 z-30 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[10px] font-semibold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">Mostrar en minimapas</span>'
    + '<span class="shrink-0 text-[11px]" aria-hidden="true">🗺️</span>'
    + '<span class="ruta-geo-cadena text-[11px] font-semibold text-gray-600 line-clamp-2">' + texto + '</span>'
    + '<span class="ruta-geo-chevron shrink-0 text-[10px] text-gray-400" aria-hidden="true">▾</span>'
    + '</button>'
    // El panel de minimapas nace OCULTO (`hidden` + `data-ruta-geo-panel`): la
    // tarjeta se mantiene COMPACTA y solo se despliega al hacer clic en el texto.
    + '<div class="ruta-geo-panel hidden" data-ruta-geo-panel role="region" aria-label="Minimapas de la ruta geográfica">'
    + '<div class="ruta-geo-panel-interior">' + opciones.minimapas + '</div>'
    + '</div>'
    + '</div>';
}
