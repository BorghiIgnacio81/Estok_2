// =============================================================================
// PASO 3 DEL ASISTENTE — «ESPACIO FINAL» DE LA HABITACIÓN SELECCIONADA
// -----------------------------------------------------------------------------
// El embudo del Paso 3 ofrece «Espacio Final» sólo a la habitación que está
// pasando por el modal. Este módulo expone el MISMO control canónico
// (lib/espacioFinal.ts) para CUALQUIER habitación elegida en el combobox (Baño,
// Cocina, Pasillo…), de modo que la declaración terminal esté siempre
// disponible y refleje el estado REAL persistido en PostgreSQL.
//
// Persistencia: PUT parcial `{ espacio_unico }` sobre la Ubicación, el mismo
// contrato que usa Almacenamiento. Vive acá (y no en pasoDivisiones.ts) para
// respetar el límite de 400 líneas por módulo.
// =============================================================================

import { guardarUbicacion } from '../mapaJerarquico';
import { checkboxEspacioFinalHtml, GUIA_ESPACIO_FINAL } from '../espacioFinal';
import type { RecursoCreado } from './api';
import { avisoGlobal } from './comunes';

/** id del checkbox en el DOM del Paso 3 (único por pantalla). */
export const ID_ESPACIO_FINAL_DIVISIONES = 'onbDivisionEspacioUnico';

/** Markup del checkbox canónico + su leyenda de guía para la habitación dada. */
export function htmlEspacioFinalHabitacion(ambiente: RecursoCreado): string {
  return `
    <div class="mt-3">
      ${checkboxEspacioFinalHtml({
        id: ID_ESPACIO_FINAL_DIVISIONES,
        marcado: Boolean(ambiente.espacioUnico),
        valor: ambiente.id,
      })}
      <p class="mt-1 text-[11px] text-gray-500 leading-relaxed">${GUIA_ESPACIO_FINAL}</p>
    </div>`;
}

/**
 * Persiste la declaración de ESPACIO FINAL de la habitación con un PUT parcial y
 * avisa por el canal global. Mantiene sincronizado el estado local del listado
 * del Paso 3 (chip de decisión). El campo persistido sigue siendo `espacio_unico`.
 */
export function persistirEspacioFinalHabitacion(
  ambiente: RecursoCreado,
  marcado: boolean,
): void {
  ambiente.espacioUnico = marcado;
  void guardarUbicacion(ambiente.id, { espacio_unico: marcado }).then((ok) => {
    avisoGlobal(
      ok
        ? marcado
          ? `✅ «${ambiente.nombre}» declarado Espacio Final.`
          : `🧩 «${ambiente.nombre}» vuelve a admitir divisiones internas.`
        : '⚠️ No se pudo guardar «Espacio Final». Reintentá.',
    );
  });
}
