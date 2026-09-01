// =============================================================================
// CONTROLADOR DEL MAPA ESTOK - filas como divisiones Drag & Drop nombradas
// -----------------------------------------------------------------------------
// Orquesta el "Mapa Estok" (Nivel 1) y la paleta de Habitaciones (Nivel 2).
// Cada fila del Mapa Estok es una división persistida como Ubicacion con
// parent_grid_row = N y parent_grid_col = null (esDivisionUbicacion).
// Al incrementar Filas se exige el nombre de la nueva división y se POSTea.
// Toda la lógica de estado y mutaciones vive acá; los renderizadores puros
// (filas-división, minimapas) viven en ./mapaJerarquico.
// =============================================================================

import {
  PISO_PRIMERO,
  PISO_BAJA,
  escapeHtml,
  toast,
  fetchEstokConfig,
  fetchUbicacionesPlano,
  guardarEstokGrid,
  guardarUbicacion,
  esDivisionUbicacion,
  crearDivisionUbicacion,
  eliminarUbicacion,
  mapaEstokFilasHtml,
} from './mapaJerarquico';
import type { EstokConfig, UbicacionPlano } from './mapaJerarquico';

// =============================================================================
// ESTADO DEL MAPA
// =============================================================================

interface RefsMapaEstok {
  mapa: HTMLElement | null;
  paleta: HTMLElement | null;
  badge: HTMLElement | null;
}

let refs: RefsMapaEstok = { mapa: null, paleta: null, badge: null };
let estok: EstokConfig | null = null;
/** Divisiones de fila (parent_grid_row set, parent_grid_col null). */
let divisiones: UbicacionPlano[] = [];
/** Habitaciones (todo el resto de ubicaciones). */
let habitaciones: UbicacionPlano[] = [];
/** Fila/división seleccionada para el filtrado en caliente. null = todas. */
let filaActiva: number | null = null;

function filasActivas(): number {
  return estok?.grid_filas || 3;
}

function columnasActivas(): number {
  return estok?.grid_columnas || 3;
}

/** Notifica al tablero (board) que los espacios cambiaron para que refresque. */
function notificarEspacios(): void {
  window.dispatchEvent(new CustomEvent('estok:espacios-cambiados'));
}

/** Notifica la división (fila) seleccionada para filtrar la cascada en caliente. */
function notificarPlanta(): void {
  const div = divisiones.find((d) => d.parent_grid_row === filaActiva);
  window.dispatchEvent(new CustomEvent('estok:planta-seleccionada', {
    detail: {
      fila: filaActiva,
      nombre: filaActiva ? (div?.nombre || `División ${filaActiva}`) : null,
    },
  }));
}

/** Sincroniza los selectores numéricos del encabezado con la grilla del Estok. */
function sincronizarInputsGrilla(): void {
  const f = document.getElementById('macroFilas') as HTMLInputElement | null;
  const c = document.getElementById('macroColumnas') as HTMLInputElement | null;
  if (f) f.value = String(filasActivas());
  if (c) c.value = String(columnasActivas());
}

/** Recarga divisiones y habitaciones desde el backend. */
async function cargarDatos(): Promise<void> {
  const todas = await fetchUbicacionesPlano();
  divisiones = todas.filter((u) => esDivisionUbicacion(u));
  habitaciones = todas.filter((u) => !esDivisionUbicacion(u));
}

// =============================================================================
// ENTRADA
// =============================================================================

export async function initMapaJerarquico(opts: {
  mapa?: HTMLElement | null;
  paleta?: HTMLElement | null;
  badge?: HTMLElement | null;
}): Promise<void> {
  refs = { mapa: opts.mapa ?? null, paleta: opts.paleta ?? null, badge: opts.badge ?? null };
  if (!refs.mapa && !refs.paleta) return;

  const conf = await fetchEstokConfig();
  if (!conf) {
    if (refs.mapa) {
      refs.mapa.innerHTML =
        '<p class="text-sm text-gray-400 text-center py-6">No se pudo cargar la configuración del Estok.</p>';
    }
    return;
  }
  estok = conf;
  if (refs.badge) {
    refs.badge.textContent = `${estok.grid_filas}×${estok.grid_columnas} · Mapa Estok`;
  }
  await cargarDatos();

  // Sin división seleccionada al inicio: la cascada inferior muestra todas.
  filaActiva = null;

  render();
  enlazar();
  enlazarControlesGrilla();
  notificarPlanta();
}

function paletaChipHtml(u: UbicacionPlano): string {
  const asignada = Boolean(u.parent_grid_row && u.parent_grid_col);
  return `
  <div class="paleta-habitacion${asignada ? '' : ' paleta-habitacion-libre'}" draggable="true" data-ubicacion-id="${u.id}"
    title="${asignada ? `Diagramada en F${u.parent_grid_row}·C${u.parent_grid_col}` : 'Sin diagramar: arrastrala a una fila del Mapa Estok'}">
    <span class="paleta-habitacion-ico">🏠</span>
    <span class="paleta-habitacion-info">
      <span class="paleta-habitacion-nombre">${escapeHtml(u.nombre)}</span>
      <span class="paleta-habitacion-meta">${asignada ? `F${u.parent_grid_row}·C${u.parent_grid_col}` : 'Sin diagramar'}</span>
    </span>
    <button type="button" draggable="false" class="paleta-habitacion-del" data-eliminar-ubicacion="${u.id}" data-nombre="${escapeHtml(u.nombre)}" title="Eliminar esta habitación">❌</button>
  </div>`;
}

function paletaHtml(): string {
  if (!habitaciones.length) {
    return '<p class="text-sm text-gray-400 text-center py-6">No hay habitaciones todavía. Creá una en la sección inferior.</p>';
  }
  return `<div class="paleta-habitaciones">${habitaciones.map((u) => paletaChipHtml(u)).join('')}</div>`;
}

function render(): void {
  if (!estok) return;
  if (refs.mapa) {
    refs.mapa.innerHTML = `
      <div class="mapaJerarquico">
        ${mapaEstokFilasHtml({
          filas: filasActivas(),
          columnas: columnasActivas(),
          divisiones,
          habitaciones,
          filaActiva,
        })}
      </div>`;
  }
  if (refs.paleta) {
    refs.paleta.innerHTML = paletaHtml();
  }
  const contador = document.getElementById('contadorHabitaciones');
  if (contador) contador.textContent = `${habitaciones.length}`;
  sincronizarInputsGrilla();
}

function enlazar(): void {
  // Selección de división por clic en el encabezado de la fila → filtra en caliente.
  refs.mapa?.querySelectorAll<HTMLElement>('[data-fila-select]').forEach((el) => {
    el.addEventListener('click', () => {
      const fila = Number(el.dataset.filaSelect);
      if (fila && fila !== filaActiva) {
        filaActiva = fila;
        render();
        enlazar();
        notificarPlanta();
      }
    });
  });

  // Drag & drop: soltar una habitación en CUALQUIER fila la re-divisiona.
  refs.mapa?.querySelectorAll<HTMLElement>('[data-fila-drop]').forEach((filaEl) => {
    const fila = Number(filaEl.dataset.filaDrop);
    if (!fila) return;
    filaEl.addEventListener('dragover', (e: Event) => {
      e.preventDefault();
      if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.dropEffect = 'move';
      filaEl.classList.add('mapa-fila-drop-activo');
    });
    filaEl.addEventListener('dragleave', () => filaEl.classList.remove('mapa-fila-drop-activo'));
    filaEl.addEventListener('drop', (e: Event) => {
      const de = e as DragEvent;
      e.preventDefault();
      filaEl.classList.remove('mapa-fila-drop-activo');
      const id = de.dataTransfer?.getData('application/x-estok-ubicacion');
      if (id) void asignarHabitacionAFila(id, fila);
    });
  });

  // Nombres interactivos de divisiones: si la fila aún no tiene registro se
  // crea en caliente (POST); si ya existe, se renombra (PUT).
  refs.mapa?.querySelectorAll<HTMLInputElement>('[data-nombre-division]').forEach((input) => {
    input.addEventListener('change', () => {
      const fila = Number(input.dataset.fila);
      const nombre = input.value.trim();
      if (!fila || !nombre) return;
      const div = divisiones.find((d) => d.parent_grid_row === fila);
      if (div) {
        void renombrarDivision(div.id, nombre);
      } else {
        void crearDivisionConNombre(fila, nombre);
      }
    });
  });

  // Drag start en los chips de la paleta Nivel 2 (Habitaciones)
  refs.paleta?.querySelectorAll<HTMLElement>('.paleta-habitacion').forEach((chip) => {
    chip.addEventListener('dragstart', (e) => {
      const id = chip.dataset.ubicacionId;
      if (!id) return;
      e.dataTransfer?.setData('application/x-estok-ubicacion', id);
      e.dataTransfer?.setData('text/plain', id);
    });
  });

  // Eliminación en caliente de habitaciones (DELETE /api/ubicaciones/{id}/)
  refs.paleta?.querySelectorAll<HTMLElement>('[data-eliminar-ubicacion]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.eliminarUbicacion;
      const nombre = btn.dataset.nombre || '';
      if (!id) return;
      if (!window.confirm(`¿Eliminar la habitación «${nombre}»? Esta acción no se puede deshacer.`)) return;
      void eliminarHabitacion(id);
    });
  });
}

/** Bindea UNA SOLA VEZ los controles numéricos del encabezado del Mapa Estok. */
function enlazarControlesGrilla(): void {
  const macroFilas = document.getElementById('macroFilas') as HTMLInputElement | null;
  const macroColumnas = document.getElementById('macroColumnas') as HTMLInputElement | null;
  macroFilas?.addEventListener('change', () => {
    void cambiarGrillaEstok(Number(macroFilas.value), null);
  });
  macroColumnas?.addEventListener('change', () => {
    void cambiarGrillaEstok(null, Number(macroColumnas.value));
  });
  document.querySelectorAll<HTMLElement>('[data-macro-filas]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = btn.dataset.macroFilas === 'mas' ? 1 : -1;
      void cambiarGrillaEstok(filasActivas() + delta, null);
    });
  });
  document.querySelectorAll<HTMLElement>('[data-macro-columnas]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = btn.dataset.macroColumnas === 'mas' ? 1 : -1;
      void cambiarGrillaEstok(null, columnasActivas() + delta);
    });
  });
}

// =============================================================================
// MUTACIONES (persistencia + refresco)
// =============================================================================

async function cambiarGrillaEstok(filas: number | null, columnas: number | null): Promise<void> {
  if (!estok) return;
  const f = Number.isFinite(Number(filas)) ? Math.max(1, Math.min(12, Math.floor(Number(filas)))) : estok.grid_filas;
  const c = Number.isFinite(Number(columnas)) ? Math.max(1, Math.min(12, Math.floor(Number(columnas)))) : estok.grid_columnas;
  if (f === estok.grid_filas && c === estok.grid_columnas) return;

  // REGLA DE CREACIÓN: al incrementar filas, cada fila nueva SIN división en la
  // base de datos exige el nombre (prompt) y se guarda con POST asincrónico.
  if (f > estok.grid_filas) {
    const ok = await crearDivisionesFaltantes(f);
    if (!ok) {
      render();
      enlazar();
      return;
    }
  }

  const ok = await guardarEstokGrid(f, c);
  if (ok) {
    estok.grid_filas = f;
    estok.grid_columnas = c;
    toast(`✅ Grilla del Mapa Estok actualizada a ${f}×${c}.`);
    notificarEspacios();
    await cargarDatos();
  }
  render();
  enlazar();
}

/** Crea con POST las divisiones faltantes para las filas nuevas (con prompt). */
async function crearDivisionesFaltantes(hastaFila: number): Promise<boolean> {
  for (let f = estok!.grid_filas + 1; f <= hastaFila; f++) {
    if (divisiones.some((d) => d.parent_grid_row === f)) continue;
    const nombre = window.prompt(
      `Ingrese el nombre de la nueva división (ej: 1er Piso, Planta Baja) — Fila ${f}`,
      f === 1 ? '1er Piso' : f === 2 ? 'Planta Baja' : `División ${f}`,
    );
    if (!nombre || !nombre.trim()) {
      toast('ℹ️ Creación de división cancelada.');
      return false;
    }
    const creada = await crearDivisionUbicacion(nombre.trim(), f, columnasActivas());
    if (!creada) {
      toast('❌ No se pudo crear la división en la base de datos.');
      return false;
    }
    divisiones.push(creada);
  }
  return true;
}

/** Asigna una habitación arrastrada a una fila-división (PUT con fila y coordenada). */
async function asignarHabitacionAFila(id: string, fila: number): Promise<void> {
  const u = habitaciones.find((x) => x.id === id);
  if (!u) return;
  const div = divisiones.find((d) => d.parent_grid_row === fila);
  // Primera columna libre dentro de la fila (coordenada entera 1-based).
  const ocupadas = habitaciones
    .filter((h) => h.parent_grid_row === fila && h.parent_grid_col)
    .map((h) => h.parent_grid_col as number);
  let col = 1;
  while (ocupadas.includes(col)) col++;
  if (u.parent_grid_row === fila && u.parent_grid_col === col) {
    toast('ℹ️ Esa habitación ya está en esa fila y columna.');
    return;
  }
  const ok = await guardarUbicacion(id, {
    parent_grid_row: fila,
    parent_grid_col: col,
    piso: div?.piso || (fila === 1 ? PISO_PRIMERO : PISO_BAJA),
  });
  if (ok) {
    u.parent_grid_row = fila;
    u.parent_grid_col = col;
    toast(`📍 «${u.nombre}» movida a la división de la fila ${fila}.`);
    notificarEspacios();
    await cargarDatos();
  } else {
    toast('❌ No se pudo guardar la nueva posición.');
  }
  render();
  enlazar();
  notificarPlanta();
}

/** Renombra una división existente (PUT /api/ubicaciones/{id}/). */
async function renombrarDivision(id: string, nombre: string): Promise<void> {
  const ok = await guardarUbicacion(id, { nombre });
  if (ok) {
    const div = divisiones.find((d) => d.id === id);
    if (div) div.nombre = nombre;
    toast('✅ División renombrada.');
    notificarEspacios();
  } else {
    toast('❌ No se pudo guardar el nombre de la división.');
  }
  render();
  enlazar();
  notificarPlanta();
}

/** Crea una división desde el input del encabezado (si la fila no tiene registro). */
async function crearDivisionConNombre(fila: number, nombre: string): Promise<void> {
  const creada = await crearDivisionUbicacion(nombre, fila, columnasActivas());
  if (creada) {
    divisiones.push(creada);
    toast(`✅ División «${nombre}» creada (fila ${fila}).`);
    notificarEspacios();
  } else {
    toast('❌ No se pudo crear la división.');
  }
  render();
  enlazar();
  notificarPlanta();
}

/** Elimina una habitación con DELETE y refresca la UI en caliente. */
async function eliminarHabitacion(id: string): Promise<void> {
  const ok = await eliminarUbicacion(id);
  if (ok) {
    habitaciones = habitaciones.filter((h) => h.id !== id);
    toast('🗑️ Habitación eliminada.');
    notificarEspacios();
  } else {
    toast('❌ No se pudo eliminar la habitación.');
  }
  render();
  enlazar();
}
