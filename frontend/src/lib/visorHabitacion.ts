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

import { getAuthHeaders, API_BASE_URL, normalizarUrlApi } from '../services/auth';
import {
  escapeHtml,
  toast,
  filasInternasDe,
  columnasInternasDe,
  columnasDeFilaInterna,
  guardarUbicacion,
  esDivisionUbicacion,
} from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';
import {
  conectarRenombradoEnVivo,
  conectarResizeElastico,
} from './lienzoInteractivo';
import { conectarLienzoElastico } from './plantaUnicaInteractivo';
import { adaptadorContenedores } from './lienzoElastico';
import type { ItemElastico } from './lienzoElastico';
import { renderLienzoElastico } from './mapaPlantaUnica';
import {
  ETIQUETAS_PARED,
  cuerpoConParedesHtml,
  paletaPuertaHtml,
  medidasDe,
  minimapaHabitacionHtml,
  minimapaDivisionHtml,
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
  /** Geometría elástica del mueble en el lienzo 2D de la habitación. */
  ui_left?: string | null;
  ui_top?: string | null;
  ui_width?: string | null;
  ui_height?: string | null;
  /** ID relacional del grupo de fusión (muebles en "L"). */
  fusion_grupo?: string | null;
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

/** Divisiones (plantas) del Estok activo para el estado inicial del Visor. */
let divisionesIniciales: UbicacionPlano[] = [];
/**
 * Habitaciones REALES del Estok activo (todas las plantas), con su geometría
 * nativa ui_left/ui_top/ui_width/ui_height: alimentan el plano proporcional de
 * cada minimapa inicial (Planta Alta / Planta Baja) del Visor.
 */
let habitacionesIniciales: UbicacionPlano[] = [];
/** Casillero exacto de la grilla que el usuario está inspeccionando (guía naranja). */
let celdaInspeccionada: { fila: number; col: number } | null = null;
/** Mueble activo (ESCENA 3): resaltado en el Visor y abierto en el panel derecho. */
let muebleActivoId: string | null = null;

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
    nextUrl = normalizarUrlApi(data.next);
  }
  return todos;
}

async function cargarContenido(): Promise<void> {
  if (!roomActual) {
    contenedoresRoom = [];
    objetosRoom = [];
    return;
  }
  const [contData, objData] = await Promise.all([
    fetchTodos(`${API_BASE_URL}/contenedores/?ubicacion=${roomActual.id}&raiz=true&page_size=1000`),
    fetchTodos(`${API_BASE_URL}/objetos/?ubicacion=${roomActual.id}&page_size=1000`),
  ]);
  contenedoresRoom = (contData as unknown as ContenedorVisor[]).filter((c) => !c.parent_contenedor);
  objetosRoom = (objData as unknown as ObjetoVisor[]).filter((o) => !o.contenedor);
}

// =============================================================================
// ESTADO INICIAL DEL VISOR - minimapas de las plantas en paralelo
// =============================================================================

/** Carga las divisiones (plantas) del Estok activo y sus habitaciones encastradas
 *  para el estado inicial del Visor: sus planos proporcionales se pintan en
 *  paralelo apenas carga la página. */
async function cargarDivisionesIniciales(): Promise<void> {
  try {
    const data = await fetchTodos(`${API_BASE_URL}/ubicaciones/?page_size=1000`);
    const todas = data as unknown as UbicacionPlano[];
    divisionesIniciales = todas
      .filter(esDivisionUbicacion)
      .sort((a, b) => (a.parent_grid_row || 1) - (b.parent_grid_row || 1));
    habitacionesIniciales = todas.filter((u) => !esDivisionUbicacion(u));
  } catch {
    divisionesIniciales = [];
    habitacionesIniciales = [];
  }
  if (!roomActual) renderVisor();
}

/** Habitaciones encastradas en una división (planta) por su relación padre. */
function habitacionesDeDivision(divisionId: string): UbicacionPlano[] {
  return habitacionesIniciales.filter((h) => h.parent_ubicacion === divisionId);
}

/** Actualiza en caliente SOLO el minimapa del Visor con el casillero inspeccionado. */
function refrescarMinimapa(): void {
  const slot = document.getElementById('visorMinimapaSlot');
  if (!slot || !roomActual) return;
  slot.innerHTML = minimapaHabitacionHtml(
    roomActual,
    celdaInspeccionada?.fila ?? null,
    celdaInspeccionada?.col ?? null,
  );
}

/** Resalta el mueble activo dentro del Visor de Habitación e ilumina su casillero. */
function aplicarMuebleActivo(): void {
  const cont = document.getElementById('visorHabitacion');
  if (!cont) return;
  cont.querySelectorAll<HTMLElement>('.visor-mueble-activo').forEach((el) => {
    el.classList.remove('visor-mueble-activo');
  });
  if (!muebleActivoId) return;
  cont.querySelectorAll<HTMLElement>('[data-inplace-card]').forEach((el) => {
    if (el.dataset.id !== muebleActivoId) return;
    el.classList.add('visor-mueble-activo');
  });
}

// =============================================================================
// RENDER
// =============================================================================

/** Contenido de una celda del Visor (contenedores y objetos con esa coordenada). */
function renderVisor(): void {
  const cont = document.getElementById('visorHabitacion');
  if (!cont) return;
  // Purga absoluta del contenedor en caliente: el navegador destruye los
  // minimapas residuales viejos ANTES de iterar y re-dibujar los actualizados.
  // Esto detiene la acumulación en el DOM (minimapas duplicados en paralelo)
  // al mutar/renombrar una división de primer nivel y re-renderizar el Visor.
  cont.innerHTML = '';
  if (!roomActual) {
    if (!divisionesIniciales.length) {
      cont.innerHTML = `<div class="visor-placeholder">
        <div class="visor-placeholder-ico">🏠</div>
        <p class="visor-placeholder-texto">Cargando minimapas de las plantas del Estok activo...</p>
      </div>`;
    } else {
      cont.innerHTML = `<div class="visor-default">
        <div class="visor-default-encabezado">
          <span class="visor-titulo">🗺️ Minimapas de las plantas</span>
          <span class="visor-default-sub">Seleccioná una habitación encastrada en el Mapa Estok para inspeccionarla en este Visor.</span>
        </div>
        <div class="visor-default-minimapas">
          ${divisionesIniciales.map((d) => minimapaDivisionHtml(d, habitacionesDeDivision(d.id))).join('')}
        </div>
      </div>`;
    }
    return;
  }

  const room = roomActual;
  const med = medidasDe(room);
  const puerta = room.posicion_puerta || null;

  const items: ItemElastico[] = contenedoresRoom.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    ui_left: c.ui_left,
    ui_top: c.ui_top,
    ui_width: c.ui_width,
    ui_height: c.ui_height,
    fusion_grupo: c.fusion_grupo,
    // Mueble inmueble fijo: el backend rechaza su DELETE → no se expone el 🗑️.
    protegido: c.es_inmueble === true,
    meta:
      (c.subcontenedores_count || 0) > 0 ? `${c.subcontenedores_count} sub` : null,
  }));

  const lienzo = renderLienzoElastico({
    items,
    etiquetaCrear: 'Mueble',
    textoVacio:
      'Esta habitación no tiene muebles/archivadores todavía. Usá «➕ Mueble» para crear el primero, o soltá una caja desde la bandeja inferior.',
    tip: '🧩 <strong>Lienzo elástico de la habitación</strong> · arrastrá cada mueble para acomodarlo, estirá de la esquina, renombrá con clic y <strong>seleccioná 2+ para fusionarlos</strong> en un único espacio con geometría en «L».',
  });

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
    <div id="visorMinimapaSlot"></div>
    <div class="visor-encabezado">
      <span class="visor-titulo">Lienzo 2D de la habitación</span>
      <span class="visor-sub">Rectángulos elásticos: arrastrá, estirá y fusioná libremente.</span>
    </div>
    ${cuerpoConParedesHtml(lienzo, puerta)}
    ${paletaPuertaHtml()}
    <p class="visor-ayuda">Arrastrá muebles libremente dentro del lienzo, o soltá la puerta 🚪 en una de las cuatro paredes de la habitación.</p>
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
      } else if (objId) {
        // Mismo criterio de casillero libre para los objetos extraíbles.
        const ocupado =
          contenedoresRoom.some((x) => x.parent_grid_row === r && x.parent_grid_col === c) ||
          objetosRoom.some((x) => x.parent_grid_row === r && x.parent_grid_col === c);
        if (ocupado) {
          toast('⚠️ Ese casillero ya está ocupado. Elegí un casillero libre.');
          return;
        }
        void asignarObjetoACelda(objId, r, c);
      }
    });
    // Inspección guiada: el minimapa rectangular ilumina en naranja el casillero
    // exacto bajo el cursor/clic para que el operador no se pierda en la grilla.
    celda.addEventListener('mouseenter', () => {
      celdaInspeccionada = { fila: r, col: c };
      refrescarMinimapa();
    });
    celda.addEventListener('click', () => {
      celdaInspeccionada = { fila: r, col: c };
      refrescarMinimapa();
    });
  });

  // Creación dual en celdas vacías: el botón sutil "➕ Crear mueble aquí" hereda
  // las coordenadas exactas (Fila·Columna) de la celda y abre el modal técnico
  // de creación (AlmacenamientoBoard lo escucha y controla el modalEditar).
  cont.querySelectorAll<HTMLElement>('[data-crear-mueble-celda]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!roomActual) return;
      const fila = Number(btn.dataset.crearFila);
      const col = Number(btn.dataset.crearCol);
      if (!fila || !col) return;
      window.dispatchEvent(
        new CustomEvent('estok:crear-mueble-en-celda', {
          detail: {
            ubicacionId: roomActual.id,
            fila,
            col,
            habitacionNombre: roomActual.nombre,
          },
        }),
      );
    });
  });

  // Muebles del lienzo elástico: un clic (sin arrastre) abre su ficha interna.
  cont.querySelectorAll<HTMLElement>('[data-inplace-card]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const objetivo = e.target as HTMLElement | null;
      if (
        objetivo?.closest(
          '[data-inplace-renombrar],[data-fusion-check],[data-eliminar-grupo],[data-eliminar-item],[data-libre-resize],[data-grupo-resize]',
        )
      ) {
        return;
      }
      const id = el.dataset.id;
      if (!id) return;
      const dato = contenedoresRoom.find((x) => x.id === id);
      if (!dato) return;
      // Solo los muebles (con sub-divisiones o inmuebles fijos) abren ficha.
      if (!(Number(dato.subcontenedores_count) > 0) && !dato.es_inmueble) return;
      muebleActivoId = id;
      aplicarMuebleActivo();
      window.dispatchEvent(
        new CustomEvent('estok:mueble-seleccionado', {
          detail: {
            id,
            nombre: dato.nombre,
            // Hermanos con su geometría real (ui_*): los minimapas de orientación
            // dibujan las proporciones verdaderas de cada mueble de la habitación.
            hermanos: contenedoresRoom,
          },
        }),
      );
    });
  });

  // =========================================================================
  // LIENZO 2D ELÁSTICO (Nivel 2): los muebles de la habitación son rectángulos
  // libres fusionables (motor compartido con Planta Única y el Nivel 3/4).
  // =========================================================================
  const scopeLienzo = cont.querySelector<HTMLElement>('[data-lienzo-elastico]');
  if (scopeLienzo) {
    conectarLienzoElastico({
      scope: scopeLienzo,
      rooms: () =>
        contenedoresRoom.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          ui_left: c.ui_left,
          ui_top: c.ui_top,
          ui_width: c.ui_width,
          ui_height: c.ui_height,
          fusion_grupo: c.fusion_grupo,
        })),
      adaptador: adaptadorContenedores(),
      notificarCambios: notificarEspacios,
      crearItem: crearMuebleEnHabitacion,
    });
    const lienzoEl = scopeLienzo.querySelector<HTMLElement>('[data-lienzo-pu]');
    if (lienzoEl) enlazarDropHabitacion(lienzoEl);
  }

  // Objetos extraíbles: cada bolita de una celda se arrastra a otro casillero
  // o se suelta sobre la bandeja inferior para extraerla.
  cont.querySelectorAll<HTMLElement>('[data-objeto-dnd]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      const de = e as DragEvent;
      const id = el.dataset.objetoDnd;
      if (!id) { de.preventDefault(); return; }
      dragTipoVisor = 'objeto';
      if (de.dataTransfer) {
        de.dataTransfer.setData('application/x-estok-objeto', id);
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

  // =========================================================================
  // MOTOR RECURSIVO DE EDICIÓN IN-PLACE (lienzoInteractivo.ts) — Nivel 3
  // Muebles grandes del Visor de Habitación: renombrar al clic y estirar con
  // el tirador de esquina. El reacomodo ya lo resuelve el DnD nativo de arriba.
  // =========================================================================
  conectarRenombradoEnVivo(cont, renombrarMuebleEnVivo);
  conectarResizeElastico(cont, { onConfirmar: redimensionarMuebleEnVivo });
}

// =============================================================================
// EDICIÓN IN-PLACE DE MUEBLES GRANDES (PUT /api/contenedores/{id}/)
// =============================================================================

async function persistirContenedorVisor(id: string, data: Record<string, unknown>): Promise<boolean> {
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
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo actualizar el mueble.'));
    return false;
  } catch {
    toast('❌ Error de conexión al actualizar el mueble.');
    return false;
  }
}

async function renombrarMuebleEnVivo(id: string, nombre: string): Promise<boolean> {
  const item = contenedoresRoom.find((x) => x.id === id);
  if (!item) return false;
  if (nombre === item.nombre) return true;
  const ok = await persistirContenedorVisor(id, { nombre });
  if (!ok) return false;
  item.nombre = nombre;
  toast(`✅ Mueble renombrado a «${nombre}».`);
  notificarEspacios();
  return true;
}

async function redimensionarMuebleEnVivo(id: string, dim: { ui_width: string; ui_height: string }): Promise<boolean> {
  const item = contenedoresRoom.find((x) => x.id === id);
  if (!item) return false;
  const ok = await persistirContenedorVisor(id, { ui_width: dim.ui_width, ui_height: dim.ui_height });
  if (!ok) return false;
  item.ui_width = dim.ui_width;
  item.ui_height = dim.ui_height;
  toast('✅ Tamaño del mueble actualizado.');
  notificarEspacios();
  return true;
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
  celdaInspeccionada = null;
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
  celdaInspeccionada = null;
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

/** Drop Zone del lienzo de la habitación: coloca el elemento soltado en la sala. */
function enlazarDropHabitacion(lienzo: HTMLElement): void {
  lienzo.addEventListener('dragover', (e) => {
    const de = e as DragEvent;
    e.preventDefault();
    if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
    lienzo.classList.add('lienzo-elastico-drop-activo');
  });
  lienzo.addEventListener('dragleave', () => lienzo.classList.remove('lienzo-elastico-drop-activo'));
  lienzo.addEventListener('drop', (e) => {
    const de = e as DragEvent;
    e.preventDefault();
    lienzo.classList.remove('lienzo-elastico-drop-activo');
    const contId = de.dataTransfer?.getData('application/x-estok-contenedor');
    const objId = de.dataTransfer?.getData('application/x-estok-objeto');
    if (contId) void asignarContenedorACelda(contId, 1, 1);
    else if (objId) void asignarObjetoACelda(objId, 1, 1);
  });
}

/** Crea un mueble nuevo (rectángulo libre) dentro de la habitación activa. */
async function crearMuebleEnHabitacion(): Promise<boolean> {
  if (!roomActual) return false;
  const n = contenedoresRoom.length;
  try {
    const res = await fetch(`${API_BASE_URL}/contenedores/`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: `Mueble ${n + 1}`,
        descripcion: '',
        ubicacion: roomActual.id,
        ui_left: `${6 + (n % 5) * 12}%`,
        ui_top: `${8 + (n % 4) * 16}%`,
        ui_width: '28%',
        ui_height: '24%',
        es_inmueble: false,
      }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return false;
    }
    if (res.ok) {
      toast(`✅ «Mueble ${n + 1}» creado en «${roomActual.nombre}».`);
      notificarEspacios();
      return true;
    }
    const err = await res.json().catch(() => ({}));
    toast('❌ ' + (err?.detail || err?.error || 'No se pudo crear el mueble.'));
    return false;
  } catch {
    toast('❌ Error de conexión al crear el mueble.');
    return false;
  }
}

// =============================================================================
// ENTRADA
// =============================================================================

export function initVisor(): void {
  window.addEventListener('estok:habitacion-seleccionada', (e) => {
    const room = (e as CustomEvent<{ room: UbicacionPlano | null }>).detail?.room ?? null;
    roomActual = room;
    celdaInspeccionada = null;
    muebleActivoId = null;
    if (!roomActual) {
      renderVisor();
      return;
    }
    void cargarContenido().then(() => {
      renderVisor();
      enlazarVisor();
      aplicarMuebleActivo();
    });
  });
  // Sincroniza el resaltado del panel izquierdo cuando la selección se dispara
  // desde el propio panel derecho (chips / «Abrir ficha» del Visor Contenedor Grande).
  window.addEventListener('estok:mueble-destacado', (e) => {
    const detalle = (e as CustomEvent<{ id?: string | null }>).detail ?? {};
    muebleActivoId = detalle?.id ?? null;
    aplicarMuebleActivo();
  });
  // Refresco en caliente ante cambios externos (movimientos/eliminaciones).
  window.addEventListener('estok:espacios-cambiados', () => {
    if (roomActual) {
      void cargarContenido().then(() => {
        renderVisor();
        enlazarVisor();
        aplicarMuebleActivo();
      });
    } else {
      // Sin habitación seleccionada: re-pintar los minimapas iniciales de plantas.
      void cargarDivisionesIniciales();
    }
  });
  // Estado inicial: planos proporcionales de "Planta Alta" y "Planta Baja" en
  // paralelo (cada ambiente con su silueta real ui_width/ui_height + icono).
  void cargarDivisionesIniciales();
  renderVisor();
}

