// =============================================================================
// VISOR DE LA HABITACIÓN SELECCIONADA (Nivel 2)
// -----------------------------------------------------------------------------
// Reemplaza el listado estático lateral de habitaciones. Al hacer clic sobre
// una habitación encastrada en el Mapa Estok (evento estok:habitacion-seleccionada),
// la columna derecha muestra:
//   1. Ficha: nombre, dimensión (Alto × Ancho × Largo) y foto.
//   2. Su propio lienzo de sub-grilla matricial (Filas Internas × Columnas por
//      fila, asimétricas) con controles numéricos independientes de la habitación.
//   3. Celdas Drop Zone que reciben Contenedores Grandes (/archivador-login.png),
//      Contenedores Pequeños (/Nuevo Contenedor.png) y Objetos
//      (/fluffy_plush_ball.jpg).
// Persistencia multi-tenant estricta (JWT + X-Estok-Id):
//   - Filas/Columnas del lienzo → PUT /api/ubicaciones/{roomId}/
//   - Contenedor en una celda   → PUT /api/contenedores/{id}/
//   - Objeto en una celda       → PUT /api/objetos/{id}/
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import {
  escapeHtml,
  toast,
  filasInternasDe,
  columnasInternasDe,
  columnasDeFilaInterna,
  guardarUbicacion,
} from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';
import {
  ETIQUETAS_PARED,
  celdaVisorContenidoHtml,
  cuerpoConParedesHtml,
  paletaPuertaHtml,
  medidasDe,
  minimapaPlantaHtml,
} from './visorHabitacionHtml';

interface ContenedorVisor {
  id: string;
  nombre: string;
  parent_contenedor?: string | null;
  subcontenedores_count?: number;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
  /** Mueble inmueble fijo: no se arrastra ni elimina. */
  es_inmueble?: boolean;
}

interface ObjetoVisor {
  id: string;
  nombre: string;
  contenedor?: string | null;
  parent_grid_row?: number | null;
  parent_grid_col?: number | null;
}

let roomActual: UbicacionPlano | null = null;
let contenedoresRoom: ContenedorVisor[] = [];
let objetosRoom: ObjetoVisor[] = [];
/** Tipo de elemento arrastrándose sobre el Visor (para las Drop Zones de pared). */
let dragTipoVisor: 'contenedor' | 'objeto' | 'puerta' | null = null;

/** Grilla de la planta (división) para el minimapa de orientación del Visor. */
interface GrillaDivisionVisor {
  filas: number;
  nombre: string;
}
let divisionGrid: GrillaDivisionVisor | null = null;

// =============================================================================
// HELPERS
// =============================================================================

function notificarEspacios(): void {
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
}

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

async function cargarContenido(): Promise<void> {
  if (!roomActual) {
    contenedoresRoom = [];
    objetosRoom = [];
    divisionGrid = null;
    return;
  }
  const [contData, objData] = await Promise.all([
    fetchTodos(`${API_BASE_URL}/contenedores/?ubicacion=${roomActual.id}&raiz=true&page_size=1000`),
    fetchTodos(`${API_BASE_URL}/objetos/?ubicacion=${roomActual.id}&page_size=1000`),
  ]);
  contenedoresRoom = (contData as unknown as ContenedorVisor[]).filter((c) => !c.parent_contenedor);
  objetosRoom = (objData as unknown as ObjetoVisor[]).filter((o) => !o.contenedor);

  // Grilla de la planta (división) donde está encastrada la habitación, para
  // pintar el minimapa naranja del cuadrante auditado en la cabecera del Visor.
  divisionGrid = null;
  if (roomActual.parent_ubicacion) {
    try {
      const res = await fetch(`${API_BASE_URL}/ubicaciones/${roomActual.parent_ubicacion}/`, { headers: getAuthHeaders() });
      if (res.ok) {
        const d = (await res.json()) as Record<string, unknown>;
        divisionGrid = {
          filas: Math.max(1, Number(d.grid_filas) || 3),
          nombre: String(d.nombre || 'Planta'),
        };
      }
    } catch {
      divisionGrid = null;
    }
  }
}

// =============================================================================
// RENDER
// =============================================================================

/** Contenido de una celda del Visor (contenedores y objetos con esa coordenada). */
function renderVisor(): void {
  const cont = document.getElementById('visorHabitacion');
  if (!cont) return;
  if (!roomActual) {
    cont.innerHTML = `<div class="visor-placeholder">
      <div class="visor-placeholder-ico">🏠</div>
      <p class="visor-placeholder-texto">Hacé clic sobre una habitación encastrada en el Mapa Estok para inspeccionarla en este Visor.</p>
    </div>`;
    return;
  }

  const room = roomActual;
  const filasInt = filasInternasDe(room);
  const med = medidasDe(room);
  const puerta = room.posicion_puerta || null;

  const filasHtml: string[] = [];
  for (let r = 1; r <= filasInt; r++) {
    const cols = columnasDeFilaInterna(room, r);
    const celdas: string[] = [];
    for (let c = 1; c <= cols; c++) {
      celdas.push(`
        <div class="visor-celda" data-visor-celda data-visor-row="${r}" data-visor-col="${c}" title="Soltá contenedores u objetos aquí">
          ${celdaVisorContenidoHtml(contenedoresRoom, objetosRoom, r, c)}
        </div>`);
    }
    filasHtml.push(`
      <div class="visor-fila-interna">
        <div class="visor-fila-interna-cab">
          <span class="visor-fila-interna-etiqueta">Fila ${r}</span>
          <span class="mapa-cols-control">
            <button type="button" class="num-btn" data-visor-cols="menos" data-fila="${r}" title="Quitar columna a la fila ${r}">−</button>
            <input type="number" class="num-input" min="1" max="12" value="${cols}" readonly data-visor-cols-input="${r}" aria-label="Columnas de la fila ${r} del Visor" />
            <button type="button" class="num-btn" data-visor-cols="mas" data-fila="${r}" title="Agregar columna a la fila ${r}">+</button>
          </span>
        </div>
        <div class="visor-fila-celdas" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));">
          ${celdas.join('')}
        </div>
      </div>`);
  }

  cont.innerHTML = `
  <div class="visor-habitacion">
    <div class="visor-ficha">
      ${room.foto ? `<img src="${escapeHtml(room.foto)}" alt="${escapeHtml(room.nombre)}" class="visor-foto" />` : '<div class="visor-foto visor-foto-vacia">🏠</div>'}
      <div class="visor-ficha-info">
        <h3 class="visor-nombre">${escapeHtml(room.nombre)}</h3>
        <p class="visor-sub">${room.parent_ubicacion_nombre ? `División: ${escapeHtml(room.parent_ubicacion_nombre)}` : 'Habitación suelta'}</p>
        ${med ? `<p class="visor-medidas">📐 ${escapeHtml(med)}</p>` : ''}
      </div>
    </div>
    ${minimapaPlantaHtml(divisionGrid, room.parent_grid_row, room.parent_grid_col)}
    <div class="visor-encabezado">
      <span class="visor-titulo">Lienzo matricial de la habitación</span>
      <span class="mapa-filas-internas-control">
        <span class="mapa-filas-internas-etiqueta">Filas</span>
        <span class="num-control">
          <button type="button" class="num-btn" data-visor-filas="menos" title="Quitar fila interna del lienzo">−</button>
          <input type="number" class="num-input" min="1" max="12" value="${filasInt}" readonly data-visor-filas-input aria-label="Filas internas del lienzo del Visor" />
          <button type="button" class="num-btn" data-visor-filas="mas" title="Agregar fila interna del lienzo">+</button>
        </span>
      </span>
    </div>
    ${cuerpoConParedesHtml(filasHtml.join(''), puerta)}
    ${paletaPuertaHtml()}
    <p class="visor-ayuda">Arrastrá muebles entre casilleros libres, o soltá la puerta 🚪 en una de las cuatro paredes de la habitación.</p>
  </div>`;
}

// =============================================================================
// EVENTOS (DnD + controles numéricos)
// =============================================================================

function enlazarVisor(): void {
  const cont = document.getElementById('visorHabitacion');
  if (!cont) return;

  cont.querySelectorAll<HTMLElement>('[data-visor-celda]').forEach((celda) => {
    const r = Number(celda.dataset.visorRow);
    const c = Number(celda.dataset.visorCol);
    if (!r || !c) return;
    celda.addEventListener('dragover', (e: Event) => {
      e.preventDefault();
      if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.dropEffect = 'move';
      celda.classList.add('visor-celda-dnd-activo');
    });
    celda.addEventListener('dragleave', () => celda.classList.remove('visor-celda-dnd-activo'));
    celda.addEventListener('drop', (e: Event) => {
      const de = e as DragEvent;
      e.preventDefault();
      celda.classList.remove('visor-celda-dnd-activo');
      const contId = de.dataTransfer?.getData('application/x-estok-contenedor');
      const objId = de.dataTransfer?.getData('application/x-estok-objeto');
      if (contId) {
        // Reacomodo seguro: solo se permite soltar en un casillero LIBRE.
        const ocupado =
          contenedoresRoom.some((x) => x.parent_grid_row === r && x.parent_grid_col === c) ||
          objetosRoom.some((x) => x.parent_grid_row === r && x.parent_grid_col === c);
        if (ocupado) {
          toast('⚠️ Ese casillero ya está ocupado. Elegí un casillero libre.');
          return;
        }
        void asignarContenedorACelda(contId, r, c);
      } else if (objId) void asignarObjetoACelda(objId, r, c);
    });
  });

  // Reacomodo por Drag & Drop dentro del Visor: muebles arrastrables
  // (excepto los inmuebles fijos) hacia otro casillero libre.
  cont.querySelectorAll<HTMLElement>('[data-contenedor-id]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      const de = e as DragEvent;
      const id = el.dataset.contenedorId;
      if (!id) { de.preventDefault(); return; }
      const c = contenedoresRoom.find((x) => x.id === id);
      if (c?.es_inmueble) { de.preventDefault(); return; }
      dragTipoVisor = 'contenedor';
      if (de.dataTransfer) {
        de.dataTransfer.setData('application/x-estok-contenedor', id);
        de.dataTransfer.setData('text/plain', id);
        de.dataTransfer.effectAllowed = 'move';
      }
      el.classList.add('opacity-50');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('opacity-50');
      dragTipoVisor = null;
    });
  });

  // Edición técnica en caliente desde el Visor (✏️ junto a cada mueble).
  cont.querySelectorAll<HTMLElement>('[data-editar-contenedor-visor]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.editarContenedorVisor;
      if (!id) return;
      window.dispatchEvent(new CustomEvent('estok:editar-contenedor', { detail: { id } }));
    });
  });

  // Puerta arrastrable: origen "🚪 Puerta" + las cuatro paredes como Drop Zones.
  cont.querySelector<HTMLElement>('[data-puerta-drag]')?.addEventListener('dragstart', (e) => {
    const de = e as DragEvent;
    dragTipoVisor = 'puerta';
    if (de.dataTransfer) {
      de.dataTransfer.setData('application/x-estok-puerta', '1');
      de.dataTransfer.setData('text/plain', 'PUERTA');
      de.dataTransfer.effectAllowed = 'move';
    }
  });
  cont.querySelector<HTMLElement>('[data-puerta-drag]')?.addEventListener('dragend', () => {
    dragTipoVisor = null;
  });

  cont.querySelectorAll<HTMLElement>('[data-visor-pared]').forEach((pared) => {
    pared.addEventListener('dragover', (e) => {
      if (dragTipoVisor !== 'puerta') return;
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'move';
      pared.classList.add('visor-pared-dnd-activo');
    });
    pared.addEventListener('dragleave', () => pared.classList.remove('visor-pared-dnd-activo'));
    pared.addEventListener('drop', (e) => {
      const de = e as DragEvent;
      e.preventDefault();
      pared.classList.remove('visor-pared-dnd-activo');
      if (!de.dataTransfer?.getData('application/x-estok-puerta')) return;
      const lado = pared.dataset.visorPared as 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT';
      if (lado) void guardarPuerta(lado);
    });
  });

  cont.querySelectorAll<HTMLElement>('[data-visor-filas]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!roomActual) return;
      const delta = btn.dataset.visorFilas === 'mas' ? 1 : -1;
      void cambiarFilasVisor(filasInternasDe(roomActual) + delta);
    });
  });
  (cont.querySelector('[data-visor-filas-input]') as HTMLInputElement | null)?.addEventListener('change', (e) => {
    if (!roomActual) return;
    void cambiarFilasVisor(Number((e.target as HTMLInputElement).value));
  });

  cont.querySelectorAll<HTMLElement>('[data-visor-cols]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!roomActual) return;
      const fila = Number(btn.dataset.fila);
      if (!fila) return;
      const actual = columnasDeFilaInterna(roomActual, fila);
      const delta = btn.dataset.visorCols === 'mas' ? 1 : -1;
      void cambiarColumnasVisor(fila, actual + delta);
    });
  });
  cont.querySelectorAll<HTMLInputElement>('[data-visor-cols-input]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!roomActual) return;
      const fila = Number(input.dataset.fila);
      if (!fila) return;
      void cambiarColumnasVisor(fila, Number(input.value));
    });
  });
}


// =============================================================================
// PERSISTENCIA (PUT multi-tenant)
// =============================================================================

async function cambiarFilasVisor(nuevas: number): Promise<void> {
  if (!roomActual) return;
  const room = roomActual;
  const f = Math.max(1, Math.min(12, Math.floor(Number(nuevas)) || 1));
  if (f === filasInternasDe(room)) return;
  const def = columnasInternasDe(room);
  const cfg = Array.isArray(room.grid_filas_config) ? room.grid_filas_config.slice(0, f) : null;
  if (cfg && cfg.length < f) {
    while (cfg.length < f) cfg.push(def);
  }
  const ok = await guardarUbicacion(room.id, { grid_filas: f, grid_filas_config: cfg });
  if (ok) {
    room.grid_filas = f;
    room.grid_filas_config = cfg;
    toast(`✅ El lienzo de «${room.nombre}» ahora tiene ${f} filas.`);
    notificarEspacios();
    await cargarContenido();
  } else {
    toast('❌ No se pudo guardar las filas del lienzo.');
  }
  renderVisor();
  enlazarVisor();
}

async function cambiarColumnasVisor(fila: number, cols: number): Promise<void> {
  if (!roomActual) return;
  const room = roomActual;
  const f = Math.max(1, Math.floor(Number(fila)) || 1);
  const c = Math.max(1, Math.min(12, Math.floor(Number(cols)) || 1));
  if (c === columnasDeFilaInterna(room, f)) return;
  const def = columnasInternasDe(room);
  const filasInt = filasInternasDe(room);
  const cfg: number[] = [];
  for (let r = 1; r <= filasInt; r++) {
    cfg.push(r === f ? c : columnasDeFilaInterna(room, r));
  }
  const configFinal = cfg.every((v) => v === def) ? null : cfg;
  const ok = await guardarUbicacion(room.id, { grid_filas_config: configFinal });
  if (ok) {
    room.grid_filas_config = configFinal;
    toast(`✅ Fila ${f} de «${room.nombre}» ahora tiene ${c} columnas.`);
    notificarEspacios();
    await cargarContenido();
  } else {
    toast('❌ No se pudo guardar las columnas del lienzo.');
  }
  renderVisor();
  enlazarVisor();
}

async function asignarContenedorACelda(id: string, r: number, c: number): Promise<void> {
  if (!roomActual) return;
  const cont = contenedoresRoom.find((x) => x.id === id);
  if (cont?.es_inmueble) {
    toast('📌 Este mueble es inmueble fijo y no puede reacomodarse.');
    return;
  }
  const filaEntera = Math.floor(Number(r));
  const colEntera = Math.floor(Number(c));
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ubicacion: roomActual.id,
        parent_contenedor: null,
        parent_grid_row: filaEntera,
        parent_grid_col: colEntera,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (res.ok) {
      toast('✅ Contenedor acomodado en el lienzo del Visor.');
      notificarEspacios();
      await cargarContenido();
    } else {
      const err = await res.json().catch(() => ({}));
      toast('❌ ' + (err?.detail || err?.error || 'No se pudo acomodar el contenedor.'));
    }
  } catch {
    toast('❌ Error de conexión al acomodar el contenedor.');
  }
  renderVisor();
  enlazarVisor();
}

async function asignarObjetoACelda(id: string, r: number, c: number): Promise<void> {
  if (!roomActual) return;
  const filaEntera = Math.floor(Number(r));
  const colEntera = Math.floor(Number(c));
  try {
    const res = await fetch(`${API_BASE_URL}/objetos/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contenedor: null,
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
      toast('✅ Objeto acomodado en el lienzo del Visor.');
      notificarEspacios();
      await cargarContenido();
    } else {
      const err = await res.json().catch(() => ({}));
      toast('❌ ' + (err?.detail || err?.error || 'No se pudo acomodar el objeto.'));
    }
  } catch {
    toast('❌ Error de conexión al acomodar el objeto.');
  }
  renderVisor();
  enlazarVisor();
}

/** Persiste la puerta en una de las cuatro paredes (PUT /api/ubicaciones/{id}/). */
async function guardarPuerta(pared: 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT'): Promise<void> {
  if (!roomActual) return;
  const ok = await guardarUbicacion(roomActual.id, { posicion_puerta: pared });
  if (ok) {
    roomActual.posicion_puerta = pared;
    toast(`🚪 Puerta ubicada en la pared ${ETIQUETAS_PARED[pared]}.`);
    notificarEspacios();
    renderVisor();
    enlazarVisor();
  } else {
    toast('❌ No se pudo guardar la posición de la puerta.');
  }
}

// =============================================================================
// ENTRADA
// =============================================================================

export function initVisor(): void {
  window.addEventListener('estok:habitacion-seleccionada', (e) => {
    const room = (e as CustomEvent<{ room: UbicacionPlano | null }>).detail?.room ?? null;
    roomActual = room;
    if (!roomActual) {
      renderVisor();
      return;
    }
    void cargarContenido().then(() => {
      renderVisor();
      enlazarVisor();
    });
  });
  // Refresco en caliente ante cambios externos (movimientos/eliminaciones).
  window.addEventListener('estok:espacios-cambiados', () => {
    if (roomActual) {
      void cargarContenido().then(() => {
        renderVisor();
        enlazarVisor();
      });
    }
  });
  renderVisor();
}

