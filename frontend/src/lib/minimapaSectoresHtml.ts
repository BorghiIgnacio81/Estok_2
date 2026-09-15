// =============================================================================
// MINIMAPA POR SECTORES REALES - RENDER HTML / PORCENTAJES CSS DINÁMICOS
// -----------------------------------------------------------------------------
// Hermano HTML de `minimapaSectoresSvg`: pinta los MISMOS sectores geométricos
// (ui_left/ui_top/ui_width/ui_height en % del lienzo persistidos en PostgreSQL)
// pero con cajas CSS absolutas, de modo que el plano se adapte al ancho real de
// su tarjeta SIN deformar proporciones: el `aspect-ratio` del contenedor replica
// el del lienzo real. Ningún ambiente se dibuja como un cuadradito idéntico: un
// pasillo fino y largo, una suite grande o un baño compacto conservan su silueta.
//
// Es el render de los minimapas INICIALES de planta del Visor de Habitación
// (columna derecha), donde cada ambiente muestra además su icono contextual
// (🚽 🛏️ 🗄️ 🏠) en miniatura nítida: el emoji sólo se dibuja cuando el sector es
// lo bastante grande (umbrales ICONO_MIN_*), evitando solapamientos ilegibles en
// espacios muy chicos.
//
// Color: hereda la convención común de los planos (ámbar #fef3c7 texturizado en
// `.minimapa-proporcional-sector`); el sector activo va en COLOR_NARANJA
// (#f97316), igual que el render SVG. 100% render puro (sin estado ni DOM).
// La hoja de estilos vive en src/styles/almacenamiento-escenas.css.
// =============================================================================

import { ASPECTO_LIENZO } from './minimapa';
import { sectoresAcotados } from './sectoresProporcionales';
import type { SectorGeometrico } from './sectoresProporcionales';
import { escapeHtml } from './mapaJerarquico';

/** Umbral mínimo del sector (en % del lienzo) para dibujar su icono contextual. */
const ICONO_MIN_ANCHO = 15;
const ICONO_MIN_ALTO = 13;

export interface MinimapaSectoresHtmlOpts {
  sectores: readonly SectorGeometrico[];
  /** Relación alto/ancho del lienzo real (evita deformar las proporciones). */
  aspecto?: number;
  /** Mensaje del estado vacío cuando ningún sector tiene geometría real. */
  textoVacio?: string;
}

/**
 * Plano proporcional en HTML/CSS: un lienzo texturizado con `aspect-ratio` real
 * que contiene un `<span>` absoluto por ambiente con sus porcentajes exactos.
 */
export function minimapaSectoresHtml(opts: MinimapaSectoresHtmlOpts): string {
  const sectores = sectoresAcotados(opts.sectores);
  const aspecto = Math.max(0.35, Math.min(1.8, Number(opts.aspecto) || ASPECTO_LIENZO));
  // aspect-ratio CSS = ancho / alto (el aspecto se recibe alto/ancho).
  const estilo = `aspect-ratio:${(1 / aspecto).toFixed(3)} / 1`;

  if (!sectores.length) {
    return `<span class="minimapa-proporcional minimapa-proporcional-vacio" style="${estilo}">${escapeHtml(
      opts.textoVacio ?? 'Sin ambientes todavía',
    )}</span>`;
  }

  const cajas = sectores.map((s) => {
    const icono =
      s.icono && s.width >= ICONO_MIN_ANCHO && s.height >= ICONO_MIN_ALTO
        ? `<span class="minimapa-proporcional-ico" aria-hidden="true">${escapeHtml(s.icono)}</span>`
        : '';
    return `<span class="minimapa-proporcional-sector${
      s.activo ? ' minimapa-proporcional-sector-activo' : ''
    }" style="left:${s.left.toFixed(2)}%;top:${s.top.toFixed(2)}%;width:${s.width.toFixed(
      2,
    )}%;height:${s.height.toFixed(2)}%" title="${escapeHtml(s.nombre || 'Espacio del plano')}">${icono}</span>`;
  });

  return `<span class="minimapa-proporcional" style="${estilo}" role="img" aria-label="Plano proporcional de ${sectores.length} ambiente(s) con su silueta real">${cajas.join(
    '',
  )}</span>`;
}
