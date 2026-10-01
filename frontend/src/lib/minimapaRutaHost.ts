// =============================================================================
// HOST DEL COMPONENTE GLOBAL (markup emitido en caliente)
// -----------------------------------------------------------------------------
// ÚNICO punto que declara los HOSTS del componente global para los módulos de
// src/lib que lo montan EN CALIENTE (innerHTML): un componente Astro no se puede
// importar desde un módulo .ts, así que su markup se replica acá UNA sola vez.
//
// DOS FORMATOS, las mismas clases canónicas que emite components/MinimapaRuta.astro:
//   · `hostPlanoMinimapaHtml`  → `.minimapa-ruta-plano` (plano a escala + SVG
//     del motor + capa de etiquetas), con `--minimapa-aspecto-ratio` real.
//   · `hostCadenaMinimapaHtml` → `.minimapa-ruta-cadena` (mini-guía de
//     orientación: planta → ambiente → mueble → caja) con el contenido de
//     lib/minimapasAnidados.ts.
//
// Es el ESPEJO EXACTO de lo que emite el componente:
//   · mismas clases canónicas: `minimapa-ruta minimapa-ruta-<formato>`,
//   · las MISMAS utilidades anti-desborde: `w-full overflow-hidden min-w-0`,
//   · el mismo atributo `data-minimapa-ruta` en el plano,
//   · el mismo `style` con `--minimapa-aspecto-ratio` (proporción REAL
//     ancho/alto del lienzo), que da el alto elástico al host del plano.
//
// El look (fondo crema, muros negros nítidos, puntas redondeadas, sectores
// fusionados como un único contorno y etiquetas de ambiente) lo aportan el MOTOR
// SVG (lib/minimapa.ts → minimapaSectoresSvg) y la hoja propia del componente
// (styles/minimapa-ruta.css). Por eso la pantalla que consume esta fábrica DEBE
// tener esa hoja montada (importada por ella o por un `<MinimapaRuta />` de su
// árbol de componentes): sin ella el host queda sin `aspect-ratio` y el plano
// se ve descalzado.
//
// REGLA: ninguna pantalla ni módulo declara su propio <div> de plano o de
// cadena. Cero divs manuales duplicados del componente global.
// =============================================================================

import { ASPECTO_LIENZO } from './minimapa';

/** Clases canónicas del host del plano (idénticas a components/MinimapaRuta.astro). */
const CLASES_HOST_PLANO = 'minimapa-ruta minimapa-ruta-plano w-full overflow-hidden min-w-0';
/** Clases canónicas del host de la cadena (formato `cadena` del componente). */
const CLASES_HOST_CADENA = 'minimapa-ruta minimapa-ruta-cadena w-full overflow-hidden min-w-0';

/**
 * Host canónico de la CADENA de minimapas (formato `cadena` del componente
 * global): mismas clases que emite components/MinimapaRuta.astro para la
 * mini-guía de orientación (`minimapa-ruta minimapa-ruta-cadena w-full
 * overflow-hidden`), así el encabezado en cascada de un modal montado en
 * caliente se ve EXACTAMENTE igual que el de las pantallas que usan el
 * componente. La pantalla que lo consume debe tener montadas las hojas
 * styles/minimapa-ruta.css y styles/almacenamiento-portales.css (la segunda
 * aporta los estilos `.mini-anidado*`).
 *
 * @param contenido salida de `renderMinimapasAnidados(...)`.
 * @param extra     clases o ganchos adicionales de la pantalla (opcional).
 */
export function hostCadenaMinimapaHtml(contenido: string, extra = ''): string {
  return '<div class="' + CLASES_HOST_CADENA + (extra ? ' ' + extra : '') + '">'
    + contenido + '</div>';
}

/**
 * Host canónico del PLANO A ESCALA con el SVG del motor ya inyectado.
 *
 * @param svg    salida del motor: `minimapaSectoresSvg({ ..., responsive: true })`.
 * @param aspecto relación alto/ancho REAL del lienzo (default: el del motor).
 * @param extra  ganchos de la pantalla que lo consume (ej: la zona de suelta del
 *               asistente «Mover»: `data-mover-plano`).
 */
export function hostPlanoMinimapaHtml(
  svg: string,
  aspecto: number = ASPECTO_LIENZO,
  extra = '',
): string {
  const relacion = Math.max(0.35, Math.min(1.8, Number(aspecto) || ASPECTO_LIENZO));
  return '<div class="' + CLASES_HOST_PLANO + '" style="--minimapa-aspecto-ratio:'
    + (1 / relacion).toFixed(4) + ';" data-minimapa-ruta' + (extra ? ' ' + extra : '') + '>'
    + svg + '</div>';
}
