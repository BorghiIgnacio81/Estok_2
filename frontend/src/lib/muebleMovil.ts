// =============================================================================
// «MUEBLE / OBJETO» — CHECKBOX CANÓNICO DE MOVILIDAD (Contenedor)
// -----------------------------------------------------------------------------
// Control ÚNICO y reutilizable que declara una pieza como BULTO MOVIBLE: se
// lista en la canasta «Elementos por ubicar» y en la pantalla de Objetos.
// Destildado (default del Lote 25) = ARQUITECTURA del espacio, excluida de raíz.
//
// Al tildarlo se despliegan las PROPIEDADES DEL OBJETO declarado (Dueño,
// Categoría, Estado de conservación, Valor estimado, Notas, datos patrimoniales
// y fotos), persistidas en el Objeto espejo del Contenedor
// (lib/objetoEspacio.ts + services.objeto_espacio).
//
// REGLA DE POSICIÓN (Lote 26): este control se renderiza SIEMPRE exactamente
// DEBAJO del control «Espacio Único» (lib/espacioUnico.ts), para que el operador
// vea los dos disyuntores del MISMO espacio mientras modela una habitación.
//
// Aplica SÓLO a Contenedor: el modelo Ubicacion no tiene `declarado_movible`.
// El helper es PURO (markup + lectura); la persistencia la resuelve el panel
// (PUT parcial multi-tenant sobre /api/contenedores/{id}/).
// =============================================================================

import { propiedadesObjetoEspacioHtml } from './objetoEspacio';

export const ETIQUETA_MUEBLE_MOVIL = 'Declarar como Mueble / Objeto';

/** Ayuda contextual del control (título nativo). */
export const AYUDA_MUEBLE_MOVIL =
  'Tildado: la pieza se lista en «Elementos por ubicar» y en la pantalla de Objetos, y se habilitan sus datos de objeto (dueño, categoría, estado y valor). Destildado (default): ARQUITECTURA del espacio, excluida de raíz.';

export interface OpcionesMuebleMovil {
  /** id del <input type="checkbox"> (único en el documento). */
  id: string;
  /** Estado inicial del control. */
  marcado: boolean;
  /** Valor emitido en `data-mueble-movil` (por defecto, el propio `id`). */
  valor?: string;
}

/** Datos mínimos del nodo activo para el disyuntor de movilidad. */
export interface NodoMovilidad {
  /** Naturaleza del nodo ('contenedor' | 'habitacion' | 'planta'). */
  tipo: string;
  /** UUID real del Contenedor/Ubicación activa. */
  id: string;
  /** Valor de `declarado_movible` vigente en la base. */
  declaradoMovible: boolean;
}

/**
 * Markup del checkbox reutilizable: misma cara en toda la app (píldora con el
 * tilde + la etiqueta y la ayuda en el `title`). El valor viaja en el atributo
 * `data-mueble-movil` para que el contenedor padre delegue el `change`.
 */
export function checkboxMuebleMovilHtml(opciones: OpcionesMuebleMovil): string {
  const { id, marcado, valor } = opciones;
  const dataValor = valor ?? id;
  return `<label for="${id}" title="${AYUDA_MUEBLE_MOVIL}" class="inline-flex items-center gap-2 cursor-pointer select-none">
      <input id="${id}" type="checkbox" data-mueble-movil="${dataValor}"${marcado ? ' checked' : ''}
        class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer" />
      <span class="text-xs font-medium text-gray-700">🎒 ${ETIQUETA_MUEBLE_MOVIL}</span>
    </label>`;
}

/**
 * Línea canónica del disyuntor, SIEMPRE debajo del control «Espacio Único».
 * Las Ubicaciones (habitación/planta) no tienen `declarado_movible` en el
 * backend, así que devuelven cadena vacía: nunca un control inútil.
 */
export function lineaMuebleMovilHtml(nodo: NodoMovilidad, idControl: string): string {
  if (nodo.tipo !== 'contenedor') return '';
  return `<div class="portal-movible-linea">${checkboxMuebleMovilHtml({
    id: idControl,
    marcado: nodo.declaradoMovible,
    valor: nodo.id,
  })}${propiedadesObjetoEspacioHtml(nodo.declaradoMovible)}</div>`;
}
