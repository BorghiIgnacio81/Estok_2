// =============================================================================
// RENDER DE LAS PESTAÑAS Y DE LOS CHIPS DE LA CANASTA «🧺 ELEMENTOS POR UBICAR»
// -----------------------------------------------------------------------------
// Módulo PURO de presentación (devuelve HTML, no toca el DOM ni hace fetch) con
// la barra de las CUATRO PESTAÑAS de la canasta, el panel de la pestaña activa y
// los chips de cada bulto.
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
  /**
   * 🧳 EN TRÁNSITO: el bulto está registrado en la zona VIRTUAL «En Tránsito»
   * (limbo de mudanza) o sin espacio físico asignado. El chip lo rotula para
   * que el operador sepa POR QUÉ aparece en la pestaña y pueda arrastrarlo.
   */
  enTransito?: boolean;
}

/** Pestaña de la canasta (orden secuencial EXACTO 1 → 4). */
export interface GrupoChips {
  clave: string;
  /** Rótulo visible de la pestaña («1 · Objetos sueltos»). */
  titulo: string;
  /** Regla de la pestaña, expuesta como tooltip de la solapa. */
  descripcion: string;
  chips: ChipBandeja[];
}

/** Ficha de detalle del bulto (objeto → /objetos/:id · caja → /contenedores/:id). */
function fichaDe(chip: ChipBandeja): string {
  return chip.tipo === 'contenedor'
    ? `/contenedores/${encodeURIComponent(chip.id)}`
    : `/objetos/${encodeURIComponent(chip.id)}`;
}

export function chipHtml(chip: ChipBandeja): string {
  const claseImg =
    chip.tipo === 'objeto' ? 'bandeja-chip-img bandeja-chip-img-objeto' : 'bandeja-chip-img';
  const eco = chip.tipo === 'contenedor' ? '📦' : '🧸';
  // 🧳 RÓTULO «EN TRÁNSITO»: el bulto registrado en la zona virtual «En Tránsito»
  // no tiene espacio físico; el chip lo dice para que se entienda que está acá
  // para ser asignado a un espacio o a una caja.
  const transito = chip.enTransito ? ' · En tránsito' : '';
  const ayudaBase = chip.enTransito
    ? `«${chip.nombre}» está EN TRÁNSITO (no tiene espacio físico fijo): arrastralo a una caja, a un espacio o al bloque de la izquierda para asignarlo.`
    : `Arrastrá «${chip.nombre}» hacia un contenedor, un casillero o el bloque de la izquierda para ubicarlo.`;
  // CLIC EN EL CHIP: abre la ficha de detalle del bulto (la de la caja lleva a
  // su inventario interno completo). El arrastre sigue intacto: el handler de
  // clic ignora el gesto cuando hubo dragstart (ver bandejaSinUbicar.ts).
  const ayuda = `${ayudaBase} Clic para abrir su ficha de detalle.`;
  return `<span class="bandeja-chip" draggable="true" data-bandeja-dnd="${chip.id}" data-bandeja-tipo="${chip.tipo}" data-bandeja-abrir="${escapeHtml(fichaDe(chip))}" role="link" tabindex="0" title="${escapeHtml(ayuda)}">
    <img src="${chip.img}" alt="" class="${claseImg}" draggable="false" />
    <span class="bandeja-chip-nombre">${eco} ${escapeHtml(chip.nombre)}${escapeHtml(transito)}</span>
  </span>`;
}

/**
 * BARRA DE LAS CUATRO PESTAÑAS (solapas con contador por pestaña).
 *
 * `activa` es la clave de la pestaña seleccionada; si no existe en `grupos` la
 * primera pasa a serlo (la canasta nunca queda sin contenido visible).
 */
export function pestanasHtml(grupos: GrupoChips[], activa: string): string {
  const claveActiva = grupos.some((g) => g.clave === activa) ? activa : grupos[0]?.clave ?? '';
  const botones = grupos
    .map((grupo) => {
      const seleccionada = grupo.clave === claveActiva;
      const clases = seleccionada ? 'bandeja-pestana bandeja-pestana-activa' : 'bandeja-pestana';
      return `<button type="button" role="tab" class="${clases}" data-bandeja-pestana="${grupo.clave}" aria-selected="${seleccionada ? 'true' : 'false'}" title="${escapeHtml(grupo.descripcion)}">
        <span class="bandeja-pestana-titulo">${escapeHtml(grupo.titulo)}</span>
        <span class="bandeja-pestana-num">${grupo.chips.length}</span>
      </button>`;
    })
    .join('');
  return `<div class="bandeja-pestanas" role="tablist" aria-label="Pestañas de Elementos por ubicar">${botones}</div>`;
}

/** Panel de UNA pestaña (sus chips en grilla o el aviso de pestaña vacía). */
export function grupoHtml(grupo: GrupoChips): string {
  const chips = grupo.chips.length
    ? `<div class="bandeja-grupo-chips">${grupo.chips.map(chipHtml).join('')}</div>`
    : '<span class="bandeja-grupo-vacio">Sin elementos en esta pestaña.</span>';
  return `<section class="bandeja-grupo" data-bandeja-grupo="${grupo.clave}" role="tabpanel" aria-label="${escapeHtml(grupo.titulo)}">
    ${chips}
  </section>`;
}
