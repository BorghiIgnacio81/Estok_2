// =============================================================================
// PLANO DE HABITACIONES (Nivel 2) - iconografía contextual (render puro)
// -----------------------------------------------------------------------------
// Iconografía contextual por SUBTIPO físico del espacio: familia del icono
// canónico `iconoDeEspacio` (lib/iconosFisicos.ts): 🏠 habitación común · 🚿
// baño/ducha · 🍽️ cocina/comedor · 🚪 pasillo · 📦 depósito · 🏡 porche ·
// 🌳 patio · 🧺 lavadero · 🚗 garaje · 🛋️ living · 🛌 suite.
// El dibujado de las tarjetas se delega al LIENZO ELÁSTICO 2D unificado
// (mapaPlantaUnica.renderLienzoElastico): rectángulos libres con geometría
// nativa ui_left/ui_top/ui_width/ui_height, SIN grilla matricial rígida.
// Consumido por el lienzo de edición de Almacenamiento, el selector de Objetos
// y la Mudanza (UN solo criterio de iconos en toda la app).
// =============================================================================

import { iconoDeEspacio } from './iconosFisicos';

/**
 * Icono contextual de un ESPACIO/habitación según su nombre. Delega en la
 * fuente ÚNICA `iconoDeEspacio` (iconosFisicos.ts) para que Almacenamiento,
 * Objetos y Mudanza muestren exactamente el mismo icono.
 */
export function iconoDeHabitacion(nombre: string): string {
  return iconoDeEspacio(nombre);
}

