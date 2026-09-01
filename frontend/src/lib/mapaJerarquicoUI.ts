// =============================================================================
// CONTROLADOR DEL MAPA ESTOK - divisiones con sub-grillas matriciales
// -----------------------------------------------------------------------------
// Orquesta el "Mapa Estok" (Nivel 1). Cada división define su PROPIA sub-grilla
// (Filas Internas × Columnas por fila, asimétrica) donde se encastran las
// habitaciones vía Drag & Drop. Al hacer clic sobre una habitación encastrada
// se emite 'estok:habitacion-seleccionada' para que el Visor (visorHabitacion.ts)
// la inspeccione en la columna derecha.
// =============================================================================

import {
  PISO_PRIMERO,
  PISO_BAJA,
  toast,
  fetchEstokConfig,
  fetchUbicacionesPlano,
  guardarEstokGrid,
  guardarUbicacion,
  esDivisionUbicacion,
  crearDivisionUbicacion,
  filasInternasDe,
  columnasInternasDe,
  columnasDeFilaInterna,
  mapaEstokFilasHtml,
} from './mapaJerarquico';
import type { EstokConfig, UbicacionPlano } from './mapaJerarquico';

// =============================================================================
// ESTADO DEL MAPA
// =============================================================================

interface RefsMapaEstok {
  mapa: HTMLElement | null;
  badge: HTMLElement | null;
}

let refs: RefsMapaEstok = { mapa: null, badge: null };
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
  badge?: HTMLElement | null;
}): Promise<void> {
  refs = { mapa: opts.mapa ?? null, badge: opts.badge ?? null };
  if (!refs.mapa) return;

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

  // Refresco en vivo: cuando el wizard "✏️ Editar Estructura" (o cualquier
  // mutación del mapa) dispara estok:espacios-cambiados, se recarga el panel
  // SIN re-enlazar los controles estáticos (evita listeners duplicados).
  window.addEventListener('estok:espacios-cambiados', () => recargarMapaJerarquico());
}

/** Recarga divisiones/habitaciones y re-renderiza el panel del Mapa Estok. */
function recargarMapaJerarquico(): void {
  if (!estok) return;
  void (async () => {
    await cargarDatos();
    render();
    enlazar();
    notificarPlanta();
  })();
}

function render(): void {
  if (!estok) return;
  if (refs.mapa) {
    refs.mapa.innerHTML = `
      <div class="mapaJerarquico">
        ${mapaEstokFilasHtml({
          filas: filasActivas(),
          divisiones,
          habitaciones,
          filaActiva,
        })}
      </div>`;
  }
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

  // Drag & drop: soltar una habitación en una CELDA concreta de la sub-grilla.
  refs.mapa?.querySelectorAll<HTMLElement>('[data-celda-division]').forEach((celda) => {
    const divisionId = celda.dataset.celdaDivision;
    const r = Number(celda.dataset.celdaRow);
    const c = Number(celda.dataset.celdaCol);
    if (!divisionId || !r || !c) return;
    celda.addEventListener('dragover', (e: Event) => {
      e.preventDefault();
      if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.dropEffect = 'move';
      celda.classList.add('mapa-celda-dnd-activo');
    });
    celda.addEventListener('dragleave', () => celda.classList.remove('mapa-celda-dnd-activo'));
    celda.addEventListener('drop', (e: Event) => {
      const de = e as DragEvent;
      e.preventDefault();
      celda.classList.remove('mapa-celda-dnd-activo');
      const id = de.dataTransfer?.getData('application/x-estok-ubicacion');
      if (id) void asignarHabitacionACelda(id, divisionId, r, c);
    });
  });

  // Drag & drop: soltar una habitación en el cuerpo de la división → 1ª celda libre.
  refs.mapa?.querySelectorAll<HTMLElement>('[data-fila-drop]').forEach((filaEl) => {
    const cont = filaEl.closest<HTMLElement>('[data-division-id]');
    const divisionId = cont?.dataset.divisionId || '';
    if (!divisionId) return;
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
      if (id) void asignarHabitacionADivision(id, divisionId);
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

  // Filas Internas de la división (NumericUp/Down en el encabezado).
  refs.mapa?.querySelectorAll<HTMLElement>('[data-div-filas]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const divisionId = btn.dataset.division;
      const div = divisiones.find((d) => d.id === divisionId);
      if (!div) return;
      const delta = btn.dataset.divFilas === 'mas' ? 1 : -1;
      void cambiarFilasInternas(div, filasInternasDe(div) + delta);
    });
  });
  refs.mapa?.querySelectorAll<HTMLInputElement>('[data-div-filas-input]').forEach((input) => {
    input.addEventListener('change', () => {
      const divisionId = input.dataset.divFilasInput;
      const div = divisiones.find((d) => d.id === divisionId);
      if (!div) return;
      void cambiarFilasInternas(div, Number(input.value));
    });
  });

  // Columnas exclusivas por fila interna (grilla asimétrica [3,2,2]).
  refs.mapa?.querySelectorAll<HTMLElement>('[data-div-cols]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const divisionId = btn.dataset.division;
      const fila = Number(btn.dataset.fila);
      const div = divisiones.find((d) => d.id === divisionId);
      if (!div || !fila) return;
      const actual = columnasDeFilaInterna(div, fila);
      const delta = btn.dataset.divCols === 'mas' ? 1 : -1;
      void cambiarColumnasFilaInterna(div, fila, actual + delta);
    });
  });
  refs.mapa?.querySelectorAll<HTMLInputElement>('[data-div-cols-input]').forEach((input) => {
    input.addEventListener('change', () => {
      const divisionId = input.dataset.divColsInput;
      const fila = Number(input.dataset.fila);
      const div = divisiones.find((d) => d.id === divisionId);
      if (!div || !fila) return;
      void cambiarColumnasFilaInterna(div, fila, Number(input.value));
    });
  });

  // Crear división en caliente desde el placeholder de una fila sin registro.
  refs.mapa?.querySelectorAll<HTMLElement>('[data-crear-division]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fila = Number(btn.dataset.crearDivision);
      if (!fila) return;
      const nombre = window.prompt(
        `Ingrese el nombre de la nueva división (ej: 1er Piso, Planta Baja) — Fila ${fila}`,
        fila === 1 ? '1er Piso' : fila === 2 ? 'Planta Baja' : `División ${fila}`,
      );
      if (nombre && nombre.trim()) void crearDivisionConNombre(fila, nombre.trim());
    });
  });

  // Selección de habitación encastrada → abre el Visor en la columna derecha.
  refs.mapa?.querySelectorAll<HTMLElement>('[data-seleccionar-habitacion]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.seleccionarHabitacion;
      const room = habitaciones.find((h) => h.id === id);
      if (room) {
        window.dispatchEvent(new CustomEvent('estok:habitacion-seleccionada', { detail: { room } }));
      }
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

/** Primera celda libre de la sub-grilla de una división (1-based). */
function primerCeldaLibre(div: UbicacionPlano): { r: number; c: number } | null {
  const filasInt = filasInternasDe(div);
  const ocupadas = new Set(
    habitaciones
      .filter((h) => h.parent_ubicacion === div.id && h.parent_grid_row && h.parent_grid_col)
      .map((h) => `${h.parent_grid_row}-${h.parent_grid_col}`),
  );
  for (let r = 1; r <= filasInt; r++) {
    const cols = columnasDeFilaInterna(div, r);
    for (let c = 1; c <= cols; c++) {
      if (!ocupadas.has(`${r}-${c}`)) return { r, c };
    }
  }
  return null;
}

/**
 * Encastra una habitación en la celda (r,c) de la sub-grilla de una división.
 * PUT /api/ubicaciones/{id}/ con parent_ubicacion (parent_id) + parent_grid_row
 * (grid_row) + parent_grid_col (grid_col) como enteros 1-based válidos.
 */
async function asignarHabitacionACelda(id: string, divisionId: string, r: number, c: number): Promise<void> {
  const u = habitaciones.find((x) => x.id === id);
  const div = divisiones.find((d) => d.id === divisionId);
  if (!u || !div) return;
  const filaEntera = Math.floor(Number(r));
  const colEntera = Math.floor(Number(c));
  if (!filaEntera || !colEntera) {
    toast('❌ Coordenadas de matriz inválidas.');
    return;
  }
  const ok = await guardarUbicacion(id, {
    parent_ubicacion: divisionId,
    parent_grid_row: filaEntera,
    parent_grid_col: colEntera,
    piso: div.piso || (filaEntera === 1 ? PISO_PRIMERO : PISO_BAJA),
  });
  if (ok) {
    u.parent_ubicacion = divisionId;
    u.parent_grid_row = filaEntera;
    u.parent_grid_col = colEntera;
    toast(`📍 «${u.nombre}» encastrada en ${div.nombre} (F${filaEntera}·C${colEntera}).`);
    notificarEspacios();
    await cargarDatos();
  } else {
    toast('❌ No se pudo guardar el encastre.');
  }
  render();
  enlazar();
  notificarPlanta();
}

/** Encastra una habitación en la primera celda libre de la división. */
async function asignarHabitacionADivision(id: string, divisionId: string): Promise<void> {
  const div = divisiones.find((d) => d.id === divisionId);
  if (!div) return;
  const celda = primerCeldaLibre(div);
  if (!celda) {
    toast('ℹ️ La sub-grilla de esta división está completa.');
    return;
  }
  await asignarHabitacionACelda(id, divisionId, celda.r, celda.c);
}

/** Cambia la cantidad de Filas Internas de una división (ajusta la asimétrica). */
async function cambiarFilasInternas(div: UbicacionPlano, filasNuevas: number): Promise<void> {
  const f = Math.max(1, Math.min(12, Math.floor(Number(filasNuevas)) || 1));
  if (f === filasInternasDe(div)) return;
  const def = columnasInternasDe(div);
  const cfg = Array.isArray(div.grid_filas_config) ? div.grid_filas_config.slice(0, f) : null;
  if (cfg && cfg.length < f) {
    while (cfg.length < f) cfg.push(def);
  }
  const ok = await guardarUbicacion(div.id, { grid_filas: f, grid_filas_config: cfg });
  if (ok) {
    div.grid_filas = f;
    div.grid_filas_config = cfg;
    toast(`✅ «${div.nombre}» ahora tiene ${f} filas internas.`);
    notificarEspacios();
    await cargarDatos();
  } else {
    toast('❌ No se pudo guardar las filas internas.');
  }
  render();
  enlazar();
}

/** Cambia las Columnas de una fila interna específica (grilla asimétrica). */
async function cambiarColumnasFilaInterna(div: UbicacionPlano, fila: number, colsNuevas: number): Promise<void> {
  const f = Math.max(1, Math.floor(Number(fila)) || 1);
  const c = Math.max(1, Math.min(12, Math.floor(Number(colsNuevas)) || 1));
  if (c === columnasDeFilaInterna(div, f)) return;
  const def = columnasInternasDe(div);
  const filasInt = filasInternasDe(div);
  const cfg: number[] = [];
  for (let r = 1; r <= filasInt; r++) {
    cfg.push(r === f ? c : columnasDeFilaInterna(div, r));
  }
  const configFinal = cfg.every((v) => v === def) ? null : cfg;
  const ok = await guardarUbicacion(div.id, { grid_filas_config: configFinal });
  if (ok) {
    div.grid_filas_config = configFinal;
    toast(`✅ «${div.nombre}» · Fila ${f} ahora tiene ${c} columnas.`);
    notificarEspacios();
    await cargarDatos();
  } else {
    toast('❌ No se pudo guardar las columnas de la fila.');
  }
  render();
  enlazar();
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
