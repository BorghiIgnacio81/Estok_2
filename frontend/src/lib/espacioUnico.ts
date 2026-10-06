// =============================================================================
// «ESPACIO ÚNICO» — CHECKBOX REUTILIZABLE DE BLOQUE MONOLÍTICO
// -----------------------------------------------------------------------------
// Control ÚNICO y reutilizable que declara una pieza estructural (Habitación,
// Espacio o Caja) como un BLOQUE MONOLÍTICO sin subdivisiones internas.
//
// Regla de negocio: un «Espacio Único» está listo para recibir objetos de forma
// DIRECTA, por lo que el motor nunca deja sus ítems en el estado de alerta
// parpadeante «En Tránsito». Las CAJAS nacen con el control tildado por defecto
// (se puede destildar para dividirlas).
//
// El helper es PURO (markup + lectura): la persistencia la decide cada consumidor
// (POST/PUT contra el endpoint que corresponda). El valor viaja en el atributo
// `data-espacio-unico` para que un contenedor padre pueda delegar el `change`.
// =============================================================================

export const ETIQUETA_ESPACIO_UNICO = 'Espacio Único';

/** Ayuda contextual del control (título nativo + micro-texto). */
export const AYUDA_ESPACIO_UNICO =
  'Bloque monolítico sin subdivisiones internas: queda listo para recibir objetos de forma directa (nunca «En Tránsito»). En una Caja viene activado por defecto; destildalo para dividirla.';

export interface OpcionesEspacioUnico {
  /** id del <input type="checkbox"> (único en el documento). */
  id: string;
  /** Estado inicial del control. */
  marcado: boolean;
  /** Valor emitido en `data-espacio-unico` (por defecto, el propio `id`). */
  valor?: string;
  /** true = control deshabilitado (pieza ya monolítica por diseño). */
  deshabilitado?: boolean;
}

/**
 * Markup del checkbox reutilizable. Misma cara en toda la app: una píldora con
 * el tilde + la etiqueta «Espacio Único» y la ayuda en el `title`.
 */
export function checkboxEspacioUnicoHtml(opciones: OpcionesEspacioUnico): string {
  const { id, marcado, valor, deshabilitado = false } = opciones;
  const dataValor = valor ?? id;
  const atrDeshabilitado = deshabilitado ? ' disabled' : '';
  return `<label for="${id}" title="${AYUDA_ESPACIO_UNICO}" class="inline-flex items-center gap-2 cursor-pointer select-none">
      <input id="${id}" type="checkbox" data-espacio-unico="${dataValor}"${marcado ? ' checked' : ''}${atrDeshabilitado}
        class="h-4 w-4 rounded border-gray-300 text-blue-700 focus:ring-blue-500 cursor-pointer" />
      <span class="text-xs font-medium text-gray-700">${ETIQUETA_ESPACIO_UNICO}</span>
    </label>`;
}

/** Lee el estado del checkbox por id; `false` si no existe en el DOM. */
export function leerEspacioUnico(id: string): boolean {
  const input = document.getElementById(id) as HTMLInputElement | null;
  return Boolean(input?.checked);
}
