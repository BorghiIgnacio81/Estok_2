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

/**
 * Celda ocupada del plano: tarjeta interactiva de habitación encastrada.
 * La edición es 100% IN-PLACE sobre el lienzo (sin modales):
 *   - Clic en el nombre  → input en caliente (PUT /api/ubicaciones/{id}/).
 *   - Arrastrar la carta → reacomodo entre cuadrantes de las filas asimétricas.
 *   - Tirar de la esquina → resizing elástico (PUT ui_width/ui_height).
 */
export function celdaOcupadaHtml(room: UbicacionPlano, r: number, c: number): string {
  const meta = [
    `F${r}·C${c}`,
    (room.contenedores_count || 0) > 0 ? `${room.contenedores_count} cont` : null,
    (room.objetos_count || 0) > 0 ? `${room.objetos_count} obj` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const uiW = room.ui_width && room.ui_width !== '100%' ? room.ui_width : null;
  const uiH = room.ui_height && room.ui_height !== 'auto' ? room.ui_height : null;
  const estilo = uiW || uiH
    ? `style="${uiW ? `width:${uiW};` : ''}${uiH ? `height:${uiH};` : ''}"`
    : '';
  return `
  <div class="casita-celda casita-celda-ocupada" ${estilo}
       data-casita-celda data-room-id="${room.id}"
       data-inplace-card data-id="${room.id}" data-inplace-drag draggable="true"
       data-room-row="${r}" data-room-col="${c}"
       data-inplace-drop data-fila="${r}" data-col="${c}"
       data-ui-width="${escapeHtml(uiW || '100%')}" data-ui-height="${escapeHtml(uiH || 'auto')}"
       title="Abrir «${escapeHtml(room.nombre)}» en el Visor de la derecha · Arrastrá para reacomodar · Clic en el nombre para renombrar · Tirá de la esquina para estirar">
    <span class="casita-celda-ico">${iconoDeHabitacion(room.nombre)}</span>
    <span class="casita-celda-nombre casita-renombrable" data-inplace-renombrar data-id="${room.id}" title="Clic para renombrar esta habitación en caliente">${escapeHtml(room.nombre)}</span>
    ${meta ? `<span class="casita-celda-meta">${escapeHtml(meta)}</span>` : ''}
    <span class="casita-resize" data-inplace-resize data-id="${room.id}" title="Estirar para cambiar el tamaño relativo de esta habitación (se guarda automáticamente)"></span>
  </div>`;
}

/** Celda libre del plano: receptáculo vacío Drop Zone (destino de reacomodo). */
export function celdaVaciaHtml(r: number, c: number): string {
  return `
  <div class="casita-celda casita-celda-vacia" data-inplace-drop data-fila="${r}" data-col="${c}" title="Casillero libre F${r}·C${c} — soltá una habitación aquí para reacomodarla">
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
