// =============================================================================
// EDICIÓN IN-PLACE DEL PLANO DE HABITACIONES (Nivel 2) - persistencia PUT
// -----------------------------------------------------------------------------
// Conexión entre el plano del "Mapa Estok" y el motor recursivo
// (lienzoInteractivo.ts): clic para renombrar, arrastrar para reacomodar y
// estirar para redimensionar. Vive aparte de mapaCasitaNavegable.ts para
// mantener la disciplina de modularidad (<400-500 líneas por archivo).
// =============================================================================

import {
  toast,
  guardarUbicacion,
  columnasDeFilaInterna,
} from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';
import {
  conectarRenombradoEnVivo,
  conectarReacomodoDrag,
  conectarResizeElastico,
  tokenCssVisual,
} from './lienzoInteractivo';
import type { DestinoDrop, DimensionVisual } from './lienzoInteractivo';

/** Estado del lienzo que la página inyecta (getters sobre sus variables vivas). */
export interface OpcionesEdicionPlanoEnVivo {
  scope: ParentNode;
  filaActiva: () => number | null;
  division: () => UbicacionPlano | null;
  habitaciones: () => UbicacionPlano[];
  notificarCambios: () => void;
}

export function conectarEdicionPlanoEnVivo(opts: OpcionesEdicionPlanoEnVivo): void {
  conectarRenombradoEnVivo(opts.scope, (id, nombre) => renombrarEspacio(opts, id, nombre));
  conectarReacomodoDrag(opts.scope, (id, destino) => reacomodarHabitacion(opts, id, destino));
  conectarResizeElastico(opts.scope, {
    aplicarEstilo: aplicarEstiloFilaEnVivo,
    onConfirmar: (id, dim) => redimensionarHabitacion(opts, id, dim),
  });
}

/** Renombra una habitación del plano activo (clic → input → Enter/blur). */
async function renombrarEspacio(
  opts: OpcionesEdicionPlanoEnVivo,
  id: string,
  nombre: string,
): Promise<boolean> {
  const room = opts.habitaciones().find((h) => h.id === id);
  if (!room) return false;
  if (nombre === room.nombre) return true;
  const ok = await guardarUbicacion(id, { nombre });
  if (!ok) {
    toast('❌ No se pudo renombrar el espacio.');
    return false;
  }
  room.nombre = nombre;
  toast(`✅ Espacio renombrado a «${nombre}».`);
  opts.notificarCambios();
  return true;
}

/**
 * Reacomoda una habitación entre cuadrantes de las filas asimétricas del plano.
 * Si el destino está ocupado por otra habitación encastrada, ambas intercambian
 * coordenadas (swap) para no perder ninguna.
 */
async function reacomodarHabitacion(
  opts: OpcionesEdicionPlanoEnVivo,
  id: string,
  destino: DestinoDrop,
): Promise<boolean> {
  const fila = opts.filaActiva();
  if (!fila) return false;
  const div = opts.division();
  if (!div) return false;
  const cols = columnasDeFilaInterna(div, destino.fila);
  if (!cols || destino.col < 1 || destino.col > cols) {
    toast('⚠️ Ese cuadrante no existe en la fila destino.');
    return false;
  }
  const rooms = opts.habitaciones();
  const room = rooms.find((h) => h.id === id);
  if (!room) return false;
  const yaEsta =
    room.parent_ubicacion === div.id &&
    room.parent_grid_row === destino.fila &&
    room.parent_grid_col === destino.col;
  if (yaEsta) return true;

  const ocupante = rooms.find(
    (h) =>
      h.id !== id &&
      h.parent_ubicacion === div.id &&
      h.parent_grid_row === destino.fila &&
      h.parent_grid_col === destino.col,
  );
  const roomEncastrada =
    room.parent_ubicacion === div.id &&
    room.parent_grid_row != null &&
    room.parent_grid_col != null;
  if (ocupante && !roomEncastrada) {
    toast('⚠️ Para ocupar un casillero con otra habitación, arrastrá una tarjeta ya encastrada (intercambio de cuadrantes).');
    return false;
  }

  const origenFila = room.parent_grid_row ?? destino.fila;
  const origenCol = room.parent_grid_col ?? 1;

  // 1º) El ocupante (si existe) cede su lugar moviéndose al origen de la carta.
  if (ocupante) {
    const okOcupante = await guardarUbicacion(ocupante.id, {
      parent_ubicacion: div.id,
      parent_grid_row: roomEncastrada ? origenFila : destino.fila,
      parent_grid_col: roomEncastrada ? origenCol : destino.col,
    });
    if (!okOcupante) {
      toast('❌ No se pudo intercambiar las habitaciones.');
      return false;
    }
    ocupante.parent_ubicacion = div.id;
    ocupante.parent_grid_row = roomEncastrada ? origenFila : destino.fila;
    ocupante.parent_grid_col = roomEncastrada ? origenCol : destino.col;
  }

  // 2º) La carta arrastrada ocupa el cuadrante destino.
  const ok = await guardarUbicacion(id, {
    parent_ubicacion: div.id,
    parent_grid_row: destino.fila,
    parent_grid_col: destino.col,
  });
  if (!ok) {
    toast('❌ No se pudo reacomodar la habitación.');
    return false;
  }
  room.parent_ubicacion = div.id;
  room.parent_grid_row = destino.fila;
  room.parent_grid_col = destino.col;

  toast(`✅ Habitación reacomodada en F${destino.fila}·C${destino.col}.`);
  opts.notificarCambios();
  return true;
}

/**
 * Aplicación visual EN VIVO del resizing sobre la grilla del plano: convierte el
 * porcentaje del motor en un track fijo en px para esa columna; las columnas
 * vecinas absorben el espacio restante (estiramiento geométricamente real).
 */
function aplicarEstiloFilaEnVivo(carta: HTMLElement, dim: DimensionVisual): void {
  const fila = carta.parentElement as HTMLElement | null;
  if (!fila || !fila.classList.contains('casita-plano-fila')) return;
  const filaAnchoPx = fila.getBoundingClientRect().width || 320;
  const pct = parseFloat(dim.ui_width);
  const pctValido = Number.isFinite(pct) ? Math.min(100, Math.max(15, pct)) : 40;
  // Clamp contra el espacio ya ocupado por otras columnas fijas (evita overflow).
  const celdas = Array.from(fila.children) as HTMLElement[];
  let otrosFijosPx = 0;
  for (const cel of celdas) {
    if (cel === carta) continue;
    const token = tokenCssVisual(cel.dataset.uiWidth);
    if (token && token.endsWith('px')) otrosFijosPx += parseFloat(token) || 0;
  }
  const reservaFr = Math.max(48, filaAnchoPx * 0.12);
  const pxMax = Math.floor(filaAnchoPx - otrosFijosPx - reservaFr);
  const pxTarget = Math.round((filaAnchoPx * pctValido) / 100);
  const pxObjetivo = Math.max(
    72,
    Math.min(pxMax, Math.floor(filaAnchoPx * 0.88), pxTarget),
  );
  carta.style.width = `${pxObjetivo}px`;
  carta.style.height = dim.ui_height;
  const tokens = celdas.map((cel) => {
    if (cel === carta) return `${pxObjetivo}px`;
    return tokenCssVisual(cel.dataset.uiWidth) || 'minmax(0,1fr)';
  });
  fila.style.gridTemplateColumns = tokens.join(' ');
}

/** Persiste las medidas ui_width/ui_height de la habitación estirada. */
async function redimensionarHabitacion(
  opts: OpcionesEdicionPlanoEnVivo,
  id: string,
  dim: DimensionVisual,
): Promise<boolean> {
  const room = opts.habitaciones().find((h) => h.id === id);
  if (!room) return false;
  const ok = await guardarUbicacion(id, { ui_width: dim.ui_width, ui_height: dim.ui_height });
  if (!ok) {
    toast('❌ No se pudo guardar el nuevo tamaño.');
    return false;
  }
  room.ui_width = dim.ui_width;
  room.ui_height = dim.ui_height;
  toast('✅ Tamaño actualizado.');
  opts.notificarCambios();
  return true;
}

