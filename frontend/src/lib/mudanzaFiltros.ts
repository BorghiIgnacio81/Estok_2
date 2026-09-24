// =============================================================================
// FILTROS REACTIVOS DEL TABLERO DE MUDANZA (barras simétricas de checkboxes)
// -----------------------------------------------------------------------------
// Columna ORIGEN  → Qué se quiere mudar: Objetos sueltos · Muebles · Cajas.
// Columna DESTINO → A qué escala se suelta: Habitaciones · Muebles ·
//                   Espacios / Estantes (suelta fina dentro del contenedor).
//
// Render PURO: la barra se dibuja con `htmlBarraFiltros` y el tablero escucha
// los `change` por delegación (data-filtro-grupo / data-filtro-valor) para
// ocultar o mostrar elementos en el cliente, SIN nuevas peticiones al servidor.
// =============================================================================

import { escapeHtml } from './mapaEstokWizard';

export type FiltroOrigen = 'OBJETO' | 'MUEBLE' | 'CAJA';
export type FiltroDestino = 'HABITACION' | 'MUEBLE' | 'ESPACIO';

export interface OpcionFiltro<T extends string> {
  valor: T;
  etiqueta: string;
  /** Emoji corto para que la barra siga siendo legible en móvil. */
  icono: string;
}

export const FILTROS_ORIGEN: OpcionFiltro<FiltroOrigen>[] = [
  { valor: 'OBJETO', etiqueta: 'Objetos sueltos', icono: '📦' },
  { valor: 'MUEBLE', etiqueta: 'Muebles', icono: '🗄️' },
  { valor: 'CAJA', etiqueta: 'Cajas', icono: '🧰' },
];

export const FILTROS_DESTINO: OpcionFiltro<FiltroDestino>[] = [
  { valor: 'HABITACION', etiqueta: 'Habitaciones', icono: '🏠' },
  { valor: 'MUEBLE', etiqueta: 'Muebles', icono: '🗄️' },
  { valor: 'ESPACIO', etiqueta: 'Espacios / Estantes', icono: '🗂️' },
];

/** Todos los filtros activos (estado inicial del tablero). */
export function filtrosActivos<T extends string>(opciones: OpcionFiltro<T>[]): Set<T> {
  return new Set(opciones.map((o) => o.valor));
}

/**
 * Barra de checkboxes compacta.
 *
 * `conteos` alimenta el número entre paréntesis (cuántos elementos hay
 * disponibles por grupo), de modo que el usuario detecta al instante si su
 * inventario llegó completo aunque tenga el grupo oculto.
 */
export function htmlBarraFiltros<T extends string>(
  grupo: 'origen' | 'destino',
  opciones: OpcionFiltro<T>[],
  activos: Set<T>,
  conteos: Record<T, number>,
): string {
  const items = opciones
    .map((o) => {
      const activo = activos.has(o.valor);
      return `
        <label class="inline-flex max-w-full cursor-pointer select-none items-center gap-1 rounded-lg border px-1.5 py-1 text-[10px] font-semibold sm:text-[11px] ${
          activo
            ? 'border-orange-200 bg-orange-50 text-orange-800'
            : 'border-gray-200 bg-gray-50 text-gray-400'
        }" title="${escapeHtml(o.etiqueta)}">
          <input type="checkbox" class="h-3 w-3 accent-orange-600"
            data-filtro-grupo="${grupo}" data-filtro-valor="${o.valor}" ${activo ? 'checked' : ''} />
          <span aria-hidden="true">${o.icono}</span>
          <span class="min-w-0 truncate">${escapeHtml(o.etiqueta)}</span>
          <span class="shrink-0 text-[9px] font-bold text-gray-400">${conteos[o.valor] ?? 0}</span>
        </label>`;
    })
    .join('');
  return `<div class="flex flex-wrap items-center gap-1" data-filtros-barra="${grupo}">${items}</div>`;
}
