// =============================================================================
// CAMPOS TÉCNICOS DEL OBJETO EN EDICIÓN — catálogo + filtrado por categoría
// -----------------------------------------------------------------------------
// Problema que resuelve: el formulario de edición (/objetos/<id>/editar) pintaba
// TODOS los atributos de TODOS los subtipos a la vez (Marca, Modelo, Serie,
// Autor, Año, Artista, Tamaño, Material), sin importar la categoría del objeto.
//
// Acá vive el catálogo por familia y el filtrado dinámico:
//   · 📚 Libro / Revista → autor, editorial, isbn_issn, anio, edicion
//   · 💻 Tecnología      → marca, modelo, numero_serie, peso, especificaciones
//   · 🪑 Mueble / Arte   → material, largo/ancho/alto (dimensiones), artista_fabricante
//   · 👗 Ropa            → tamano
//
// TAXONOMÍA UNIFICADA: no existen tablas hijas; todas las claves son campos
// opcionales de `Objeto` y la API las entrega en `datos_especificos`
// (ObjetoDetailSerializer). El `name` de cada input ES la clave del modelo, así
// el FormData del PUT y la precarga funcionan sin traducciones.
//
// Módulo PURO (sin DOM) para poder usarse en el frontmatter SSR del formulario.
// El comportamiento en cliente —mostrar/ocultar bloques, precargar valores y
// reconstruir el JSON de `especificaciones`— vive en
// lib/objetos/objetoCamposEspecificosForm.ts.
// =============================================================================

/** Familia de atributos técnicos a la que pertenece una categoría. */
export type FamiliaObjeto = 'libro' | 'tecnologia' | 'mueble_arte' | 'ropa';

/** Metadatos de un campo técnico del objeto (clave = campo del modelo). */
export interface CampoEspecifico {
  clave: string;
  etiqueta: string;
  placeholder: string;
  tipo?: 'text' | 'number' | 'textarea';
  paso?: string;
  /** Leyenda que agrupa varios campos en un mismo fieldset (ej. dimensiones). */
  grupo?: string;
  ayuda?: string;
}

/** Título e ícono de cada familia (encabezado del bloque en pantalla). */
export const FAMILIAS_OBJETO: Record<FamiliaObjeto, { titulo: string; icono: string }> = {
  libro: { titulo: 'Libro / Revista', icono: '📚' },
  tecnologia: { titulo: 'Tecnología', icono: '💻' },
  mueble_arte: { titulo: 'Mueble / Arte', icono: '🪑' },
  ropa: { titulo: 'Ropa', icono: '👗' },
};

/** Catálogo canónico de campos técnicos por familia. */
export const CAMPOS_ESPECIFICOS: Record<FamiliaObjeto, CampoEspecifico[]> = {
  libro: [
    { clave: 'autor', etiqueta: 'Autor', placeholder: 'Ej: Julio Cortázar' },
    { clave: 'editorial', etiqueta: 'Editorial', placeholder: 'Ej: Sudamericana' },
    { clave: 'isbn_issn', etiqueta: 'ISBN / ISSN', placeholder: 'Ej: 978-950-07-1234-5' },
    {
      clave: 'anio', etiqueta: 'Año de edición', placeholder: '1967',
      tipo: 'number', paso: '1',
    },
    { clave: 'edicion', etiqueta: 'Número de edición', placeholder: 'Ej: 3ª' },
  ],
  tecnologia: [
    { clave: 'marca', etiqueta: 'Marca', placeholder: 'Ej: Sony' },
    { clave: 'modelo', etiqueta: 'Modelo', placeholder: 'Ej: WH-1000XM5' },
    { clave: 'numero_serie', etiqueta: 'Número de serie', placeholder: 'Serie del fabricante' },
    {
      clave: 'peso', etiqueta: 'Peso (kg)', placeholder: '0,00',
      tipo: 'number', paso: '0.01',
    },
    {
      clave: 'especificaciones', etiqueta: 'Especificaciones técnicas', placeholder: '',
      tipo: 'textarea',
      ayuda: 'Una por línea con el formato «Clave: Valor» (ej: RAM: 8 GB).',
    },
  ],
  mueble_arte: [
    { clave: 'material', etiqueta: 'Material', placeholder: 'Ej: Roble macizo' },
    {
      clave: 'largo', etiqueta: 'Largo', placeholder: 'cm',
      tipo: 'number', paso: '0.1', grupo: 'Dimensiones (Largo × Ancho × Alto) en cm',
    },
    {
      clave: 'ancho', etiqueta: 'Ancho', placeholder: 'cm',
      tipo: 'number', paso: '0.1', grupo: 'Dimensiones (Largo × Ancho × Alto) en cm',
    },
    {
      clave: 'alto', etiqueta: 'Alto', placeholder: 'cm',
      tipo: 'number', paso: '0.1', grupo: 'Dimensiones (Largo × Ancho × Alto) en cm',
    },
    {
      clave: 'artista_fabricante', etiqueta: 'Artista / Fabricante',
      placeholder: 'Ej: Taller artesanal',
    },
  ],
  ropa: [
    { clave: 'tamano', etiqueta: 'Talla / Tamaño', placeholder: 'Ej: M, L, 42' },
  ],
};

/**
 * Banderas internas del JSON `especificaciones` (metadatos del sistema, no
 * especificaciones del producto): no se muestran ni se sobrescriben al guardar.
 */
export const CLAVES_INTERNAS_ESPECIFICACIONES = ['es_espejo_contenedor', 'alta_rapida'] as const;

// =============================================================================
// MAPEO CATEGORÍA → FAMILIA
// -----------------------------------------------------------------------------
// Las categorías son las 11 oficiales de Mercado Libre + «Libros» y «Ropa»
// (seed canónico: inventario/services/seeding_categorias.py). La comparación es
// por NOMBRE normalizado (sin acentos ni mayúsculas): las categorías propias de
// cada Estok nacen con nombre libre, por eso también hay pistas parciales.
// Una categoría sin familia conocida NO muestra atributos técnicos.
// =============================================================================

/** Nombres exactos (normalizados) → familia. */
const FAMILIA_POR_NOMBRE: Record<string, FamiliaObjeto> = {
  libro: 'libro',
  libros: 'libro',
  revista: 'libro',
  revistas: 'libro',
  comic: 'libro',
  comics: 'libro',
  ropa: 'ropa',
  calzado: 'ropa',
  mueble: 'mueble_arte',
  muebles: 'mueble_arte',
  arte: 'mueble_arte',
  antiguedad: 'mueble_arte',
  antiguedades: 'mueble_arte',
  coleccionables: 'mueble_arte',
  hogar: 'mueble_arte',
  cocina: 'mueble_arte',
  jardin: 'mueble_arte',
  herramientas: 'mueble_arte',
  materiales: 'mueble_arte',
  decoracion: 'mueble_arte',
  electronica: 'tecnologia',
  computacion: 'tecnologia',
  informatica: 'tecnologia',
  tecnologia: 'tecnologia',
};

/** Pistas parciales, en orden de prioridad (para categorías libres del usuario). */
const PISTAS_NOMBRE: Array<[string, FamiliaObjeto]> = [
  ['libro', 'libro'],
  ['revista', 'libro'],
  ['comic', 'libro'],
  ['ropa', 'ropa'],
  ['calzado', 'ropa'],
  ['indumentaria', 'ropa'],
  ['electron', 'tecnologia'],
  ['comput', 'tecnologia'],
  ['informatic', 'tecnologia'],
  ['celular', 'tecnologia'],
  ['tecnolog', 'tecnologia'],
  ['mueble', 'mueble_arte'],
  ['arte', 'mueble_arte'],
  ['antiguedad', 'mueble_arte'],
  ['coleccion', 'mueble_arte'],
  ['hogar', 'mueble_arte'],
  ['cocina', 'mueble_arte'],
  ['jardin', 'mueble_arte'],
  ['herramienta', 'mueble_arte'],
  ['material', 'mueble_arte'],
  ['decoracion', 'mueble_arte'],
];

/** Texto comparable: minúsculas y sin diacríticos. */
function normalizar(texto: string | null | undefined): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Familia de atributos técnicos de una categoría.
 * Sin coincidencia (o sin categoría) devuelve `null`: no se muestran campos.
 */
export function familiaDeCategoria(nombre: string | null | undefined): FamiliaObjeto | null {
  const clave = normalizar(nombre);
  if (!clave) return null;

  const exacta = FAMILIA_POR_NOMBRE[clave];
  if (exacta) return exacta;

  const pista = PISTAS_NOMBRE.find(([fragmento]) => clave.includes(fragmento));
  return pista ? pista[1] : null;
}


// =============================================================================
// MARKUP (SSR del formulario de edición)
// =============================================================================

/** Input/textarea de un campo técnico (clases Tailwind del formulario). */
function campoHtml(campo: CampoEspecifico): string {
  const id = `especifico-${campo.clave}`;
  const clases = 'w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 '
    + 'focus:ring-blue-500 focus:border-blue-500 outline-none transition-base text-base';
  const ayuda = campo.ayuda
    ? `<p class="mt-1 text-xs text-gray-400">${campo.ayuda}</p>`
    : '';

  if (campo.tipo === 'textarea') {
    return `<div class="sm:col-span-2">
        <label for="${id}" class="block text-sm font-medium text-gray-700 mb-1">${campo.etiqueta}</label>
        <textarea id="${id}" name="${campo.clave}" rows="3" data-campo-especifico disabled
          placeholder="${campo.placeholder}" class="${clases}"></textarea>
        ${ayuda}
      </div>`;
  }

  const tipo = campo.tipo ?? 'text';
  // `min="0"` sólo en medidas/pesos: el año de edición no lleva esa restricción.
  const extra = tipo === 'number'
    ? ` step="${campo.paso ?? '0.01'}"${campo.clave === 'anio' ? '' : ' min="0"'}`
    : '';

  return `<div>
        <label for="${id}" class="block text-sm font-medium text-gray-700 mb-1">${campo.etiqueta}</label>
        <input id="${id}" name="${campo.clave}" type="${tipo}"${extra} data-campo-especifico disabled
          placeholder="${campo.placeholder}" class="${clases}" />
        ${ayuda}
      </div>`;
}

/**
 * Campos de una familia. Los campos consecutivos que comparten `grupo` se
 * envuelven en un fieldset con esa leyenda (caso: dimensiones Largo × Ancho × Alto).
 */
function camposFamiliaHtml(campos: CampoEspecifico[]): string {
  let html = '';
  let indice = 0;

  while (indice < campos.length) {
    const campo = campos[indice];

    if (campo.grupo) {
      const corrida: CampoEspecifico[] = [];
      while (indice < campos.length && campos[indice].grupo === campo.grupo) {
        corrida.push(campos[indice]);
        indice += 1;
      }
      html += `<fieldset class="sm:col-span-2 rounded-lg border border-gray-200 p-3">
          <legend class="px-1 text-xs font-medium text-gray-500">${campo.grupo}</legend>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            ${corrida.map(campoHtml).join('')}
          </div>
        </fieldset>`;
      continue;
    }

    html += campoHtml(campo);
    indice += 1;
  }

  return html;
}


/**
 * Markup COMPLETO de la sección técnica: un bloque por familia, todos ocultos
 * y con los inputs deshabilitados hasta que el cliente resuelva la categoría
 * (ver `sincronizarCamposEspecificos`). Sin JavaScript no se envía ningún
 * atributo técnico: el objeto conserva lo que ya tenía guardado.
 */
export function camposEspecificosHtml(): string {
  const bloques = (Object.keys(CAMPOS_ESPECIFICOS) as FamiliaObjeto[])
    .map((familia) => {
      const { titulo, icono } = FAMILIAS_OBJETO[familia];
      return `<section data-familia-especifica="${familia}" class="hidden space-y-3">
          <h3 class="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <span aria-hidden="true">${icono}</span>${titulo}
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            ${camposFamiliaHtml(CAMPOS_ESPECIFICOS[familia])}
          </div>
        </section>`;
    })
    .join('');

  return `<div id="camposEspecificosWrapper" class="space-y-5">
      <p id="camposEspecificosHint"
        class="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        Los datos técnicos se muestran según la categoría del objeto. Elegí una categoría
        (Libro, Tecnología, Mueble/Arte o Ropa) para completarlos.
      </p>
      ${bloques}
    </div>`;
}
