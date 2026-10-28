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
  select?.addEventListener('change', () => {
    sincronizarCamposEspecificos();
  });
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
