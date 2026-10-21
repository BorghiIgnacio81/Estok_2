// =============================================================================
// «EN TRÁNSITO» · BLOQUE EXTERNO REUTILIZABLE (SIEMPRE FUERA DEL PLANO)
// -----------------------------------------------------------------------------
// El limbo de mudanza («En Tránsito» / «Zona de Mudanza») es una Ubicación
// VIRTUAL de sistema: NO tiene geometría física y JAMÁS debe dibujarse dentro
// del recuadro del plano (taparía los ambientes reales). El motor del mapa lo
// excluye de raíz (lib/ubicacionesVirtuales.ts + lib/mapaPlantaUnica.ts +
// lib/sectoresMinimapa.ts).
//
// Cuando una pantalla permite SELECCIONAR ese estado, lo ofrece con este bloque
// independiente, montado FUERA del host del lienzo. Fuente ÚNICA del markup:
// así ninguna página duplica la tarjeta ni corre el riesgo de volver a meterla
// dentro del plano.
//
// 100% puro: no toca el DOM ni conoce el estado de ningún selector. El clic se
// delega por `data-accion="transito"` desde la capa de navegación que lo use.
// =============================================================================

export interface OpcionesTransitoExterno {
  /** ¿La selección actual del formulario apunta al limbo? */
  activo: boolean;
  /** Nombre visible del estado (default: «En tránsito»). */
  nombre?: string;
  /** Micro-explicación del estado (default: viaja sin ocupar un cuarto). */
  descripcion?: string;
  /** Valor de `data-accion` que escucha la capa de navegación. */
  accion?: string;
}

/**
 * Tarjeta/bloque externo «En tránsito» (fuera del recuadro del mapa).
 * `activo` refleja si la ubicación elegida es el limbo del Estok.
 */
export function bloqueTransitoExternoHtml(opciones: OpcionesTransitoExterno): string {
  const {
    activo,
    nombre = 'En tránsito',
    descripcion = 'Sin ubicación física: el objeto viaja con la mudanza y NO ocupa un cuarto del plano.',
    accion = 'transito',
  } = opciones;
  return `
    <button type="button" data-accion="${accion}" aria-pressed="${activo}"
      class="mb-3 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-base ${
        activo
          ? 'border-amber-400 bg-amber-50 hover:bg-amber-100'
          : 'border-gray-200 bg-white hover:border-amber-300 hover:bg-amber-50/40'
      }">
      <span class="text-xl leading-none" aria-hidden="true">🚚</span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold ${activo ? 'text-amber-800' : 'text-gray-800'}">${nombre}</span>
        <span class="block text-[11px] ${activo ? 'text-amber-700' : 'text-gray-500'}">
          ${descripcion}
        </span>
      </span>
      ${activo ? '<span class="ml-auto shrink-0 rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white">Seleccionado</span>' : ''}
    </button>`;
}
