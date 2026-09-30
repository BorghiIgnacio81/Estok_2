// =============================================================================
// HOST DEL PLANO DEL COMPONENTE GLOBAL (markup emitido en caliente)
// -----------------------------------------------------------------------------
// ÚNICO punto que declara el contenedor (HOST) del PLANO A ESCALA para los
// módulos de src/lib que montan el componente EN CALIENTE (innerHTML): un
// componente Astro no se puede importar desde un módulo .ts, así que su markup
// se replica acá UNA sola vez.
//
// Es el ESPEJO EXACTO de lo que emite components/MinimapaRuta.astro en formato
// `plano`:
//   · mismas clases canónicas: `minimapa-ruta minimapa-ruta-plano`,
//   · las MISMAS utilidades anti-desborde: `w-full overflow-hidden min-w-0`,
//   · el mismo atributo `data-minimapa-ruta`,
//   · el mismo `style` con `--minimapa-aspecto-ratio` (proporción REAL
//     ancho/alto del lienzo), que da el alto elástico al host.
//
// El look (fondo crema, muros negros nítidos, puntas redondeadas y sectores
// fusionados como un único contorno) lo aportan el MOTOR SVG (lib/minimapa.ts →
// minimapaSectoresSvg) y la hoja propia del componente
// (styles/minimapa-ruta.css). Por eso la pantalla que consume esta fábrica DEBE
// tener esa hoja montada (importada por ella o por un `<MinimapaRuta />` de su
// árbol de componentes): sin ella el host queda sin `aspect-ratio` y el plano
// se ve descalzado.
//
// REGLA: ninguna pantalla ni módulo declara su propio <div> de plano. Cero
// divs manuales duplicados del componente global.
// =============================================================================

import { ASPECTO_LIENZO } from './minimapa';

/** Clases canónicas del host del plano (idénticas a components/MinimapaRuta.astro). */
const CLASES_HOST_PLANO = 'minimapa-ruta minimapa-ruta-plano w-full overflow-hidden min-w-0';

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
