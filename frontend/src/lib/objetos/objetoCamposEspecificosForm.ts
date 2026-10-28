// =============================================================================
// CAMPOS TÉCNICOS · COMPORTAMIENTO DEL FORMULARIO DE EDICIÓN
// -----------------------------------------------------------------------------
// Mitad "cliente" del módulo de atributos técnicos: el catálogo de campos y el
// markup viven en lib/objetos/objetoCamposEspecificos.ts (SSR, sin DOM).
//
// Responsabilidades:
//   · Resolver la familia (Libro / Tecnología / Mueble-Arte / Ropa) desde la
//     categoría elegida y dejar visible SÓLO ese bloque.
//   · Deshabilitar los inputs de las familias inactivas: FormData no los envía,
//     por lo que el PUT parcial conserva los valores guardados de esas familias.
//   · Precargar los valores del objeto (`datos_especificos` de la API).
//   · Serializar `especificaciones` (JSON libre) editado como líneas
//     «Clave: Valor», sin pisar las banderas internas del sistema.
// =============================================================================

import {
  CLAVES_INTERNAS_ESPECIFICACIONES,
  familiaDeCategoria,
  type FamiliaObjeto,
} from './objetoCamposEspecificos';

/** Estado del módulo: familia activa + JSON original de `especificaciones`. */
const estado: {
  familia: FamiliaObjeto | null;
  especificacionesOriginales: Record<string, unknown>;
  clavesEspecificaciones: string[];
} = {
  familia: null,
  especificacionesOriginales: {},
  clavesEspecificaciones: [],
};

/** True si el valor no aporta información (null, undefined o texto vacío). */
function vacio(valor: unknown): boolean {
  return valor === null || valor === undefined || String(valor).trim() === '';
}

/** Nombre de la categoría seleccionada en el combo (texto visible). */
function nombreCategoriaSeleccionada(): string {
  const select = document.getElementById('categoria') as HTMLSelectElement | null;
  return select?.selectedOptions?.[0]?.textContent ?? '';
}

/**
 * Muestra SÓLO el bloque de la familia indicada y deshabilita el resto.
 *
 * Deshabilitar (no sólo ocultar) es lo que garantiza que el PUT parcial no
 * reciba atributos de otra familia: FormData ignora los campos `disabled`, por
 * lo que el backend conserva los valores ya guardados.
 */
export function aplicarFamiliaEspecifica(familia: FamiliaObjeto | null): void {
  estado.familia = familia;

  document.querySelectorAll<HTMLElement>('[data-familia-especifica]').forEach((bloque) => {
    const activo = bloque.dataset.familiaEspecifica === familia;
    bloque.classList.toggle('hidden', !activo);
    bloque
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input, textarea, select',
      )
      .forEach((campo) => {
        campo.disabled = !activo;
      });
  });

  document.getElementById('camposEspecificosHint')?.classList.toggle('hidden', familia !== null);
}

/**
 * Resuelve la familia a partir de la categoría elegida y actualiza la pantalla.
 * @returns la familia activa (null si la categoría no tiene atributos técnicos).
 */
export function sincronizarCamposEspecificos(): FamiliaObjeto | null {
  const familia = familiaDeCategoria(nombreCategoriaSeleccionada());
  aplicarFamiliaEspecifica(familia);
  return familia;
}

/** Engancha el cambio de categoría (llamar una vez al iniciar la página). */
export function iniciarCamposEspecificos(): void {
  const select = document.getElementById('categoria') as HTMLSelectElement | null;
  // Idempotente: /objetos/nuevo y el Paso 4 del tutorial pueden inicializarlo,
  // y el combobox de categoría se re-renderiza (categoría creada / eliminada).
  if (select && select.dataset.especificosActivo !== 'true') {
    select.dataset.especificosActivo = 'true';
    // Este es el ÚNICO manejador de cambio de categoría. El autocompletado con
    // IA no lo invoca a mano: selecciona la opción y despacha 'change', de modo
    // que los bloques técnicos se despliegan igual que con un clic del operador.
    select.addEventListener('change', () => {
      sincronizarCamposEspecificos();
    });
  }
  // Estado inicial: todo oculto hasta que la API devuelva la categoría del objeto.
  sincronizarCamposEspecificos();
}


/** Precarga los valores guardados en los inputs técnicos (id === clave). */
export function cargarValoresEspecificos(datos: Record<string, unknown> | null | undefined): void {
  const fuente = datos && typeof datos === 'object' ? datos : {};

  Object.entries(fuente).forEach(([clave, valor]) => {
    if (clave === 'especificaciones' || vacio(valor)) return;
    const campo = document.getElementById(`especifico-${clave}`) as HTMLInputElement | null;
    if (!campo) return;
    campo.value = String(valor);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });

  cargarEspecificaciones(fuente.especificaciones);
}

/** Vuelca el JSON de especificaciones al textarea como líneas «Clave: Valor». */
function cargarEspecificaciones(valor: unknown): void {
  const objeto = (valor && typeof valor === 'object' && !Array.isArray(valor))
    ? valor as Record<string, unknown>
    : {};

  const esInterna = (clave: string): boolean => (
    (CLAVES_INTERNAS_ESPECIFICACIONES as readonly string[]).includes(clave)
  );

  estado.especificacionesOriginales = { ...objeto };
  // Sólo las claves EDITABLES se reemplazan al guardar: las banderas internas
  // quedan en `especificacionesOriginales` y sobreviven al merge del payload.
  estado.clavesEspecificaciones = Object.keys(objeto).filter((clave) => !esInterna(clave));

  const lineas = Object.entries(objeto)
    .filter(([clave, contenido]) => !esInterna(clave) && !vacio(contenido))
    .map(([clave, contenido]) => (
      `${clave}: ${typeof contenido === 'object' ? JSON.stringify(contenido) : String(contenido)}`
    ));

  const textarea = document.getElementById('especifico-especificaciones') as
    | HTMLTextAreaElement
    | null;
  if (!textarea) return;
  textarea.value = lineas.join('\n');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Líneas «Clave: Valor» (también acepta «Clave=Valor») → pares clave/valor.
 * Las líneas sin separador se ignoran para no guardar basura en el JSON.
 */
function parsearEspecificaciones(texto: string): Array<[string, string]> {
  return texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '')
    .map((linea) => {
      const separador = linea.indexOf(':') >= 0 ? linea.indexOf(':') : linea.indexOf('=');
      if (separador <= 0) return null;
      const clave = linea.slice(0, separador).trim();
      const valor = linea.slice(separador + 1).trim();
      return clave ? [clave, valor] as [string, string] : null;
    })
    .filter((par): par is [string, string] => par !== null);
}

/**
 * Reconstruye `especificaciones` como OBJETO para el PUT.
 *
 * - Siempre elimina el string crudo que pudiera venir del FormData.
 * - Si la familia activa no es Tecnología, no toca el JSON guardado.
 * - Conserva las banderas internas que no se editan en pantalla.
 */
export function agregarEspecificacionesAlPayload(payload: Record<string, unknown>): void {
  delete payload['especificaciones'];

  const textarea = document.getElementById('especifico-especificaciones') as
    | HTMLTextAreaElement
    | null;
  if (!textarea || textarea.disabled) return;

  const resultado: Record<string, unknown> = { ...estado.especificacionesOriginales };
  estado.clavesEspecificaciones.forEach((clave) => {
    delete resultado[clave];
  });
  parsearEspecificaciones(textarea.value).forEach(([clave, valor]) => {
    resultado[clave] = valor;
  });

  payload['especificaciones'] = resultado;
}

// =============================================================================
// ALTA (POST multipart) · atributos técnicos al FormData
// =============================================================================

/** JSON `especificaciones` ya presente en el FormData (ej. `alta_rapida`). */
function especificacionesEnFormData(formData: FormData): Record<string, unknown> {
  const crudo = formData.get('especificaciones');
  if (crudo === null) return {};
  try {
    const parsed = JSON.parse(String(crudo));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** Líneas «Clave: Valor» del textarea técnico (vacío si la familia no es Tecnología). */
function especificacionesEditadas(): Record<string, string> {
  const textarea = document.getElementById('especifico-especificaciones') as
    | HTMLTextAreaElement
    | null;
  if (!textarea || textarea.disabled) return {};
  const resultado: Record<string, string> = {};
  parsearEspecificaciones(textarea.value).forEach(([clave, valor]) => {
    resultado[clave] = valor;
  });
  return resultado;
}

/**
 * Vuelca en el FormData del ALTA los atributos técnicos de la familia activa.
 *
 * Sólo viajan los campos HABILITADOS (`disabled` = familia inactiva): así el
 * objeto se crea únicamente con los atributos de su categoría y sin claves
 * vacías. `especificaciones` se MERGEA con lo que ya venía en el FormData
 * (p. ej. la bandera `alta_rapida` del alta rápida Caja/Mueble) para no pisarla.
 */
export function agregarCamposEspecificosAlFormData(formData: FormData): void {
  document
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-campo-especifico]')
    .forEach((campo) => {
      if (campo.disabled) return;
      const clave = campo.name;
      if (!clave || clave === 'especificaciones') return;
      const valor = campo.value.trim();
      if (valor !== '') formData.set(clave, valor);
    });

  const especificaciones = {
    ...especificacionesEnFormData(formData),
    ...especificacionesEditadas(),
  };
  if (Object.keys(especificaciones).length > 0) {
    formData.set('especificaciones', JSON.stringify(especificaciones));
  }
}
