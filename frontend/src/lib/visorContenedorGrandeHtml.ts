// =============================================================================
// VISOR CONTENEDOR GRANDE - helpers de render PUROS
// -----------------------------------------------------------------------------
// Funciones sin estado que dibujan el contenido del panel derecho de la
// ESCENA 3 (Visor Contenedor Grande): la ficha y la distribución interna del
// mueble inspeccionado con conmutador de muebles en caliente, el listado
// inicial de todos los muebles y la botonera agrupada +/− al final de cada fila
// (el «+» suma una división/columna; el «−» borra la ÚLTIMA división/columna de
// esa línea). Las celdas internas quedan limpias para el Drag & Drop: no llevan
// botones de borrado ni lápices secundarios. Consumido únicamente por
// src/lib/visorContenedorGrande.ts (persistencia y eventos viven allá).
// =============================================================================

import { escapeHtml, filasInternasDe, columnasDeFilaInterna } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';
import { minimapaRectangularSvg } from './minimapa';
import { iconoContenedorVisor } from './visorHabitacionHtml';

const IMG_MUEBLE = '/archivador-login.png';
const IMG_OBJETO = '/fluffy_plush_ball.jpg';

// =============================================================================
// TIPOS (compartidos con visorContenedorGrande.ts)
// =============================================================================

export interface MuebleVisor {
  id: string;
  nombre: string;
  es_inmueble?: boolean;
  grid_filas?: number | null;
  grid_columnas?: number | null;
  grid_filas_config?: number[] | null;
  subcontenedores_count?: number;
  objetos_count?: number;
}

export interface SubContVisor {
  id: string;
  nombre: string;
  parent_contenedor?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  es_inmueble?: boolean;
  subcontenedores_count?: number;
  /** Medidas visuales de la estantería/caja (resizing recursivo, PUT ui_*). */
  ui_width?: string | null;
  ui_height?: string | null;
}

export interface SubObjVisor {
  id: string;
  nombre: string;
  contenedor?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
}

export interface OpcionesVisorContenido {
  room: UbicacionPlano | null;
  muebles: MuebleVisor[];
  subContenedores: SubContVisor[];
  subObjetos: SubObjVisor[];
  muebleActivoId: string | null;
}

// =============================================================================
// HELPERS
// =============================================================================

function columnasPorFilaDeMueble(m: MuebleVisor): number[] {
  const div = m as unknown as UbicacionPlano;
  const filas = filasInternasDe(div);
  return Array.from({ length: filas }, (_, i) => columnasDeFilaInterna(div, i + 1));
}

/** Visual contextual de la ficha: emoji (🗄️ Ropero / 🛏️ Cama) o icono por defecto. */
function fichaVisualHtml(nombre: string, clase: string): string {
  const ico = iconoContenedorVisor(nombre);
  return ico
    ? `<span class="${clase} ${clase}-emoji" aria-hidden="true">${ico}</span>`
    : `<img src="${IMG_MUEBLE}" alt="" class="${clase}" draggable="false" />`;
}

/** Contenido de un casillero interno del mueble (sub-contenedores, objetos o ➕). */
function celdaMuebleContenidoHtml(
  muebleId: string,
  r: number,
  c: number,
  conts: SubContVisor[],
  objs: SubObjVisor[],
): string {
  if (!conts.length && !objs.length) {
    return `<button type="button" class="mueble-celda-crear" data-mueble-celda-crear data-mueble-id="${muebleId}" data-mueble-row="${r}" data-mueble-col="${c}" title="Fundar una sub-división (estante/cajón) en F${r}·C${c} de este mueble">➕</button>`;
  }

  // Grilla LIMPIA para el Drag & Drop: las celdas/estantes NO llevan botones de
  // borrado ni lápices secundarios. La única botonera de control (+/−) vive
  // agrupada al extremo derecho de cada fila, por fuera de la zona de soltado.
  const contsHtml = conts
    .map((x) => {
      const uiW = x.ui_width && x.ui_width !== '100%' ? x.ui_width : null;
      const uiH = x.ui_height && x.ui_height !== 'auto' ? x.ui_height : null;
      const estilosUI = uiW || uiH
        ? `style="${uiW ? `width:${uiW};` : ''}${uiH ? `height:${uiH};` : ''}"`
        : '';
      return `<span class="mueble-item" data-inplace-card data-id="${x.id}" ${estilosUI} data-mueble-sub-dnd="${x.id}" draggable="true" title="Arrastrá «${escapeHtml(x.nombre)}» para reacomodarlo o extraerlo a la bandeja. Clic en el nombre para renombrar · tirá de la esquina para estirar">
        <img src="${IMG_MUEBLE}" alt="" class="mueble-item-img" draggable="false" />
        <span class="mueble-item-nombre casita-renombrable" data-inplace-renombrar data-id="${x.id}" title="Clic para renombrar esta estantería en caliente">${escapeHtml(x.nombre)}</span>
        ${x.es_inmueble ? '<span class="mueble-item-fijo">📌</span>' : ''}
        <span class="mueble-item-resize" data-inplace-resize data-id="${x.id}" title="Estirar para cambiar el tamaño visual (se guarda automáticamente)"></span>
      </span>`;
    })
    .join('');

  const objsHtml = objs
    .map(
      (x) => `<span class="mueble-item" data-mueble-obj-dnd="${x.id}" draggable="true" title="Arrastrá «${escapeHtml(x.nombre)}» para reacomodarlo o extraerlo a la bandeja">
        <img src="${IMG_OBJETO}" alt="" class="mueble-item-img mueble-item-img-objeto" draggable="false" />
        <span class="mueble-item-nombre">${escapeHtml(x.nombre)}</span>
      </span>`,
    )
    .join('');

  return `${contsHtml}${objsHtml}`;
}


/** Grilla interna asimétrica del mueble, con controles opcionales por fila. */
function muebleGrillaHtml(
  m: MuebleVisor,
  conts: SubContVisor[],
  objs: SubObjVisor[],
  conControles: boolean,
): string {
  const div = m as unknown as UbicacionPlano;
  const filas = filasInternasDe(div);
  const colsPorFila = columnasPorFilaDeMueble(m);
  const filasHtml: string[] = [];

  for (let r = 1; r <= filas; r++) {
    const cols = colsPorFila[r - 1] || 1;
    const celdas: string[] = [];

    for (let c = 1; c <= cols; c++) {
      const contsCelda = conts.filter(
        (x) => x.parent_contenedor === m.id && x.parent_grid_row === r && x.parent_grid_col === c,
      );
      const objsCelda = objs.filter(
        (x) => x.contenedor === m.id && x.parent_grid_row === r && x.parent_grid_col === c,
      );
      celdas.push(`<div class="mueble-celda" data-mueble-celda data-mueble-id="${m.id}" data-mueble-row="${r}" data-mueble-col="${c}" title="Casillero F${r}·C${c} — soltá aquí un elemento o usá ➕ para fundar una sub-división">
        ${celdaMuebleContenidoHtml(m.id, r, c, contsCelda, objsCelda)}
      </div>`);
    }

    const grilla = `<div class="mueble-fila" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));">${celdas.join('')}</div>`;

    if (!conControles) {
      filasHtml.push(grilla);
      continue;
    }

    // Botonera AGRUPADA de control al EXTREMO DERECHO de cada fila, por FUERA de
    // la grilla (no interfiere con las Drop Zones del Drag & Drop interno):
    //   · Botón AGREGAR (+): círculo verde → suma una división/columna vacía.
    //   · Botón RESTAR (−):  círculo rojo → borra la ÚLTIMA división/columna de
    //                        la fila. Solo visible cuando la fila tiene más de 1
    //                        columna (una fila de 1 celda no puede contraerse).
    // Clases Tailwind explícitas (mismo tamaño circular h-8 w-8) y z-20 para
    // garantizar visibilidad y evitar recortes por desbordamiento del padre.
    const quitarHtml = cols > 1
      ? `<button type="button" class="flex-shrink-0 bg-red-600 hover:bg-red-700 text-white font-bold rounded-full h-8 w-8 flex items-center justify-center text-lg transition-all cursor-pointer relative z-20" data-mueble-fila-quitar data-mueble-id="${m.id}" data-mueble-row="${r}" title="Eliminar la última división/columna de la fila ${r} de «${escapeHtml(m.nombre)}» — su contenido quedará sin ubicación en la bandeja de «por ubicar»">−</button>`
      : '';
    filasHtml.push(`
      <div class="mueble-fila-linea">
        <div class="mueble-fila-contenido">
          <span class="mueble-fila-tag">Fila ${r} · ${cols} casillero${cols === 1 ? '' : 's'}</span>
          ${grilla}
        </div>
        <div class="flex items-center gap-2 ml-4 flex-shrink-0">
          <button type="button" class="flex-shrink-0 bg-green-600 hover:bg-green-700 text-white font-bold rounded-full h-8 w-8 flex items-center justify-center text-lg transition-all cursor-pointer relative z-20" data-mueble-fila-agregar data-mueble-id="${m.id}" data-mueble-row="${r}" title="Agregar una división/columna vacía a la fila ${r} de «${escapeHtml(m.nombre)}»">+</button>
          ${quitarHtml}
        </div>
      </div>`);
  }

  return filasHtml.join('');
}


/** Tarjeta completa de un mueble (ficha + grilla interna). */
export function muebleCardHtml(
  m: MuebleVisor,
  conts: SubContVisor[],
  objs: SubObjVisor[],
  opts: { abrible?: boolean; conControles?: boolean } = {},
): string {
  const div = m as unknown as UbicacionPlano;
  const filas = filasInternasDe(div);
  const colsPorFila = columnasPorFilaDeMueble(m);
  const abrirHtml = opts.abrible
    ? `<button type="button" class="cg-mueble-abrir" data-mueble-abrir="${m.id}" title="Inspeccionar la ficha y distribución interna de «${escapeHtml(m.nombre)}»">🔍 Abrir ficha</button>`
    : '';

  return `<div class="mueble-card" data-mueble-card="${m.id}">
    <div class="mueble-cabecera">
      <div class="mueble-ficha">
        ${fichaVisualHtml(m.nombre, 'mueble-ico')}
        <div class="mueble-info">
          <strong class="mueble-nombre">${escapeHtml(m.nombre)}</strong>
          <span class="mueble-meta">${m.subcontenedores_count || 0} sub-contenedores · ${m.objetos_count || 0} objetos</span>
        </div>
      </div>
      ${m.es_inmueble ? '<span class="mueble-inmueble">📌 Mueble fijo</span>' : ''}
      ${abrirHtml}
      <div class="mueble-minimapa" title="Minimapa rectangular de la grilla del mueble">${minimapaRectangularSvg({ filas, columnasPorFila: colsPorFila, filaActiva: null, columnaActiva: null })}</div>
    </div>
    <div class="mueble-grilla">${muebleGrillaHtml(m, conts, objs, Boolean(opts.conControles))}</div>
  </div>`;
}

/** Conmutador de muebles en caliente (chips, visible cuando hay 2+ muebles). */
function conmutadorMueblesHtml(muebles: MuebleVisor[], activoId: string | null): string {
  if (muebles.length < 2) return '';
  return `<div class="cg-conmutador" role="tablist" aria-label="Conmutar mueble activo">
    <span class="cg-conmutador-titulo">Cambiar mueble:</span>
    ${muebles
      .map((m) => {
        const ico = iconoContenedorVisor(m.nombre);
        const activo = m.id === activoId;
        return `<button type="button" role="tab" aria-selected="${activo ? 'true' : 'false'}" class="cg-chip${activo ? ' cg-chip-activo' : ''}" data-mueble-chip="${m.id}" title="${activo ? 'Mueble activo: ' : 'Ver '}«${escapeHtml(m.nombre)}»">
          ${ico ? `<span class="cg-chip-ico" aria-hidden="true">${ico}</span>` : ''}
          <span class="cg-chip-nombre">${escapeHtml(m.nombre)}</span>
        </button>`;
      })
      .join('')}
  </div>`;
}

/** Cuerpo completo del Visor Contenedor Grande según el estado de la ESCENA 3. */
export function visorContenidoGrandeHtml(opts: OpcionesVisorContenido): string {
  const { room, muebles, subContenedores, subObjetos, muebleActivoId } = opts;
  if (!room) return '';

  const cabecera = `
    <div class="cg-cabecera">
      <span class="cg-titulo">🧱 Muebles de «${escapeHtml(room.nombre)}»</span>
      <span class="cg-sub">Elegí un mueble en el Visor de Habitación (izquierda) o con el conmutador para inspeccionar su ficha y su distribución interna. Los casilleros reciben elementos por Drag &amp; Drop.</span>
    </div>`;

  if (!muebles.length) {
    return `${cabecera}
      <div class="cg-vacio">
        <span class="cg-vacio-ico">📦</span>
        <p class="cg-vacio-texto">Esta habitación no tiene muebles/archivadores todavía. Arrastrá contenedores pequeños y objetos desde la bandeja inferior hacia los casilleros cuando existan.</p>
      </div>`;
  }

  const activo = muebleActivoId ? muebles.find((m) => m.id === muebleActivoId) ?? null : null;
  if (activo) {
    // Cabecera viva del Visor Contenedor Grande: cuando hay un mueble activo, el
    // título refleja al instante su distribución interna (selección desde el
    // Visor de Habitación a la izquierda o desde el conmutador de chips).
    const activoCabecera = `
      <div class="cg-cabecera">
        <span class="cg-titulo">🧱 Distribución interna de «${escapeHtml(activo.nombre)}»</span>
        <span class="cg-sub">Mueble inspeccionado en caliente. Usá los botones + y − al final de cada fila para ajustar sus estantes/cajones, o soltá objetos/cajas en un casillero para reubicarlos en el acto.</span>
      </div>`;
    return `${activoCabecera}
      ${conmutadorMueblesHtml(muebles, activo.id)}
      <div class="mueble-detalle">
        <button type="button" class="cg-atras" data-mueble-atras title="Volver al listado de todos los muebles de «${escapeHtml(room.nombre)}»">← Ver todos los muebles</button>
        ${muebleCardHtml(activo, subContenedores, subObjetos, { conControles: true })}
      </div>`;
  }

  return `${cabecera}
    <div class="cg-muebles">${muebles.map((m) => muebleCardHtml(m, subContenedores, subObjetos, { abrible: true, conControles: true })).join('')}</div>`;
}

