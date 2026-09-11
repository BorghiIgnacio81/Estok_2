// =============================================================================
// PLANO DE HABITACIONES (Nivel 2) - iconografía contextual (render puro)
// -----------------------------------------------------------------------------
// Iconografía contextual por PRIMERA PALABRA del nombre del espacio
// (Baño 🚽 · Ropero 🗄️ · Suite 🛌 · Habitación 🛏️ · resto 🏠).
// El dibujado de las tarjetas se delega al LIENZO ELÁSTICO 2D unificado
// (mapaPlantaUnica.renderLienzoElastico): rectángulos libres con geometría
// nativa ui_left/ui_top/ui_width/ui_height, SIN grilla matricial rígida.
// Consumido únicamente por src/lib/mapaCasitaNavegable.ts.
// =============================================================================

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

