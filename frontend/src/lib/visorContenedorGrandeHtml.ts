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

import { escapeHtml } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';
import { iconoContenedorVisor } from './visorHabitacionHtml';
import { renderLienzoElastico } from './mapaPlantaUnica';
import type { ItemElastico } from './lienzoElastico';

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
  /** Marca manual de clausura: el casillero F·C del mueble está físicamente lleno. */
  espacio_lleno?: boolean;
  subcontenedores_count?: number;
  /** Medidas visuales + geometría elástica de la estantería/caja (rectángulo libre). */
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
  /** ID relacional del grupo de fusión (estantes en "L"). */
  fusion_grupo?: string | null;
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
  /** Contenedores RAÍZ de la habitación (lienzo elástico del estado vacío). */
  raices: ItemElastico[];
}

// =============================================================================
// HELPERS
// =============================================================================

/** Visual contextual de la ficha: emoji (🗄️ Ropero / 🛏️ Cama) o icono por defecto. */
function fichaVisualHtml(nombre: string, clase: string): string {
  const ico = iconoContenedorVisor(nombre);
  return ico
    ? `<span class="${clase} ${clase}-emoji" aria-hidden="true">${ico}</span>`
    : `<img src="${IMG_MUEBLE}" alt="" class="${clase}" draggable="false" />`;
}

/** Objetos sueltos colgados directamente del mueble (chips arrastrables a la bandeja). */
function muebleObjetosHtml(m: MuebleVisor, objs: SubObjVisor[]): string {
  const directos = objs.filter((o) => o.contenedor === m.id);
  if (!directos.length) return '';
  return `<div class="mueble-objetos-sueltos">
    <span class="mueble-objetos-titulo">Objetos sueltos</span>
    ${directos
      .map(
        (o) => `<span class="mueble-item mueble-item-objeto" draggable="true" data-mueble-obj-dnd="${o.id}" title="Arrastrá «${escapeHtml(o.nombre)}» para reacomodarlo o extraerlo a la bandeja">
        <img src="${IMG_OBJETO}" alt="" class="mueble-item-img mueble-item-img-objeto" draggable="false" />
        <span class="mueble-item-nombre">${escapeHtml(o.nombre)}</span>
      </span>`,
      )
      .join('')}
  </div>`;
}


/** Lienzo 2D elástico del interior del mueble (estantes/cajones como rectángulos libres). */
function muebleLienzoHtml(m: MuebleVisor, conts: SubContVisor[]): string {
  const items: ItemElastico[] = conts
    .filter((x) => x.parent_contenedor === m.id)
    .map((x) => ({
      id: x.id,
      nombre: x.nombre,
      ui_left: x.ui_left,
      ui_top: x.ui_top,
      ui_width: x.ui_width,
      ui_height: x.ui_height,
      fusion_grupo: x.fusion_grupo,
      meta: x.es_inmueble ? '📌 fijo' : null,
    }));
  return renderLienzoElastico({
    items,
    etiquetaCrear: 'Estante',
    textoVacio: 'Este mueble todavía no tiene estantes/cajones. Usá «➕ Estante» para fundar el primero.',
    tip: '🧩 <strong>Interior elástico</strong> · arrastrá cada estante para reacomodarlo, estirá de la esquina, renombrá con clic y <strong>seleccioná 2+ para fusionarlos</strong> en un único espacio con geometría en «L».',
  });
}


/** Tarjeta completa de un mueble (ficha + grilla interna). */
export function muebleCardHtml(
  m: MuebleVisor,
  conts: SubContVisor[],
  objs: SubObjVisor[],
  opts: { abrible?: boolean; conControles?: boolean } = {},
): string {
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
    </div>
    <div class="mueble-grilla">${muebleLienzoHtml(m, conts)}${muebleObjetosHtml(m, objs)}</div>
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
  const { room, muebles, subContenedores, subObjetos, muebleActivoId, raices } = opts;
  if (!room) return '';

  const cabecera = `
    <div class="cg-cabecera">
      <span class="cg-titulo">🧱 Muebles de «${escapeHtml(room.nombre)}»</span>
      <span class="cg-sub">Elegí un mueble en el Visor de Habitación (izquierda) o con el conmutador para inspeccionar su ficha y su distribución interna. Los casilleros reciben elementos por Drag &amp; Drop.</span>
    </div>`;

  // REGLA DE INICIALIZACIÓN: una habitación SIN muebles NUNCA deja el panel
  // derecho en blanco. Se monta en el acto el MISMO lienzo editor elástico que
  // usamos para las plantas (rectángulos libres) con el botón visible
  // «➕ Crear mueble aquí», para modelar la distribución interna en caliente.
  if (!muebles.length) {
    return `${cabecera}
      <div class="cg-vacio-editor">
        <p class="cg-vacio-texto">Esta habitación todavía no tiene muebles/archivadores. Modelá su interior en caliente: creá el primer mueble y acomodalo en el lienzo.</p>
        ${renderLienzoElastico({
          items: raices,
          etiquetaCrear: 'Crear mueble aquí',
          textoVacio: 'Sin muebles todavía. Usá «➕ Crear mueble aquí» para inyectar el primero.',
          tip: '🧱 Editor interno de la habitación · mismo motor 2D elástico que los planos de planta.',
        })}
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

