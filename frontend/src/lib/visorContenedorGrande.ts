// =============================================================================
// VISOR CONTENEDOR GRANDE (Nivel 3 - Muebles / Archivadores)
// -----------------------------------------------------------------------------
// ESCENA 3 del flujo en cascada: al seleccionar una habitación, el panel
// derecho abre este Visor con los MUEBLES / ARCHIVADORES de esa habitación
// (contenedores con sub-contenedores o marcados como mueble inmueble fijo).
// Cada mueble expone su grilla interna de casilleros como Drop Zones: recibe
// Contenedores Pequeños y Objetos arrastrados desde la bandeja inferior o
// reacomodados entre casilleros. Sin botones "+": la asignación es EXCLUSIVA
// por Drag & Drop. Persistencia multi-tenant estricta (JWT + X-Estok-Id) con
// PUTs asincrónicos de coordenadas enteras (int).
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { escapeHtml, toast, filasInternasDe, columnasDeFilaInterna } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';
import { minimapaRectangularSvg } from './minimapa';

const IMG_MUEBLE = '/archivador-login.png';
const IMG_OBJETO = '/fluffy_plush_ball.jpg';

interface MuebleVisor {
  id: string;
  nombre: string;
  es_inmueble?: boolean;
  grid_filas?: number | null;
  grid_columnas?: number | null;
  grid_filas_config?: number[] | null;
  subcontenedores_count?: number;
  objetos_count?: number;
}
interface SubContVisor {
  id: string;
  nombre: string;
  parent_contenedor?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  es_inmueble?: boolean;
  subcontenedores_count?: number;
}
interface SubObjVisor {
  id: string;
  nombre: string;
  contenedor?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
}

let roomActual: UbicacionPlano | null = null;
let muebles: MuebleVisor[] = [];
let subContenedores: SubContVisor[] = [];
let subObjetos: SubObjVisor[] = [];
let rootEl: HTMLElement | null = null;

// =============================================================================
// HELPERS
// =============================================================================

async function fetchTodos(url: string): Promise<Record<string, unknown>[]> {
  const todos: Record<string, unknown>[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return todos;
    }
    if (!res.ok) return todos;
    const data = await res.json();
    todos.push(...(data.results || data));
    nextUrl = data.next;
  }
  return todos;
}

function columnasPorFilaDeMueble(m: MuebleVisor): number[] {
  const div = m as unknown as UbicacionPlano;
  const filas = filasInternasDe(div);
  return Array.from({ length: filas }, (_, i) => columnasDeFilaInterna(div, i + 1));
}

// =============================================================================
// CARGA DE LA HABITACIÓN ACTIVA
// =============================================================================

async function cargar(): Promise<void> {
  if (!rootEl) return;
  if (!roomActual) {
    muebles = [];
    subContenedores = [];
    subObjetos = [];
    render();
    return;
  }
  const [contData, objData] = await Promise.all([
    fetchTodos(`${API_BASE_URL}/contenedores/?ubicacion=${roomActual.id}&page_size=1000`),
    fetchTodos(`${API_BASE_URL}/objetos/?ubicacion=${roomActual.id}&page_size=1000`),
  ]);

  const conts = contData as Record<string, unknown>[];
  muebles = conts
    .filter((c) => !c.parent_contenedor && ((Number(c.subcontenedores_count) || 0) > 0 || Boolean(c.es_inmueble)))
    .map((c) => ({
      id: String(c.id),
      nombre: String(c.nombre || 'Mueble'),
      es_inmueble: Boolean(c.es_inmueble),
      grid_filas: c.grid_filas != null ? Number(c.grid_filas) : null,
      grid_columnas: c.grid_columnas != null ? Number(c.grid_columnas) : null,
      grid_filas_config: Array.isArray(c.grid_filas_config) ? (c.grid_filas_config as number[]) : null,
      subcontenedores_count: Number(c.subcontenedores_count) || 0,
      objetos_count: Number(c.objetos_count) || 0,
    }));

  subContenedores = conts
    .filter((c) => c.parent_contenedor)
    .map((c) => ({
      id: String(c.id),
      nombre: String(c.nombre || 'Contenedor'),
      parent_contenedor: c.parent_contenedor != null ? String(c.parent_contenedor) : null,
      parent_grid_row: c.parent_grid_row != null ? Number(c.parent_grid_row) : null,
      parent_grid_col: c.parent_grid_col != null ? Number(c.parent_grid_col) : null,
      es_inmueble: Boolean(c.es_inmueble),
      subcontenedores_count: Number(c.subcontenedores_count) || 0,
    }));

  subObjetos = (objData as Record<string, unknown>[])
    .filter((o) => !o.deleted_at && o.contenedor)
    .map((o) => ({
      id: String(o.id),
      nombre: String(o.nombre || 'Objeto'),
      contenedor: o.contenedor != null ? String(o.contenedor) : null,
      parent_grid_row: o.parent_grid_row != null ? Number(o.parent_grid_row) : null,
      parent_grid_col: o.parent_grid_col != null ? Number(o.parent_grid_col) : null,
    }));

  render();
}

// =============================================================================
// RENDER
// =============================================================================

function render(): void {
  if (!rootEl) return;
  if (!roomActual) {
    rootEl.innerHTML = '';
    return;
  }
  if (!muebles.length) {
    rootEl.innerHTML = `<div class="cg-vacio">
      <span class="cg-vacio-ico">📦</span>
      <p class="cg-vacio-texto">Esta habitación no tiene muebles/archivadores todavía. Arrastrá contenedores pequeños y objetos desde la bandeja inferior hacia los casilleros cuando existan.</p>
    </div>`;
    return;
  }
  rootEl.innerHTML = `
    <div class="cg-cabecera">
      <span class="cg-titulo">🧱 Muebles de «${escapeHtml(roomActual.nombre)}»</span>
      <span class="cg-sub">Arrastrá contenedores pequeños y objetos desde la bandeja hacia sus casilleros. Todo se guarda automáticamente.</span>
    </div>
    <div class="cg-muebles">${muebles.map(muebleHtml).join('')}</div>`;
  enlazar();
}

function muebleHtml(m: MuebleVisor): string {
  const div = m as unknown as UbicacionPlano;
  const filas = filasInternasDe(div);
  const columnasPorFila = columnasPorFilaDeMueble(m);

  const filasHtml: string[] = [];
  for (let r = 1; r <= filas; r++) {
    const cols = columnasPorFila[r - 1];
    const celdas: string[] = [];
    for (let c = 1; c <= cols; c++) {
      const conts = subContenedores.filter(
        (x) => x.parent_contenedor === m.id && x.parent_grid_row === r && x.parent_grid_col === c,
      );
      const objs = subObjetos.filter(
        (x) => x.contenedor === m.id && x.parent_grid_row === r && x.parent_grid_col === c,
      );
      celdas.push(`<div class="mueble-celda" data-mueble-celda data-mueble-id="${m.id}" data-mueble-row="${r}" data-mueble-col="${c}" title="Casillero F${r}·C${c} — soltá aquí un elemento">
        ${celdaMuebleContenidoHtml(conts, objs)}
      </div>`);
    }
    filasHtml.push(`<div class="mueble-fila" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));">${celdas.join('')}</div>`);
  }

  return `<div class="mueble-card" data-mueble-card="${m.id}">
    <div class="mueble-cabecera">
      <div class="mueble-ficha">
        <img src="${IMG_MUEBLE}" alt="" class="mueble-ico" draggable="false" />
        <div class="mueble-info">
          <strong class="mueble-nombre">${escapeHtml(m.nombre)}</strong>
          <span class="mueble-meta">${m.subcontenedores_count || 0} sub-contenedores · ${m.objetos_count || 0} objetos</span>
        </div>
      </div>
      ${m.es_inmueble ? '<span class="mueble-inmueble">📌 Mueble fijo</span>' : ''}
      <div class="mueble-minimapa" title="Minimapa rectangular de la grilla del mueble">${minimapaRectangularSvg({ filas, columnasPorFila, filaActiva: null, columnaActiva: null })}</div>
    </div>
    <div class="mueble-grilla">${filasHtml.join('')}</div>
  </div>`;
}

/** Contenido de un casillero de mueble (sub-contenedores y objetos extraíbles). */
function celdaMuebleContenidoHtml(conts: SubContVisor[], objs: SubObjVisor[]): string {
  if (!conts.length && !objs.length) return '<span class="mueble-celda-vacia">▫</span>';

  const contsHtml = conts
    .map(
      (x) => `<span class="mueble-item" data-mueble-sub-dnd="${x.id}" draggable="true" title="Arrastrá «${escapeHtml(x.nombre)}» para reacomodarlo o extraerlo a la bandeja">
        <img src="${IMG_MUEBLE}" alt="" class="mueble-item-img" draggable="false" />
        <span class="mueble-item-nombre">${escapeHtml(x.nombre)}</span>
        ${x.es_inmueble ? '<span class="mueble-item-fijo">📌</span>' : ''}
      </span>`,
    )
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

// =============================================================================
// EVENTOS (DnD exclusivo: sin botones "+")
// =============================================================================

function enlazar(): void {
  if (!rootEl) return;

  // Drop Zones de casillero de mueble.
  rootEl.querySelectorAll<HTMLElement>('[data-mueble-celda]').forEach((celda) => {
    const muebleId = celda.dataset.muebleId;
    const r = Number(celda.dataset.muebleRow);
    const c = Number(celda.dataset.muebleCol);
    if (!muebleId || !r || !c) return;
    celda.addEventListener('dragover', (e) => {
      e.preventDefault();
      if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.dropEffect = 'move';
      celda.classList.add('mueble-celda-dnd-activo');
    });
    celda.addEventListener('dragleave', () => celda.classList.remove('mueble-celda-dnd-activo'));
    celda.addEventListener('drop', (e) => {
      const de = e as DragEvent;
      e.preventDefault();
      celda.classList.remove('mueble-celda-dnd-activo');
      const contId = de.dataTransfer?.getData('application/x-estok-contenedor');
      const objId = de.dataTransfer?.getData('application/x-estok-objeto');
      const ocupado =
        subContenedores.some(
          (x) => x.parent_contenedor === muebleId && x.parent_grid_row === r && x.parent_grid_col === c,
        ) ||
        subObjetos.some(
          (x) => x.contenedor === muebleId && x.parent_grid_row === r && x.parent_grid_col === c,
        );
      if (ocupado) {
        toast('⚠️ Ese casillero ya está ocupado. Elegí un casillero libre.');
        return;
      }
      if (contId) void asignarSubContenedor(contId, muebleId, r, c);
      else if (objId) void asignarObjetoAMueble(objId, muebleId, r, c);
    });
  });

  // Reacomodo/extracción de sub-contenedores dentro del mueble.
  rootEl.querySelectorAll<HTMLElement>('[data-mueble-sub-dnd]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      const de = e as DragEvent;
      const id = el.dataset.muebleSubDnd;
      if (!id) {
        de.preventDefault();
        return;
      }
      const dato = subContenedores.find((x) => x.id === id);
      if (dato?.es_inmueble) {
        toast('📌 Este sub-contenedor es un mueble inmueble fijo.');
        de.preventDefault();
        return;
      }
      de.dataTransfer?.setData('application/x-estok-contenedor', id);
      de.dataTransfer?.setData('text/plain', id);
      if (de.dataTransfer) de.dataTransfer.effectAllowed = 'move';
      el.classList.add('opacity-50');
    });
    el.addEventListener('dragend', () => el.classList.remove('opacity-50'));
  });

  // Reacomodo/extracción de objetos dentro del mueble.
  rootEl.querySelectorAll<HTMLElement>('[data-mueble-obj-dnd]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      const de = e as DragEvent;
      const id = el.dataset.muebleObjDnd;
      if (!id) {
        de.preventDefault();
        return;
      }
      de.dataTransfer?.setData('application/x-estok-objeto', id);
      de.dataTransfer?.setData('text/plain', id);
      if (de.dataTransfer) de.dataTransfer.effectAllowed = 'move';
      el.classList.add('opacity-50');
    });
    el.addEventListener('dragend', () => el.classList.remove('opacity-50'));
  });
}

// =============================================================================
// PERSISTENCIA (PUT multi-tenant con coordenadas enteras)
// =============================================================================

async function asignarSubContenedor(id: string, muebleId: string, r: number, c: number): Promise<void> {
  if (!roomActual) return;
  const filaEntera = Math.floor(Number(r));
  const colEntera = Math.floor(Number(c));
  const dato = subContenedores.find((x) => x.id === id);
  if (dato && (dato.subcontenedores_count || 0) > 0) {
    toast('⚠️ Un mueble con sub-contenedores no puede anidarse dentro de otro mueble.');
    return;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ubicacion: roomActual.id,
        parent_contenedor: muebleId,
        parent_grid_row: filaEntera,
        parent_grid_col: colEntera,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (res.ok) {
      toast('✅ Contenedor acomodado en el casillero del mueble.');
      window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    } else {
      const err = await res.json().catch(() => ({}));
      toast('❌ ' + (err?.detail || err?.error || 'No se pudo acomodar el contenedor.'));
    }
  } catch {
    toast('❌ Error de conexión al acomodar el contenedor.');
  }
}

async function asignarObjetoAMueble(id: string, muebleId: string, r: number, c: number): Promise<void> {
  if (!roomActual) return;
  const filaEntera = Math.floor(Number(r));
  const colEntera = Math.floor(Number(c));
  try {
    const res = await fetch(`${API_BASE_URL}/objetos/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contenedor: muebleId,
        ubicacion: roomActual.id,
        parent_grid_row: filaEntera,
        parent_grid_col: colEntera,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (res.ok) {
      toast('✅ Objeto acomodado en el casillero del mueble.');
      window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
    } else {
      const err = await res.json().catch(() => ({}));
      toast('❌ ' + (err?.detail || err?.error || 'No se pudo acomodar el objeto.'));
    }
  } catch {
    toast('❌ Error de conexión al acomodar el objeto.');
  }
}

// =============================================================================
// ENTRADA
// =============================================================================

export function initVisorContenedorGrande(opts: { contenedor?: HTMLElement | null }): void {
  rootEl = opts.contenedor ?? null;
  if (!rootEl) return;
  window.addEventListener('estok:habitacion-seleccionada', (e) => {
    const room = (e as CustomEvent<{ room: UbicacionPlano | null }>).detail?.room ?? null;
    roomActual = room;
    void cargar();
  });
  window.addEventListener('estok:espacios-cambiados', () => {
    if (roomActual) void cargar();
  });
}

