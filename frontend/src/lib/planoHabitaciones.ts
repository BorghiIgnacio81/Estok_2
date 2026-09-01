// =============================================================================
// PLANO DE HABITACIONES (Nivel 2) - helpers de render PUROS
// -----------------------------------------------------------------------------
// Funciones sin estado: reciben datos y devuelven HTML. Incluyen la
// iconografía contextual por PRIMERA PALABRA del nombre del espacio
// (Baño 🚽 · Ropero 🗄️ · Suite 🛌 · Habitación 🛏️ · resto 🏠) y las celdas
// del plano matricial asimétrico real ([3,2,2]) con sus receptáculos Drop Zone.
// Consumido únicamente por src/lib/mapaCasitaNavegable.ts.
// =============================================================================

import { escapeHtml } from './mapaJerarquico';
import type { UbicacionPlano } from './mapaJerarquico';

/**
 * Iconografía contextual dinámica por nombre del espacio.
 * Evalúa la PRIMERA PALABRA (nombre.trim().split(' ')[0]) con reglas estrictas:
 *   "Baño"      → 🚽   (inodoro)
 *   "Ropero"    → 🗄️   (mueble/archivador)
 *   "Suite"     → 🛌   (cama matrimonial grande)
 *   "Habitación"→ 🛏️   (cama simple, siempre que no sea suite)
 *   Pasillo u otro → 🏠 (icono base de la casa)
 */
export function iconoDeHabitacion(nombre: string): string {
  const primeraPalabra = (nombre.trim().split(' ')[0] || '').toLowerCase();
  const nombreCompleto = ` ${nombre.trim().toLowerCase()} `;
  if (primeraPalabra.includes('baño') || primeraPalabra.includes('bano')) return '🚽';
  if (primeraPalabra.includes('ropero')) return '🗄️';
  if (primeraPalabra.includes('suite') || nombreCompleto.includes(' suite ')) return '🛌';
  if (primeraPalabra.includes('habitación') || primeraPalabra.includes('habitacion')) return '🛏️';
  return '🏠';
}

/** Celda ocupada del plano: receptáculo de la habitación encastrada. */
export function celdaOcupadaHtml(room: UbicacionPlano, r: number, c: number): string {
  const meta = [
    `F${r}·C${c}`,
    (room.contenedores_count || 0) > 0 ? `${room.contenedores_count} cont` : null,
    (room.objetos_count || 0) > 0 ? `${room.objetos_count} obj` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `
  <button type="button" class="casita-celda casita-celda-ocupada" data-casita-celda data-room-id="${room.id}" title="Abrir «${escapeHtml(room.nombre)}» en el Visor de la derecha">
    <span class="casita-celda-ico">${iconoDeHabitacion(room.nombre)}</span>
    <span class="casita-celda-nombre">${escapeHtml(room.nombre)}</span>
    ${meta ? `<span class="casita-celda-meta">${escapeHtml(meta)}</span>` : ''}
  </button>`;
}

/** Celda libre del plano: receptáculo vacío estilo Drop Zone. */
export function celdaVaciaHtml(r: number, c: number): string {
  return `
  <div class="casita-celda casita-celda-vacia" title="Casillero libre F${r}·C${c} — receptáculo de habitación">
    <span class="casita-celda-coord">F${r}·C${c}</span>
    <span class="casita-celda-mas">＋</span>
  </div>`;
}

/** Tarjeta compacta para habitaciones sueltas (sin encastre matricial). */
export function tarjetaHabitacion(h: UbicacionPlano): string {
  const coord =
    h.parent_grid_row && h.parent_grid_col ? `F${h.parent_grid_row}·C${h.parent_grid_col}` : 'Suelta';
  const meta = [
    coord,
    (h.contenedores_count || 0) > 0 ? `${h.contenedores_count} cont` : null,
    (h.objetos_count || 0) > 0 ? `${h.objetos_count} obj` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `
  <button type="button" class="casita-habitacion" data-casita-celda data-room-id="${h.id}" title="Abrir «${escapeHtml(h.nombre)}» en el Visor de la derecha">
    <span class="casita-hab-ico">${iconoDeHabitacion(h.nombre)}</span>
    <span class="casita-hab-nombre">${escapeHtml(h.nombre)}</span>
    ${meta ? `<span class="casita-hab-meta">${escapeHtml(meta)}</span>` : ''}
  </button>`;
}
