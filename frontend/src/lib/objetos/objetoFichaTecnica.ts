// =============================================================================
// FICHA TÉCNICA / ESPECIFICACIONES DEL OBJETO — módulo PURO de presentación
// -----------------------------------------------------------------------------
// La vista de detalle (/objetos/<id>) muestra SIEMPRE los campos base
// universales (nombre, estado, color, valor estimado, fecha). Los datos que
// dependen de la naturaleza física del objeto viven en `datos_especificos`.
//
// TAXONOMÍA UNIFICADA: las antiguas tablas hijas (libro_revista, tecnologia,
// mueble_arte, ropa) fueron aplanadas sobre `Objeto` (models/productos.py) y el
// backend las vuelve a agrupar con las MISMAS claves en
// `ObjetoDetailSerializer.get_datos_especificos()`. Este módulo es el ÚNICO
// formateador de esa ficha: no duplicar la lista de campos en las páginas.
//
//   · Libro / Revista → autor, editorial, isbn_issn, anio, edicion
//                       (+ nombre_serie, titulo_tomo, numero_tomo, idioma)
//   · Tecnología      → marca, modelo, numero_serie, peso, especificaciones
//   · Mueble / Arte   → material, dimensiones (largo × ancho × alto), artista
//   · Ropa            → tamano
//
// REGLAS: un dato nulo/vacío/ausente NO genera fila; un bloque sin filas no se
// dibuja; sin ningún dato específico la tarjeta completa queda oculta. Números
// con formato es-AR y unidad (kg / cm). Todo valor se escapa antes de inyectarse
// como HTML. Sin dependencias: sirve en cliente y en frontmatter SSR.
// =============================================================================

/** Payload de datos específicos tal como llega desde la API (clave → valor). */
export type DatosFichaTecnica = Record<string, unknown>;

/** Una fila de la ficha: etiqueta legible + valor(es) ya formateados. */
export interface FilaFichaTecnica {
  etiqueta: string;
  valor: string | string[];
}

/** Bloque de la ficha (una familia de datos específicos). */
export interface GrupoFichaTecnica {
  titulo: string;
  icono: string;
  filas: FilaFichaTecnica[];
}

/** Objeto de detalle tal como lo devuelve `GET /api/objetos/<id>/`. */
export interface FuenteFichaTecnica {
  datos_especificos?: DatosFichaTecnica | null;
  categoria_nombre?: string | null;
  categoria?: string | { nombre?: string | null } | null;
  [clave: string]: unknown;
}

/** Ids configurables del marcado de la tarjeta (por defecto, los de la página). */
export interface OpcionesFichaTecnica {
  seccionId?: string;
  contenidoId?: string;
  resumenId?: string;
}

/**
 * Claves de datos específicos que el backend entrega en `datos_especificos`.
 * Se usan como respaldo cuando la respuesta NO trae ese bloque (versiones
 * anteriores de la API), leyendo los campos planos de la raíz del objeto.
 */
export const CLAVES_FICHA_TECNICA: readonly string[] = [
  // Libro / Revista / Cómic
  'autor', 'edicion', 'anio', 'isbn_issn',
  'nombre_serie', 'titulo_tomo', 'numero_tomo', 'editorial', 'idioma',
  // Tecnología / Electrónica
  'marca', 'modelo', 'numero_serie', 'peso', 'especificaciones',
  // Mueble / Arte / Antigüedad
  'material', 'largo', 'ancho', 'alto', 'artista_fabricante',
  // Ropa / Accesorio
  'tamano',
];

/**
 * Banderas internas que viven dentro de `especificaciones` (JSON libre del
 * objeto) y NO son especificaciones técnicas del producto: se filtran para no
 * ensuciar la ficha con metadatos del sistema.
 */
const CLAVES_INTERNAS_ESPECIFICACIONES = new Set([
  'es_espejo_contenedor',
  'alta_rapida',
]);

// =============================================================================
// HELPERS DE FORMATO
// =============================================================================

/** True si el valor no aporta información (null, '', {}, [], NaN). */
export function esVacio(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === 'string') return valor.trim() === '';
  if (typeof valor === 'number') return !Number.isFinite(valor);
  if (typeof valor === 'boolean') return false;
  if (Array.isArray(valor)) return valor.length === 0;
  if (typeof valor === 'object') return Object.keys(valor as object).length === 0;
  return false;
}

/** Escapa un valor antes de inyectarlo como HTML (texto provisto por el usuario). */
function escaparHtml(valor: unknown): string {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Número con formato es-AR y la cantidad máxima de decimales indicada. */
function formatearNumero(valor: unknown, decimales = 2): string {
  const numero = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(numero)) return String(valor).trim();
  return numero.toLocaleString('es-AR', { maximumFractionDigits: decimales });
}

/**
 * Entero SIN separador de miles: se usa en año de edición y número de tomo,
 * donde «1.967» o «1.000» serían lecturas incorrectas del dato.
 */
function formatearEntero(valor: unknown): string {
  const numero = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(numero)) return String(valor).trim();
  return String(Math.trunc(numero));
}

/** Texto plano recortado (se usa para los campos de texto libre). */
function formatearTexto(valor: unknown): string {
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  return String(valor).trim();
}

/** «memoria_ram» → «Memoria ram» (las claves técnicas vienen en snake_case). */
function humanizarClave(clave: string): string {
  const texto = clave.replace(/[_-]+/g, ' ').trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Unidades de las dimensiones, en el orden pedido por la ficha. */
const DIMENSIONES = [
  { clave: 'largo', etiqueta: 'Largo' },
  { clave: 'ancho', etiqueta: 'Ancho' },
  { clave: 'alto', etiqueta: 'Alto' },
] as const;

/**
 * Dimensiones del mueble/obra: «120 × 80 × 75 cm».
 * Si falta alguna medida se rotula la que existe («Largo 120 cm · Alto 75 cm»)
 * para que el valor nunca quede ambiguo. Sin medidas → cadena vacía (se oculta).
 */
function formatearDimensiones(datos: DatosFichaTecnica): string {
  const presentes = DIMENSIONES
    .filter((dimension) => !esVacio(datos[dimension.clave]))
    .map((dimension) => ({
      etiqueta: dimension.etiqueta,
      valor: formatearNumero(datos[dimension.clave]),
    }));

  if (presentes.length === 0) return '';
  if (presentes.length === DIMENSIONES.length) {
    return `${presentes.map((d) => d.valor).join(' × ')} cm`;
  }
  return presentes.map((d) => `${d.etiqueta} ${d.valor} cm`).join(' · ');
}

/**
 * Especificaciones técnicas (JSON libre): una línea «Clave: valor» por entrada.
 * Descarta banderas internas y valores vacíos; los objetos anidados se
 * serializan en una sola línea para no romper el layout de la tarjeta.
 */
function formatearEspecificaciones(valor: unknown): string[] {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return [];
  return Object.entries(valor as Record<string, unknown>)
    .filter(([clave, contenido]) => (
      !CLAVES_INTERNAS_ESPECIFICACIONES.has(clave) && !esVacio(contenido)
    ))
    .map(([clave, contenido]) => {
      const texto = typeof contenido === 'object'
        ? JSON.stringify(contenido)
        : formatearTexto(contenido);
      return `${humanizarClave(clave)}: ${texto}`;
    });
}

// =============================================================================
// CONSTRUCCIÓN DE LA FICHA (sin DOM: testeable de forma aislada)
// =============================================================================

interface CampoFicha {
  etiqueta: string;
  valor: (datos: DatosFichaTecnica) => string | string[];
}

/** Campo de texto/número: si viene vacío devuelve '' y la fila se descarta. */
function campoTexto(
  clave: string,
  etiqueta: string,
  formatear: (valor: unknown) => string = formatearTexto,
): CampoFicha {
  return {
    etiqueta,
    valor: (datos) => {
      const bruto = datos[clave];
      if (esVacio(bruto)) return '';
      return formatear(bruto);
    },
  };
}

/** Familias de campos específicos; el orden define los bloques en pantalla. */
const FAMILIAS: Array<{ titulo: string; icono: string; campos: CampoFicha[] }> = [
  {
    titulo: 'Libro / Revista',
    icono: '📚',
    campos: [
      campoTexto('autor', 'Autor'),
      campoTexto('editorial', 'Editorial'),
      campoTexto('isbn_issn', 'ISBN / ISSN'),
      campoTexto('anio', 'Año de edición', formatearEntero),
      campoTexto('edicion', 'Número de edición'),
      campoTexto('nombre_serie', 'Serie'),
      campoTexto('titulo_tomo', 'Título del tomo'),
      campoTexto('numero_tomo', 'Número de tomo', formatearEntero),
      campoTexto('idioma', 'Idioma'),
    ],
  },
  {
    titulo: 'Tecnología',
    icono: '💻',
    campos: [
      campoTexto('marca', 'Marca'),
      campoTexto('modelo', 'Modelo'),
      campoTexto('numero_serie', 'Número de serie'),
      campoTexto('peso', 'Peso', (valor) => `${formatearNumero(valor)} kg`),
      {
        etiqueta: 'Especificaciones técnicas',
        valor: (datos) => formatearEspecificaciones(datos.especificaciones),
      },
    ],
  },
  {
    titulo: 'Mueble / Arte',
    icono: '🪑',
    campos: [
      campoTexto('material', 'Material'),
      { etiqueta: 'Dimensiones (Largo × Ancho × Alto)', valor: formatearDimensiones },
      campoTexto('artista_fabricante', 'Artista / Fabricante'),
    ],
  },
  {
    titulo: 'Ropa',
    icono: '👗',
    campos: [
      campoTexto('tamano', 'Talla / Tamaño'),
    ],
  },
];

/**
 * Agrupa y formatea los datos específicos. Devuelve SÓLO los bloques con al
 * menos una fila con contenido; un objeto sin datos específicos → [].
 */
export function construirFichaTecnica(
  datos: DatosFichaTecnica | null | undefined,
): GrupoFichaTecnica[] {
  if (!datos || typeof datos !== 'object') return [];

  return FAMILIAS.map((familia) => {
    const filas: FilaFichaTecnica[] = [];

    familia.campos.forEach((campo) => {
      const valor = campo.valor(datos);
      const tieneContenido = Array.isArray(valor)
        ? valor.length > 0
        : valor.trim() !== '';
      if (tieneContenido) filas.push({ etiqueta: campo.etiqueta, valor });
    });

    return { titulo: familia.titulo, icono: familia.icono, filas };
  }).filter((grupo) => grupo.filas.length > 0);
}

/**
 * Extrae los datos específicos del objeto de detalle.
 *
 * 1. Contrato actual: bloque `datos_especificos`.
 * 2. Respaldo: campos planos en la raíz de la respuesta (versiones previas de
 *    la API que no exponían el bloque agrupado).
 */
export function extraerDatosFichaTecnica(
  objeto: FuenteFichaTecnica | null | undefined,
): DatosFichaTecnica {
  const datos: DatosFichaTecnica = {};

  const especificos = objeto?.datos_especificos;
  if (especificos && typeof especificos === 'object' && !Array.isArray(especificos)) {
    Object.assign(datos, especificos);
  }

  CLAVES_FICHA_TECNICA.forEach((clave) => {
    if (esVacio(datos[clave]) && !esVacio(objeto?.[clave])) {
      datos[clave] = objeto?.[clave];
    }
  });

  return datos;
}

/** Nombre de la categoría del objeto (texto plano, puede ser ''). */
function categoriaDe(objeto: FuenteFichaTecnica | null | undefined): string {
  const bruta = objeto?.categoria_nombre
    ?? (typeof objeto?.categoria === 'string' ? objeto.categoria : objeto?.categoria?.nombre)
    ?? '';
  return String(bruta).trim();
}



// =============================================================================
// RENDER EN EL DOM
// =============================================================================

/** HTML de una fila (texto simple o lista de especificaciones técnicas). */
function filaHtml(fila: FilaFichaTecnica): string {
  const etiqueta = escaparHtml(fila.etiqueta);

  if (Array.isArray(fila.valor)) {
    const items = fila.valor
      .map((item) => `<li class="break-words">${escaparHtml(item)}</li>`)
      .join('');
    return `
      <div class="bg-gray-50 rounded-lg p-3">
        <p class="text-xs text-gray-500 mb-0.5">${etiqueta}</p>
        <ul class="font-medium text-gray-800 text-sm space-y-0.5">${items}</ul>
      </div>
    `;
  }

  return `
    <div class="bg-gray-50 rounded-lg p-3">
      <p class="text-xs text-gray-500 mb-0.5">${etiqueta}</p>
      <p class="font-medium text-gray-800 text-sm break-words">${escaparHtml(fila.valor)}</p>
    </div>
  `;
}

/** HTML de un bloque de familia (título + grilla de filas). */
function grupoHtml(grupo: GrupoFichaTecnica): string {
  return `
    <section>
      <h3 class="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
        <span aria-hidden="true">${grupo.icono}</span>${escaparHtml(grupo.titulo)}
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        ${grupo.filas.map(filaHtml).join('')}
      </div>
    </section>
  `;
}

/** Resumen de la tarjeta: «4 datos específicos · Libros». */
function textoResumen(total: number, categoria: string): string {
  const datos = total === 1 ? '1 dato específico' : `${total} datos específicos`;
  return categoria ? `${datos} · ${categoria}` : datos;
}

/**
 * Dibuja la tarjeta «Ficha Técnica / Especificaciones».
 *
 * La tarjeta se OCULTA por completo cuando el objeto no tiene ningún dato
 * específico, para no dejar un bloque vacío en la interfaz.
 *
 * @returns cantidad de filas renderizadas (0 si la tarjeta quedó oculta).
 */
export function renderFichaTecnica(
  objeto: FuenteFichaTecnica | null | undefined,
  opciones: OpcionesFichaTecnica = {},
): number {
  const seccion = document.getElementById(opciones.seccionId ?? 'fichaTecnicaSection');
  const contenido = document.getElementById(opciones.contenidoId ?? 'fichaTecnicaContenido');
  const resumen = document.getElementById(opciones.resumenId ?? 'fichaTecnicaResumen');
  if (!seccion || !contenido) return 0;

  const grupos = construirFichaTecnica(extraerDatosFichaTecnica(objeto));
  const total = grupos.reduce((suma, grupo) => suma + grupo.filas.length, 0);

  if (total === 0) {
    seccion.classList.add('hidden');
    contenido.innerHTML = '';
    if (resumen) resumen.textContent = '';
    return 0;
  }

  contenido.innerHTML = grupos.map(grupoHtml).join('');
  if (resumen) resumen.textContent = textoResumen(total, categoriaDe(objeto));
  seccion.classList.remove('hidden');
  return total;
}
