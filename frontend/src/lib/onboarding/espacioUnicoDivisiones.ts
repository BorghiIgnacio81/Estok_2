// =============================================================================
// PASO 3 DEL ASISTENTE — «ESPACIO ÚNICO» DE LA HABITACIÓN SELECCIONADA
// -----------------------------------------------------------------------------
// El embudo del Paso 3 ofrece «Espacio Único» sólo a la habitación que está
// pasando por el modal. Este módulo expone el MISMO control canónico
// (lib/espacioUnico.ts) para CUALQUIER habitación elegida en el combobox (Baño,
// Cocina, Pasillo…), de modo que la declaración monolítica esté siempre
// disponible y refleje el estado REAL persistido en PostgreSQL.
//
// Persistencia: PUT parcial `{ espacio_unico }` sobre la Ubicación, el mismo
// contrato que usa Almacenamiento. Vive acá (y no en pasoDivisiones.ts) para
// respetar el límite de 400 líneas por módulo.
// =============================================================================

import { guardarUbicacion } from '../mapaJerarquico';
import { checkboxEspacioUnicoHtml, GUIA_ESPACIO_UNICO } from '../espacioUnico';
import type { RecursoCreado } from './api';
import { avisoGlobal } from './comunes';

/** id del checkbox en el DOM del Paso 3 (único por pantalla). */
export const ID_ESPACIO_UNICO_DIVISIONES = 'onbDivisionEspacioUnico';

/** Markup del checkbox canónico + su leyenda de guía para la habitación dada. */
export function htmlEspacioUnicoHabitacion(ambiente: RecursoCreado): string {
  return `
    <div class="mt-3">
      ${checkboxEspacioUnicoHtml({
        id: ID_ESPACIO_UNICO_DIVISIONES,
        marcado: Boolean(ambiente.espacioUnico),
        valor: ambiente.id,
      })}
      <p class="mt-1 text-[11px] text-gray-500 leading-relaxed">${GUIA_ESPACIO_UNICO}</p>
    </div>`;
}

/**
 * Persiste la declaración monolítica de la habitación con un PUT parcial y
 * avisa por el canal global. Mantiene sincronizado el estado local del
 * listado del Paso 3 (chip de decisión).
 */
export function persistirEspacioUnicoHabitacion(
  ambiente: RecursoCreado,
  marcado: boolean,
): void {
  ambiente.espacioUnico = marcado;
  void guardarUbicacion(ambiente.id, { espacio_unico: marcado }).then((ok) => {
    avisoGlobal(
      ok
        ? marcado
          ? `✅ «${ambiente.nombre}» declarado Espacio Único.`
          : `🧱 «${ambiente.nombre}» vuelve a admitir divisiones internas.`
        : '⚠️ No se pudo guardar «Espacio Único». Reintentá.',
    );
  });
}
