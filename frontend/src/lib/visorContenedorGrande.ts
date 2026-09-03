// =============================================================================
// VISOR CONTENEDOR GRANDE (Nivel 3 - Muebles / Archivadores)
// -----------------------------------------------------------------------------
// ESCENA 3 del flujo en cascada: al seleccionar una habitación, el panel
// derecho abre este Visor con los MUEBLES / ARCHIVADORES de esa habitación
// (contenedores con sub-contenedores o marcados como mueble inmueble fijo).
// Cada mueble expone su grilla interna de casilleros como Drop Zones: recibe
// Contenedores Pequeños y Objetos arrastrados desde la bandeja inferior o
// reacomodados entre casilleros. Las sub-divisiones internas (estantes/cajones)
// se editan 100% in-place (renombrar al clic, arrastrar para reacomodar y
// estirar con tirador elástico) y una celda VACÍA muestra "➕" para fundar un
// sub-contenedor en caliente bajo la misma regla relacional del Drop
// (parent_contenedor del mueble + coordenadas F·C). Persistencia multi-tenant
// estricta (JWT + X-Estok-Id) con PUTs/POSTs asincrónicos de coordenadas enteras.
// =============================================================================

import { getAuthHeaders, API_BASE_URL } from '../services/auth';
import { toast, columnasDeFilaInterna, filasInternasDe } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';
import { conectarRenombradoEnVivo, conectarResizeElastico } from './lienzoInteractivo';
import type { MuebleVisor, SubContVisor, SubObjVisor } from './visorContenedorGrandeHtml';
import { visorContenidoGrandeHtml } from './visorContenedorGrandeHtml';
import {
  ADVERTENCIA_ELIMINAR_DIVISION,
  agregarDivisionEnFila,
  eliminarDivisionDeFilaEnGrid,
} from './visorContenedorGrandeAcciones';
import type { ItemADesplazar } from './visorContenedorGrandeAcciones';

let roomActual: UbicacionPlano | null = null;
let muebles: MuebleVisor[] = [];
let subContenedores: SubContVisor[] = [];
let subObjetos: SubObjVisor[] = [];
let rootEl: HTMLElement | null = null;
/** Mueble cuya ficha/distribución interna se inspecciona (ESCENA 3, en caliente). */
let muebleActivoId: string | null = null;

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

// =============================================================================
// CARGA DE LA HABITACIÓN ACTIVA
// =============================================================================

async function cargar(): Promise<void> {
  if (!rootEl) return;
  if (!roomActual) {
    muebles = [];
    subContenedores = [];
    subObjetos = [];
    muebleActivoId = null;
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
      ui_width: c.ui_width != null ? String(c.ui_width) : null,
      ui_height: c.ui_height != null ? String(c.ui_height) : null,
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

  // Si el mueble inspeccionado desapareció (borrado en otra vista), se vuelve
  // al listado general sin romper la ESCENA 3.
  if (muebleActivoId && !muebles.some((m) => m.id === muebleActivoId)) {
    muebleActivoId = null;
  }
  render();
}

// =============================================================================
// RENDER
// =============================================================================

function render(): void {
  if (!rootEl) return;
  // Purga en caliente del panel derecho: cada render (conmutación de mueble,
  // alta/baja de división, refresh externo) redibuja la ficha del mueble activo
  // o el listado general sin recargar la página.
  rootEl.innerHTML = visorContenidoGrandeHtml({
    room: roomActual,
    muebles,
    subContenedores,
    subObjetos,
    muebleActivoId,
  });
  enlazar();
}

// =============================================================================
// EVENTOS (DnD entre casilleros + fundación "➕" en celdas vacías)
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

  // Fundación en caliente de sub-divisiones: el "➕" de una celda VACÍA crea un
  // estante/cajón bajo la MISMA regla relacional del Drop (parent_contenedor del
  // mueble + coordenadas F·C exactas) sin pasar por la bandeja.
  rootEl.querySelectorAll<HTMLButtonElement>('[data-mueble-celda-crear]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.creando === '1') return;
      const muebleId = btn.dataset.muebleId;
      const r = Number(btn.dataset.muebleRow);
      const c = Number(btn.dataset.muebleCol);
      if (!muebleId || !r || !c) return;
      btn.dataset.creando = '1';
      btn.textContent = '⏳';
      btn.disabled = true;
      void crearSubContenedorEnCelda(muebleId, r, c).then((ok) => {
        if (!ok) {
          delete btn.dataset.creando;
          btn.disabled = false;
          btn.textContent = '➕';
        }
      });
    });
  });

  // Conmutación EN CALIENTE del mueble inspeccionado (ESCENA 3): cada tarjeta
  // del listado ofrece «🔍 Abrir ficha», los chips del detalle conmutan de mueble
  // al instante (Ropero → Cama Cucheta, etc.) y «← Ver todos los muebles»
  // regresa al listado general. El clic sobre un mueble del Visor de Habitación
  // (panel izquierdo) llega por el evento estok:mueble-seleccionado.
  rootEl.querySelectorAll<HTMLElement>('[data-mueble-abrir], [data-mueble-chip]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.muebleAbrir ?? btn.dataset.muebleChip;
      if (id) activarMueble(id);
    });
  });
  rootEl.querySelector<HTMLElement>('[data-mueble-atras]')?.addEventListener('click', () => {
    activarMueble(null);
  });

  // Botón flotante verde «+» (extremo derecho de cada fila): suma una nueva
  // división/columna vacía a esa línea específica y la registra con POST.
  rootEl.querySelectorAll<HTMLButtonElement>('[data-mueble-fila-agregar]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.creando === '1') return;
      const muebleId = btn.dataset.muebleId;
      const fila = Number(btn.dataset.muebleRow);
      if (!muebleId || !fila) return;
      btn.dataset.creando = '1';
      btn.disabled = true;
      void agregarDivisionAMueble(muebleId, fila).finally(() => {
        delete btn.dataset.creando;
        btn.disabled = false;
      });
    });
  });

  // Botón compacto rojo «−» sobre cada sub-división de una fila con más de una
  // división: frena con el cartel unificado y borra con DELETE asincrónico.
  rootEl.querySelectorAll<HTMLButtonElement>('[data-mueble-celda-quitar]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const subId = btn.dataset.muebleSubId;
      if (!subId) return;
      void eliminarDivisionDeMueble(subId);
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

  // =========================================================================
  // MOTOR RECURSIVO DE EDICIÓN IN-PLACE (lienzoInteractivo.ts) — Nivel 4
  // Estanterías internas de la Ficha del Mueble Inmueble: renombrar al clic y
  // estirar con el tirador de esquina (PUT /api/contenedores/{id}/ ui_*).
  // =========================================================================
  conectarRenombradoEnVivo(rootEl, renombrarEstanteriaEnVivo);
  conectarResizeElastico(rootEl, { onConfirmar: redimensionarEstanteriaEnVivo });
}

// =============================================================================
// FUNDACIÓN EN CALIENTE DE SUB-DIVISIONES (POST /api/contenedores/)
// Crea un estante/cajón dentro de una celda VACÍA del mueble bajo la MISMA
// regla relacional del Drop: parent_contenedor = mueble, ubicacion de la
// habitación y parent_grid_row/col = celda exacta. El sub-contenedor nace con
// es_inmueble=False (mudable con su mueble) y luego se renombra/dimensiona
// in-place con los motores de la recursión.
// =============================================================================

async function crearSubContenedorEnCelda(muebleId: string, r: number, c: number): Promise<boolean> {
  if (!roomActual) return false;
  const filaEntera = Math.floor(Number(r));
  const colEntera = Math.floor(Number(c));
  if (!filaEntera || !colEntera) return false;

  const ocupado =
    subContenedores.some(
      (x) => x.parent_contenedor === muebleId && x.parent_grid_row === filaEntera && x.parent_grid_col === colEntera,
    ) ||
    subObjetos.some(
      (x) => x.contenedor === muebleId && x.parent_grid_row === filaEntera && x.parent_grid_col === colEntera,
    );
  if (ocupado) {
    toast('⚠️ Ese casillero ya está ocupado. Elegí una celda libre.');
    return false;
  }

  const mueble = muebles.find((m) => m.id === muebleId);
  const nombre = `Estante F${filaEntera}·C${colEntera}`;
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre,
        descripcion: '',
        ubicacion: roomActual.id,
        parent_contenedor: muebleId,
        parent_grid_row: filaEntera,
        parent_grid_col: colEntera,
        es_inmueble: false,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) {
      toast(`✅ «${nombre}» fundado en «${mueble?.nombre || 'el mueble'}». Clic en el nombre para renombrarlo en caliente.`);
      window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
      return true;
    }
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo fundar la sub-división.'));
    return false;
  } catch {
    toast('❌ Error de conexión al fundar la sub-división.');
    return false;
  }
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
// EDICIÓN IN-PLACE DE ESTANTERÍAS INTERNAS (PUT /api/contenedores/{id}/)
// =============================================================================

async function persistirSubContenedor(id: string, data: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/${id}/`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) return true;
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo actualizar la estantería.'));
    return false;
  } catch {
    toast('❌ Error de conexión al actualizar la estantería.');
    return false;
  }
}

async function renombrarEstanteriaEnVivo(id: string, nombre: string): Promise<boolean> {
  const item = subContenedores.find((x) => x.id === id);
  if (!item) return false;
  if (nombre === item.nombre) return true;
  const ok = await persistirSubContenedor(id, { nombre });
  if (!ok) return false;
  item.nombre = nombre;
  toast(`✅ Estantería renombrada a «${nombre}».`);
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
  return true;
}

async function redimensionarEstanteriaEnVivo(id: string, dim: { ui_width: string; ui_height: string }): Promise<boolean> {
  const item = subContenedores.find((x) => x.id === id);
  if (!item) return false;
  const ok = await persistirSubContenedor(id, { ui_width: dim.ui_width, ui_height: dim.ui_height });
  if (!ok) return false;
  item.ui_width = dim.ui_width;
  item.ui_height = dim.ui_height;
  toast('✅ Tamaño de la estantería actualizado.');
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
  return true;
}

// =============================================================================
// CONMUTACIÓN EN CALIENTE + CONTROLES +/− DE SUB-DIVISIONES (ESCENA 3)
// =============================================================================

/** Activa el mueble a inspeccionar y sincroniza el resaltado del panel izquierdo. */
function activarMueble(id: string | null): void {
  if (!roomActual) return;
  muebleActivoId = id && muebles.some((m) => m.id === id) ? id : null;
  render();
  window.dispatchEvent(new CustomEvent('estok:mueble-destacado', { detail: { id: muebleActivoId } }));
}

/** Reduce en el estado local la geometría de una fila (espejo del PUT servido). */
function colapsarFilaLocalmente(mueble: MuebleVisor, fila: number, columnasNuevas: number): void {
  const div = mueble as unknown as UbicacionPlano;
  const filas = filasInternasDe(div);
  const config: number[] = [];
  for (let i = 0; i < filas; i++) {
    config.push(i === fila - 1 ? columnasNuevas : columnasDeFilaInterna(div, i + 1));
  }
  const uniforme = config.every((v) => v === config[0]);
  mueble.grid_filas = filas;
  mueble.grid_columnas = uniforme ? columnasNuevas : Number(mueble.grid_columnas) || 3;
  mueble.grid_filas_config = uniforme ? null : config;
}

/** «−» de una sub-división: confirm unificado + DELETE y contracción REAL de la columna. */
async function eliminarDivisionDeMueble(subId: string): Promise<void> {
  const sub = subContenedores.find((s) => s.id === subId);
  if (!sub) return;
  if (sub.es_inmueble) {
    toast('📌 Esta sub-división es un mueble inmueble fijo y no puede eliminarse.');
    return;
  }
  const fila = sub.parent_grid_row;
  const col = sub.parent_grid_col;
  const muebleId = sub.parent_contenedor;
  if (!fila || !col || !muebleId) return;
  const mueble = muebles.find((m) => m.id === muebleId);
  if (!mueble) return;
  if (!window.confirm(ADVERTENCIA_ELIMINAR_DIVISION)) return;

  // Siblings (sub-divisiones u objetos directos) a la DERECHA de la columna
  // borrada: se desplazan una columna a la izquierda para que el layout se
  // re-acomode sin recuadros vacíos fantasma (la columna desaparece de verdad).
  const aDesplazar: ItemADesplazar[] = [
    ...subContenedores
      .filter(
        (s) =>
          s.id !== subId &&
          s.parent_contenedor === muebleId &&
          s.parent_grid_row === fila &&
          (s.parent_grid_col ?? 0) > col,
      )
      .map((s) => ({ tipo: 'contenedor' as const, id: s.id, col: s.parent_grid_col as number })),
    ...subObjetos
      .filter(
        (o) =>
          o.contenedor === muebleId &&
          o.parent_grid_row === fila &&
          (o.parent_grid_col ?? 0) > col,
      )
      .map((o) => ({ tipo: 'objeto' as const, id: o.id, col: o.parent_grid_col as number })),
  ];

  const columnasAnterior = columnasDeFilaInterna(mueble as unknown as UbicacionPlano, fila);
  const ok = await eliminarDivisionDeFilaEnGrid({
    subId: sub.id,
    nombre: sub.nombre,
    mueble,
    fila,
    col,
    columnasAnterior,
    aDesplazar,
  });
  if (!ok) return;

  // Remoción física EN CALIENTE del recuadro: se purga la sub-división del
  // estado, sus hermanos se corren una columna a la izquierda y la fila pierde
  // una columna real. render() redibuja el loop sin el rectángulo vacío y
  // re-acomoda el ancho del mueble de forma transparente (sin recargar).
  subContenedores = subContenedores.filter((s) => s.id !== sub.id);
  for (const s of subContenedores) {
    if (
      s.parent_contenedor === muebleId &&
      s.parent_grid_row === fila &&
      (s.parent_grid_col ?? 0) > col
    ) {
      s.parent_grid_col = (s.parent_grid_col ?? 0) - 1;
    }
  }
  for (const o of subObjetos) {
    if (o.contenedor === muebleId && o.parent_grid_row === fila && (o.parent_grid_col ?? 0) > col) {
      o.parent_grid_col = (o.parent_grid_col ?? 0) - 1;
    }
  }
  const columnasNuevas = Math.max(1, columnasAnterior - 1);
  colapsarFilaLocalmente(mueble, fila, columnasNuevas);
  render();
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
}

/** «+» del extremo derecho de una fila: suma una división/columna vacía. */
async function agregarDivisionAMueble(muebleId: string, fila: number): Promise<boolean> {
  if (!roomActual) return false;
  const mueble = muebles.find((m) => m.id === muebleId);
  if (!mueble) return false;

  const colsDeFila = columnasDeFilaInterna(mueble as unknown as UbicacionPlano, fila);
  if (colsDeFila >= 12) {
    toast('⚠️ Esta fila ya alcanzó el máximo de 12 casilleros.');
    return false;
  }

  // Casilleros ya ocupados de la fila (sub-contenedores u objetos).
  const ocupados = new Set<number>();
  for (const s of subContenedores) {
    if (s.parent_contenedor === muebleId && s.parent_grid_row === fila && s.parent_grid_col) {
      ocupados.add(s.parent_grid_col);
    }
  }
  for (const o of subObjetos) {
    if (o.contenedor === muebleId && o.parent_grid_row === fila && o.parent_grid_col) {
      ocupados.add(o.parent_grid_col);
    }
  }

  // El botón «+» (extremo derecho de la fila) suma una división vacía a esa
  // línea específica: ocupa el primer casillero libre en orden de lectura; si la
  // fila está llena, se ensancha la geometría con una columna nueva al final.
  let colNueva = 0;
  for (let c = 1; c <= colsDeFila; c++) {
    if (!ocupados.has(c)) {
      colNueva = c;
      break;
    }
  }
  const requiereEnsanche = colNueva === 0;
  if (requiereEnsanche) colNueva = colsDeFila + 1;

  const ok = await agregarDivisionEnFila({
    mueble,
    roomId: roomActual.id,
    fila,
    colNueva,
    requiereEnsanche,
  });
  if (ok) window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
  return ok;
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
    muebleActivoId = null;
    void cargar();
  });
  // Clic sobre un mueble del "Visor de Habitación" (panel izquierdo de la
  // ESCENA 3): el panel derecho limpia su contenido anterior y abre EN CALIENTE
  // la ficha y la distribución interna del mueble recién seleccionado.
  window.addEventListener('estok:mueble-seleccionado', (e) => {
    if (!roomActual) return;
    const detalle = (e as CustomEvent<{ id?: string | null }>).detail ?? {};
    const id = detalle?.id ?? null;
    muebleActivoId = id && muebles.some((m) => m.id === id) ? id : null;
    render();
  });
  window.addEventListener('estok:espacios-cambiados', () => {
    if (roomActual) void cargar();
  });
}

