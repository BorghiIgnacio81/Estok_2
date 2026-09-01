// =============================================================================
// CONTROLADOR DEL MAPA JERÁRQUICO - estado, render y eventos
// -----------------------------------------------------------------------------
// Orquesta el Mapa Jerárquico Recursivo en la página de almacenamiento.
// Toda la lógica de estado y mutaciones vive acá; los renderizadores puros
// (SVG de la casa, minimapas, plano de planta) viven en ./mapaJerarquico.
// =============================================================================

import {
  PISO_PRIMERO,
  PISO_BAJA,
  ETIQUETAS_PISO,
  TIPO_CASA_2_PISOS,
  escapeHtml,
  toast,
  fetchEstokConfig,
  fetchUbicacionesPlano,
  guardarEstokGrid,
  guardarUbicacion,
  casaSvgHtml,
  planoPlantaHtml,
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
let ubicaciones: UbicacionPlano[] = [];
let pisoActivo = PISO_BAJA;

function esCasa(): boolean {
  return estok?.tipo_layout === TIPO_CASA_2_PISOS;
}

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

/** Notifica la planta/macro-división seleccionada para filtrar en caliente. */
function notificarPlanta(): void {
  const piso = esCasa() ? pisoActivo : null;
  window.dispatchEvent(new CustomEvent('estok:planta-seleccionada', { detail: { piso } }));
}

/** Sincroniza los selectores numéricos del encabezado con la grilla del Estok. */
function sincronizarInputsGrilla(): void {
  const f = document.getElementById('macroFilas') as HTMLInputElement | null;
  const c = document.getElementById('macroColumnas') as HTMLInputElement | null;
  if (f) f.value = String(filasActivas());
  if (c) c.value = String(columnasActivas());
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
    refs.badge.textContent = esCasa() ? '🏠 Casa de 2 pisos' : '📐 Vista planta única';
  }
  ubicaciones = await fetchUbicacionesPlano();

  // Piso activo inicial: el primer piso con habitaciones diagramadas.
  pisoActivo = esCasa() && ubicaciones.some((u) => u.piso === PISO_PRIMERO)
    ? PISO_PRIMERO
    : PISO_BAJA;

  render();
  enlazar();
  enlazarControlesGrilla();
  notificarPlanta();
}

function htmlCasa(): string {
  if (!esCasa()) return '';
  return `
  <div class="macro-estok">
    <div class="macro-estok-encabezado">
      <h3 class="macro-estok-titulo">🏠 Macro-Estok <span class="macro-estok-nombre">${escapeHtml(estok?.nombre || '')}</span></h3>
    </div>
    <div class="macro-estok-cuerpo">
      <div class="macro-estok-casa">${casaSvgHtml(pisoActivo, filasActivas(), columnasActivas())}</div>
      <div class="macro-estok-leyenda">
        <p><strong>1er piso</strong> y <strong>Planta baja</strong> son zonas de drag &amp; drop.</p>
        <p>Hacé clic en un piso para seleccionar la planta · Arrastrá una habitación sobre otro piso para re-diagramarla.</p>
        <p class="macro-estok-filas">Grilla actual: <strong>${filasActivas()}×${columnasActivas()}</strong> (editable en el encabezado del Mapa Estok).</p>
      </div>
    </div>
  </div>`;
}

function paletaChipHtml(u: UbicacionPlano): string {
  const pisoLabel = esCasa() ? (ETIQUETAS_PISO[u.piso || ''] || 'Planta baja') : 'Planta única';
  const asignada = Boolean(u.parent_grid_row && u.parent_grid_col);
  return `
  <div class="paleta-habitacion${asignada ? '' : ' paleta-habitacion-libre'}" draggable="true" data-ubicacion-id="${u.id}"
    title="${asignada ? `Diagramada en F${u.parent_grid_row}·C${u.parent_grid_col} · ${pisoLabel}` : 'Sin diagramar: arrastrala a una celda del Mapa Estok'}">
    <span class="paleta-habitacion-ico">🏠</span>
    <span class="paleta-habitacion-info">
      <span class="paleta-habitacion-nombre">${escapeHtml(u.nombre)}</span>
      <span class="paleta-habitacion-meta">${asignada ? `F${u.parent_grid_row}·C${u.parent_grid_col}` : 'Sin diagramar'} · ${pisoLabel}</span>
    </span>
  </div>`;
}

function paletaHtml(): string {
  if (!ubicaciones.length) {
    return '<p class="text-sm text-gray-400 text-center py-6">No hay habitaciones todavía. Creá una en la sección inferior.</p>';
  }
  return `<div class="paleta-habitaciones">${ubicaciones.map((u) => paletaChipHtml(u)).join('')}</div>`;
}

function render(): void {
  if (!estok) return;
  const piso = esCasa() ? pisoActivo : PISO_BAJA;
  if (refs.mapa) {
    refs.mapa.innerHTML = `
      <div class="mapaJerarquico">
        ${htmlCasa()}
        ${planoPlantaHtml({
          filas: filasActivas(),
          columnas: columnasActivas(),
          piso,
          ubicaciones,
          esCasa: esCasa(),
        })}
      </div>`;
  }
  if (refs.paleta) {
    refs.paleta.innerHTML = paletaHtml();
  }
  const contador = document.getElementById('contadorHabitaciones');
  if (contador) contador.textContent = `${ubicaciones.length}`;
  sincronizarInputsGrilla();
}

function enlazar(): void {
  const contenedor = refs.mapa ?? refs.paleta;
  const casa = refs.mapa?.querySelector('.macro-estok-casa');

  if (casa) {
    // Selección de piso por clic → filtra la cascada inferior en caliente.
    casa.addEventListener('click', (e) => {
      const pisoEl = (e.target as Element).closest('[data-piso-select]');
      const piso = pisoEl?.getAttribute('data-piso-select');
      if (piso && piso !== pisoActivo) {
        pisoActivo = piso;
        render();
        enlazar();
        notificarPlanta();
      }
    });
    // Drag & drop de habitaciones entre pisos
    casa.addEventListener('dragover', (e: Event) => {
      const de = e as DragEvent;
      e.preventDefault();
      if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
      (e.target as Element).closest('[data-piso-drop]')?.classList.add('macro-estok-piso-hover');
    });
    casa.addEventListener('dragleave', (e: Event) => {
      (e.target as Element).closest('[data-piso-drop]')?.classList.remove('macro-estok-piso-hover');
    });
    casa.addEventListener('drop', (e: Event) => {
      const de = e as DragEvent;
      e.preventDefault();
      (e.target as Element).closest('[data-piso-drop]')?.classList.remove('macro-estok-piso-hover');
      const piso = (e.target as Element).closest('[data-piso-drop]')?.getAttribute('data-piso-drop');
      const id = de.dataTransfer?.getData('application/x-estok-ubicacion');
      if (id && piso) void cambiarPisoUbicacion(id, piso);
    });
  }

  // Drag start en las habitaciones del plano
  contenedor?.querySelectorAll<HTMLElement>('.plano-habitacion').forEach((tile) => {
    tile.addEventListener('dragstart', (e) => {
      const id = tile.dataset.ubicacionId;
      if (!id) return;
      e.dataTransfer?.setData('application/x-estok-ubicacion', id);
      e.dataTransfer?.setData('text/plain', id);
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

  // Nombres editables de habitaciones
  contenedor?.querySelectorAll<HTMLInputElement>('[data-nombre-ubicacion]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.nombreUbicacion;
      const nombre = input.value.trim();
      if (id && nombre) void renombrarUbicacion(id, nombre);
    });
  });

  // Selectores de escala (ancho/alto variables)
  contenedor?.querySelectorAll<HTMLElement>('[data-escala]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.ubicacion;
      const eje = btn.dataset.eje as 'colspan' | 'rowspan';
      const direccion = btn.dataset.escala as 'mas' | 'menos';
      if (!id || (eje !== 'colspan' && eje !== 'rowspan') || (direccion !== 'mas' && direccion !== 'menos')) return;
      const u = ubicaciones.find((x) => x.id === id);
      if (!u) return;
      const actual = Math.max(1, eje === 'colspan' ? (u.grid_colspan || 1) : (u.grid_rowspan || 1));
      const nuevo = Math.max(1, actual + (direccion === 'mas' ? 1 : -1));
      if (nuevo === actual) return;
      void escalarUbicacion(id, eje, nuevo);
    });
  });

  // Celdas libres del Mapa Estok: clic asigna la primera habitación sin
  // diagramar del piso; drop asigna la habitación arrastrada desde la paleta.
  refs.mapa?.querySelectorAll<HTMLElement>('[data-celda-libre]').forEach((celda) => {
    const r = Number(celda.dataset.gridRow);
    const c = Number(celda.dataset.gridCol);
    const piso = celda.dataset.piso;
    if (!r || !c || !piso) return;
    celda.addEventListener('click', () => void asignarEnCelda(piso, r, c));
    celda.addEventListener('dragover', (e: Event) => {
      e.preventDefault();
      if ((e as DragEvent).dataTransfer) (e as DragEvent).dataTransfer!.dropEffect = 'move';
    });
    celda.addEventListener('drop', (e: Event) => {
      const de = e as DragEvent;
      e.preventDefault();
      const id = de.dataTransfer?.getData('application/x-estok-ubicacion');
      if (id) void asignarEnCelda(piso, r, c, id);
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
  const f = filas ?? estok.grid_filas;
  const c = columnas ?? estok.grid_columnas;
  if (!Number.isFinite(f) || !Number.isFinite(c) || f < 1 || c < 1 || f > 12 || c > 12) {
    render();
    enlazar();
    return;
  }
  const ok = await guardarEstokGrid(f, c);
  if (ok) {
    estok.grid_filas = f;
    estok.grid_columnas = c;
    toast(`✅ Grilla del macro-Estok actualizada a ${f}×${c}.`);
    notificarEspacios();
  }
  render();
  enlazar();
}

async function renombrarUbicacion(id: string, nombre: string): Promise<void> {
  const u = ubicaciones.find((x) => x.id === id);
  if (!u) return;
  const ok = await guardarUbicacion(id, { nombre });
  if (ok) {
    u.nombre = nombre;
    toast('✅ Habitación renombrada.');
    notificarEspacios();
  } else {
    toast('❌ No se pudo guardar el nombre.');
  }
  render();
  enlazar();
}

async function escalarUbicacion(id: string, eje: 'colspan' | 'rowspan', valor: number): Promise<void> {
  const u = ubicaciones.find((x) => x.id === id);
  if (!u) return;
  const ok = await guardarUbicacion(id, { [eje]: valor });
  if (ok) {
    if (eje === 'colspan') u.grid_colspan = valor;
    else u.grid_rowspan = valor;
    notificarEspacios();
  } else {
    toast('❌ No se pudo guardar la escala.');
  }
  render();
  enlazar();
}

async function asignarEnCelda(piso: string, r: number, c: number, ubicacionId?: string): Promise<void> {
  const delPiso = esCasa() ? ubicaciones.filter((x) => x.piso === piso) : ubicaciones;
  const sinAsignar = ubicacionId
    ? delPiso.find((x) => x.id === ubicacionId)
    : delPiso.find((x) => !x.parent_grid_row || !x.parent_grid_col);
  if (!sinAsignar) {
    toast(ubicacionId ? 'ℹ️ Esa habitación no pertenece a esta planta.' : 'ℹ️ No quedan habitaciones sin diagramar en este piso.');
    return;
  }
  const ok = await guardarUbicacion(sinAsignar.id, { parent_grid_row: r, parent_grid_col: c });
  if (ok) {
    sinAsignar.parent_grid_row = r;
    sinAsignar.parent_grid_col = c;
    toast(`📍 «${sinAsignar.nombre}» diagramada en F${r}·C${c}.`);
    notificarEspacios();
  } else {
    toast('❌ No se pudo asignar el cuadrante.');
  }
  render();
  enlazar();
}

async function cambiarPisoUbicacion(id: string, piso: string): Promise<void> {
  const u = ubicaciones.find((x) => x.id === id);
  if (!u) return;
  if (u.piso === piso) return;
  // Al cambiar de piso se limpian las coordenadas: debe re-diagramarse.
  const ok = await guardarUbicacion(id, { piso, parent_grid_row: null, parent_grid_col: null });
  if (ok) {
    u.piso = piso;
    u.parent_grid_row = null;
    u.parent_grid_col = null;
    pisoActivo = piso;
    toast(`🏠 «${u.nombre}» movida a ${ETIQUETAS_PISO[piso] || piso}.`);
    notificarEspacios();
  } else {
    toast('❌ No se pudo cambiar de piso.');
  }
  render();
  enlazar();
  notificarPlanta();
}
