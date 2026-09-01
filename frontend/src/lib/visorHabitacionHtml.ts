// =============================================================================
// VISOR DE HABITACIÓN - helpers de render PUROS
// -----------------------------------------------------------------------------
// Funciones sin estado para el Visor (columna derecha): contenido de celdas
// con iconografía contextual de tercer nivel (Ropero 🗄️ / Cama 🛏️ / archivador),
// botón de edición ✏️, cuerpo de la habitación con las CUATRO paredes Drop Zone
// y la paleta de la puerta arrastrable 🚪.
// Consumido únicamente por src/lib/visorHabitacion.ts.
// =============================================================================

import { escapeHtml } from './mapaJerarquico';
import { minimapaCasitaSvg } from './minimapa';

// Iconografía local estricta del Lienzo de Mapeo Espacial.
const IMG_CONTENEDOR_GRANDE = '/archivador-login.png';
const IMG_CONTENEDOR_PEQUENO = '/Nuevo Contenedor.png';
const IMG_OBJETO = '/fluffy_plush_ball.jpg';

export { IMG_OBJETO };

export interface ItemCeldaVisor {
  id: string;
  nombre: string;
  subcontenedores_count?: number;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  /** Mueble inmueble fijo: no se arrastra ni elimina. */
  es_inmueble?: boolean;
}

export interface ObjetoCeldaVisor {
  id: string;
  nombre: string;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
}

/** Etiquetas legibles de las cuatro paredes (posicion_puerta). */
export const ETIQUETAS_PARED: Record<string, string> = {
  TOP: 'superior',
  BOTTOM: 'inferior',
  LEFT: 'izquierda',
  RIGHT: 'derecha',
};

/** Icono contextual de tercer nivel para contenedores internos del Visor. */
export function iconoContenedorVisor(nombre: string): string {
  const n = (nombre || '').trim().toLowerCase();
  if (n.startsWith('ropero')) return '🗄️';
  if (n.startsWith('cama')) return '🛏️';
  return '';
}

/** Contenido de una celda del Visor (contenedores y objetos con esa coordenada). */
export function celdaVisorContenidoHtml(
  conts: ItemCeldaVisor[],
  objs: ObjetoCeldaVisor[],
  r: number,
  c: number,
): string {
  const contsCelda = conts.filter((x) => x.parent_grid_row === r && x.parent_grid_col === c);
  const objsCelda = objs.filter((x) => x.parent_grid_row === r && x.parent_grid_col === c);
  if (!contsCelda.length && !objsCelda.length) return '<span class="visor-celda-vacia">＋</span>';

  const contsHtml = contsCelda
    .map((x) => {
      const img = (x.subcontenedores_count || 0) > 0 ? IMG_CONTENEDOR_GRANDE : IMG_CONTENEDOR_PEQUENO;
      const ico = iconoContenedorVisor(x.nombre);
      const visual = ico
        ? `<span class="visor-celda-emoji">${ico}</span>`
        : `<img src="${img}" alt="${escapeHtml(x.nombre)}" class="h-16 w-auto draggable" draggable="false" />`;
      return `<div class="visor-celda-cont" data-contenedor-id="${x.id}" draggable="${x.es_inmueble ? 'false' : 'true'}" title="${escapeHtml(x.nombre)}${x.es_inmueble ? ' · 📌 Mueble inmueble fijo (no mudable)' : ' · Arrastrá para reacomodar en otro casillero'}">
        ${x.es_inmueble ? '<span class="visor-celda-fijo" title="Mueble inmueble fijo">📌</span>' : ''}
        <button type="button" class="visor-celda-editar" data-editar-contenedor-visor="${x.id}" title="Editar «${escapeHtml(x.nombre)}»">✏️</button>
        ${visual}
        <span class="visor-celda-nombre">${escapeHtml(x.nombre)}</span>
      </div>`;
    })
    .join('');
  const objsHtml = objsCelda
    .map(
      (x) =>
        `<img src="${IMG_OBJETO}" alt="${escapeHtml(x.nombre)}" class="h-12 w-12 rounded-full draggable" draggable="false" title="${escapeHtml(x.nombre)}" />`,
    )
    .join('');
  return `${contsHtml}${objsHtml}`;
}

/** Cuerpo de la habitación: grilla rodeada por las CUATRO paredes Drop Zone. */
export function cuerpoConParedesHtml(filasHtml: string, puerta: string | null): string {
  return `
    <div class="visor-habitacion-cuerpo">
      <div class="visor-pared visor-pared-top${puerta === 'TOP' ? ' visor-pared-con-puerta' : ''}" data-visor-pared="TOP" title="Soltá la puerta en la pared superior">
        ${puerta === 'TOP' ? '<span class="visor-puerta-indicador">🚪</span>' : ''}
      </div>
      <div class="visor-pared-medio">
        <div class="visor-pared visor-pared-left${puerta === 'LEFT' ? ' visor-pared-con-puerta' : ''}" data-visor-pared="LEFT" title="Soltá la puerta en la pared izquierda">
          ${puerta === 'LEFT' ? '<span class="visor-puerta-indicador">🚪</span>' : ''}
        </div>
        <div class="visor-grid">${filasHtml}</div>
        <div class="visor-pared visor-pared-right${puerta === 'RIGHT' ? ' visor-pared-con-puerta' : ''}" data-visor-pared="RIGHT" title="Soltá la puerta en la pared derecha">
          ${puerta === 'RIGHT' ? '<span class="visor-puerta-indicador">🚪</span>' : ''}
        </div>
      </div>
      <div class="visor-pared visor-pared-bottom${puerta === 'BOTTOM' ? ' visor-pared-con-puerta' : ''}" data-visor-pared="BOTTOM" title="Soltá la puerta en la pared inferior">
        ${puerta === 'BOTTOM' ? '<span class="visor-puerta-indicador">🚪</span>' : ''}
      </div>
    </div>`;
}

/** Paleta inferior con el componente "🚪 Puerta" arrastrable. */
export function paletaPuertaHtml(): string {
  return `
    <div class="visor-puerta-paleta">
      <span class="visor-puerta-paleta-titulo">Acomodar puerta</span>
      <div class="visor-puerta-drag" draggable="true" data-puerta-drag title="Arrastrá la puerta hacia una de las cuatro paredes">🚪 Puerta</div>
    </div>`;
}

/** Formatea las medidas "Alto × Ancho × Largo (cm)" de una habitación. */
export function medidasDe(room: {
  alto?: string | number | null;
  ancho?: string | number | null;
  largo?: string | number | null;
}): string | null {
  const valores = [room.alto, room.ancho, room.largo].filter(
    (v) => v !== null && v !== undefined && v !== '',
  ) as Array<string | number>;
  if (!valores.length) return null;
  return `${valores.map((v) => String(Number(v))).join(' × ')} cm`;
}

/** Minimapa de planta con la MISMA silueta de casa que el "Mapa Estok". */
export function minimapaPlantaHtml(
  division: { filas: number; nombre: string } | null,
  fila: number | null | undefined,
  columna: number | null | undefined,
): string {
  if (!division || !fila) return '';
  return `<div class="visor-minimapa-planta" title="Planta: ${escapeHtml(division.nombre)} · Cuadrante F${fila}·C${columna || '—'}">
    <span class="visor-minimapa-titulo">📍 Planta · ${escapeHtml(division.nombre)}</span>
    ${minimapaCasitaSvg({ filas: division.filas, filaActiva: fila })}
    <span class="visor-minimapa-detalle">Cuadrante F${fila}·C${columna || '—'}</span>
  </div>`;
}
