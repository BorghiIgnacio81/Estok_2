// =============================================================================
// «ESPACIO FINAL» — CHECKBOX REUTILIZABLE DEL NIVEL TERMINAL
// -----------------------------------------------------------------------------
// Control ÚNICO y reutilizable que declara una pieza estructural (Habitación,
// Espacio, Estante, Cajón o Caja) como ESPACIO FINAL: un nivel TERMINAL donde el
// operador ya no modela subdivisiones arquitectónicas, sino que guarda contenido
// (cajas, muebles móviles y objetos) de forma DIRECTA.
//
// En Almacenamiento, un Espacio Final NO dibuja el lienzo/mapa 2D: su Panel
// Derecho se convierte en el Panel de Contenido (tarjetas de lo que aloja + zona
// receptora de Drag & Drop). Ver lib/mapa/portales/panelEspacioFinal.ts.
//
// Regla de negocio: un Espacio Final está listo para recibir objetos de forma
// DIRECTA, por lo que el motor nunca deja sus ítems en el estado de alerta
// parpadeante «En Tránsito». Las CAJAS nacen con el control tildado por defecto.
//
// NOTA DE CONTRATO (backend): el flag persistido SIGUE llamándose `espacio_unico`
// en PostgreSQL y en la API (`PUT /api/contenedores/{id}/ { espacio_unico }`).
// Este módulo sólo cambia la DENOMINACIÓN funcional/de interfaz del concepto.
//
// El helper es PURO (markup + lectura): la persistencia la decide cada consumidor
// (POST/PUT contra el endpoint que corresponda). El valor viaja en el atributo
// `data-espacio-final` para que un contenedor padre delegue el `change`.
// =============================================================================

export const ETIQUETA_ESPACIO_FINAL = 'Espacio Final';

/** Ayuda contextual del control (título nativo + micro-texto). */
export const AYUDA_ESPACIO_FINAL =
  'Espacio terminal sin subdivisiones arquitectónicas: el lienzo 2D se reemplaza por el panel de contenido, listo para recibir cajas y objetos de forma directa (nunca «En Tránsito»). En una Caja viene activado por defecto; destildalo para dividirla.';

export interface OpcionesEspacioFinal {
  /** id del <input type="checkbox"> (único en el documento). */
  id: string;
  /** Estado inicial del control. */
  marcado: boolean;
  /** Valor emitido en `data-espacio-final` (por defecto, el propio `id`). */
  valor?: string;
  /** true = control deshabilitado (pieza ya terminal por diseño). */
  deshabilitado?: boolean;
}

/**
 * Markup del checkbox reutilizable. Misma cara en toda la app: una píldora con
 * el tilde + la etiqueta «Espacio Final» y la ayuda en el `title`.
 */
export function checkboxEspacioFinalHtml(opciones: OpcionesEspacioFinal): string {
  const { id, marcado, valor, deshabilitado = false } = opciones;
  const dataValor = valor ?? id;
  const atrDeshabilitado = deshabilitado ? ' disabled' : '';
  return `<label for="${id}" title="${AYUDA_ESPACIO_FINAL}" class="inline-flex items-center gap-2 cursor-pointer select-none">
      <input id="${id}" type="checkbox" data-espacio-final="${dataValor}"${marcado ? ' checked' : ''}${atrDeshabilitado}
        class="h-4 w-4 rounded border-gray-300 text-blue-700 focus:ring-blue-500 cursor-pointer" />
      <span class="text-xs font-medium text-gray-700">${ETIQUETA_ESPACIO_FINAL}</span>
    </label>`;
}

/**
 * LEYENDA DE GUÍA del control (micro-texto que acompaña al checkbox en los
 * paneles del flujo de portales de Almacenamiento).
 */
export const GUIA_ESPACIO_FINAL =
  'Para guardar objetos directamente aquí, declaralo como Espacio Final. ' +
  'Si preferís subdividirlo en estantes o cajones, dejalo destildado';
