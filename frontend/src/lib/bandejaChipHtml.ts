// =============================================================================
// RENDER DE LOS CHIPS DE LA CANASTA «🧺 ELEMENTOS POR UBICAR»
// -----------------------------------------------------------------------------
// Módulo PURO de presentación (devuelve HTML, no toca el DOM ni hace fetch) con
// los chips de la canasta y el contenedor de cada grupo de la cascada.
//
// Se extrajo de bandejaSinUbicar.ts para sostener el límite de 400 líneas por
// archivo cuando se sumó el rótulo «· En tránsito» de los objetos registrados en
// el limbo de mudanza (los que NO tienen espacio físico fijo).
// =============================================================================

import { escapeHtml } from './mapaJerarquico';

/** Chip de la canasta: un bulto arrastrable (caja o objeto). */
export interface ChipBandeja {
  id: string;
  nombre: string;
  tipo: 'contenedor' | 'objeto';
  img: string;
  /** 🔴 Ubicado y pendiente: entró por «reubicación urgente» (tránsito interno o bloque monolítico). */
  urgente: boolean;
  /**
   * 🧳 EN TRÁNSITO: el bulto está registrado en la zona VIRTUAL «En Tránsito»
   * (limbo de mudanza), no en un espacio físico. El chip lo rotula para que el
   * operador sepa por qué aparece en la barra y pueda arrastrarlo a una caja.
   */
  enTransito?: boolean;
}

/** Grupo de la cascada (orden secuencial de la canasta). */
export interface GrupoChips {
  clave: string;
  titulo: string;
  chips: ChipBandeja[];
}

export function chipHtml(chip: ChipBandeja): string {
  const claseImg =
    chip.tipo === 'objeto' ? 'bandeja-chip-img bandeja-chip-img-objeto' : 'bandeja-chip-img';
  const eco = chip.tipo === 'contenedor' ? '📦' : '🧸';
  // Los elementos ubicados entran a la canasta por REUBICACIÓN URGENTE: el
  // tooltip lo explica para que el operador sepa POR QUÉ está listado.
  const pendiente = chip.urgente ? ' 🔴' : '';
  // 🧳 RÓTULO «EN TRÁNSITO»: el libro recién registrado en la zona virtual
  // «En Tránsito» no tiene espacio físico; el chip lo dice para que se entienda
  // que está acá para ser asignado a un espacio o a una caja.
  const transito = chip.enTransito ? ' · En tránsito' : '';
  const ayuda = chip.enTransito
    ? `«${chip.nombre}» está EN TRÁNSITO (no tiene espacio físico fijo): arrastralo a una caja, a un espacio o al bloque de la izquierda para asignarlo.`
    : chip.urgente
      ? `«${chip.nombre}» está ubicado pero necesita reubicación urgente (en tránsito interno o dentro de un bloque monolítico): arrastralo a un contenedor, a un casillero o al bloque de la izquierda.`
      : `Arrastrá «${chip.nombre}» hacia un contenedor, un casillero o el bloque de la izquierda para ubicarlo.`;
  return `<span class="bandeja-chip" draggable="true" data-bandeja-dnd="${chip.id}" data-bandeja-tipo="${chip.tipo}" title="${escapeHtml(ayuda)}">
    <img src="${chip.img}" alt="" class="${claseImg}" draggable="false" />
    <span class="bandeja-chip-nombre">${eco} ${escapeHtml(chip.nombre)}${pendiente}${escapeHtml(transito)}</span>
  </span>`;
}

export function grupoHtml(grupo: GrupoChips): string {
  const chips = grupo.chips.length
    ? `<div class="bandeja-grupo-chips">${grupo.chips.map(chipHtml).join('')}</div>`
    : '<span class="bandeja-grupo-vacio">Sin elementos en este grupo.</span>';
  return `<section class="bandeja-grupo" data-bandeja-grupo="${grupo.clave}">
    <div class="bandeja-grupo-cab">
      <span class="bandeja-grupo-titulo">${grupo.titulo}</span>
      <span class="bandeja-grupo-num">${grupo.chips.length}</span>
    </div>
    ${chips}
  </section>`;
}
