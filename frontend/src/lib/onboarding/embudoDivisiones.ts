// =============================================================================
// PASO 3 DEL ASISTENTE — PIEZAS DE VISTA DEL EMBUDO SECUENCIAL
// -----------------------------------------------------------------------------
// Markup PURO del embudo (chip de decisión por habitación + panel con las 3
// vías) para que pasoDivisiones.ts quede como controlador delgado y respete el
// límite de 400 líneas por módulo.
// =============================================================================

import { escapeHtml } from '../mapaJerarquico';
import type { RecursoCreado } from './api';

/** Decisión explícita que el embudo registra por cada habitación real. */
export type Decision = 'divisiones' | 'unico' | 'diferido';

/** Chip de estado (texto + color) de la decisión registrada para una habitación. */
export function etiquetaDecision(decision: Decision | undefined): {
  texto: string;
  clase: string;
} {
  if (decision === 'divisiones')
    return { texto: '✅ Divisiones', clase: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (decision === 'unico')
    return { texto: '⬜ Espacio Único', clase: 'bg-blue-100 text-blue-700 border-blue-200' };
  if (decision === 'diferido')
    return { texto: '⏳ Se modelará más tarde', clase: 'bg-amber-100 text-amber-700 border-amber-200' };
  return { texto: 'Pendiente', clase: 'bg-gray-100 text-gray-500 border-gray-200' };
}

/** Panel del embudo: presenta la SIGUIENTE habitación pendiente con sus 3 vías. */
export function htmlEmbudo(a: RecursoCreado): string {
  return `<div class="rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-4">
    <p class="text-[11px] font-semibold uppercase tracking-wider text-amber-700">Embudo secuencial</p>
    <p class="mt-1 text-sm font-semibold text-gray-800">Siguiente ambiente: <span class="text-amber-800">«${escapeHtml(a.nombre)}»</span></p>
    <p class="mt-1 text-xs text-gray-500 leading-relaxed">Elegí cómo tratar este ambiente para seguir con el siguiente. El paso no se cierra hasta cubrir el 100% de tus habitaciones.</p>
    <div class="mt-3 flex flex-wrap gap-2">
      <button type="button" data-div-crear="${a.id}" class="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition-base">🧱 Crear divisiones ahora</button>
      <button type="button" data-div-unico="${a.id}" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-base">⬜ Espacio Único</button>
      <button type="button" data-div-diferir="${a.id}" class="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-base">⏳ En otro momento</button>
    </div>
  </div>`;
}
