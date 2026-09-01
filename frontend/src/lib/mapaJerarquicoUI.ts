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

let refs = { contenedor: null as HTMLElement | null, badge: null as HTMLElement | null };
let estok: EstokConfig | null = null;
let ubicaciones: UbicacionPlano[] = [];
let pisoActivo = PISO_PRIMERO;

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

// =============================================================================
// ENTRADA
// =============================================================================

export async function initMapaJerarquico(
  contenedor: HTMLElement | null,
  badge?: HTMLElement | null,
): Promise<void> {
  refs = { contenedor, badge: badge ?? null };
  if (!contenedor) return;

  const conf = await fetchEstokConfig();
  if (!conf) {
    contenedor.innerHTML =
      '<p class="text-sm text-gray-400 text-center py-6">No se pudo cargar la configuración del Estok.</p>';
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
}

function htmlCasa(): string {
  if (!esCasa()) return '';
  return `
  <div class="macro-estok">
    <div class="macro-estok-encabezado">
      <h3 class="macro-estok-titulo">🏠 Macro-Estok <span class="macro-estok-nombre">${escapeHtml(estok?.nombre || '')}</span></h3>
      <div class="macro-estok-inputs">
        <label class="macro-input-label">Filas
          <input id="macroFilas" type="number" min="1" max="12" value="${filasActivas()}" class="macro-input" aria-label="Filas de la grilla del macro-Estok" />
        </label>
        <label class="macro-input-label">Cols
          <input id="macroColumnas" type="number" min="1" max="12" value="${columnasActivas()}" class="macro-input" aria-label="Columnas de la grilla del macro-Estok" />
        </label>
      </div>
    </div>
    <div class="macro-estok-cuerpo">
      <div class="macro-estok-casa">${casaSvgHtml(pisoActivo, filasActivas(), columnasActivas())}</div>
      <div class="macro-estok-leyenda">
        <p><strong>1er piso</strong> y <strong>Planta baja</strong> son zonas de drag &amp; drop.</p>
        <p>Hacé clic en un piso para inspeccionarlo · Arrastrá una habitación del plano sobre otro piso para re-diagramarla.</p>
        <p class="macro-estok-filas">Grilla actual: <strong>${filasActivas()}×${columnasActivas()}</strong> (editable a la derecha).</p>
      </div>
    </div>
  </div>`;
}

function render(): void {
  if (!refs.contenedor || !estok) return;
  const piso = esCasa() ? pisoActivo : PISO_BAJA;
  refs.contenedor.innerHTML = `
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

function enlazar(): void {
  const casa = refs.contenedor?.querySelector('.macro-estok-casa');
  if (casa) {
    // Selección de piso por clic
    casa.addEventListener('click', (e) => {
      const pisoEl = (e.target as Element).closest('[data-piso-select]');
      const piso = pisoEl?.getAttribute('data-piso-select');
      if (piso && piso !== pisoActivo) {
        pisoActivo = piso;
        render();
        enlazar();
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
  refs.contenedor?.querySelectorAll<HTMLElement>('.plano-habitacion').forEach((tile) => {
    tile.addEventListener('dragstart', (e) => {
      const id = tile.dataset.ubicacionId;
      if (!id) return;
      e.dataTransfer?.setData('application/x-estok-ubicacion', id);
      e.dataTransfer?.setData('text/plain', id);
    });
  });

  // Inputs del macro-Estok (Filas / Columnas)
  refs.contenedor?.querySelector('#macroFilas')?.addEventListener('change', (e) => {
    void cambiarGrillaEstok(Number((e.target as HTMLInputElement).value), null);
  });
  refs.contenedor?.querySelector('#macroColumnas')?.addEventListener('change', (e) => {
    void cambiarGrillaEstok(null, Number((e.target as HTMLInputElement).value));
  });

  // Nombres editables de habitaciones
  refs.contenedor?.querySelectorAll<HTMLInputElement>('[data-nombre-ubicacion]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.nombreUbicacion;
      const nombre = input.value.trim();
      if (id && nombre) void renombrarUbicacion(id, nombre);
    });
  });

  // Selectores de escala (ancho/alto variables)
  refs.contenedor?.querySelectorAll<HTMLElement>('[data-escala]').forEach((btn) => {
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

  // Celdas libres: asignar la primera habitación sin diagramar del piso
  refs.contenedor?.querySelectorAll<HTMLElement>('[data-celda-libre]').forEach((celda) => {
    celda.addEventListener('click', () => {
      const r = Number(celda.dataset.gridRow);
      const c = Number(celda.dataset.gridCol);
      const piso = celda.dataset.piso;
      if (r && c && piso) void asignarEnCelda(piso, r, c);
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

async function asignarEnCelda(piso: string, r: number, c: number): Promise<void> {
  const delPiso = esCasa() ? ubicaciones.filter((x) => x.piso === piso) : ubicaciones;
  const sinAsignar = delPiso.find((x) => !x.parent_grid_row || !x.parent_grid_col);
  if (!sinAsignar) {
    toast('ℹ️ No quedan habitaciones sin diagramar en este piso.');
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
}
