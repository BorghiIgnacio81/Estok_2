// =============================================================================
// CONSULTA DEL PRECIO DE REFERENCIA (Mercado Libre MLA + fallback Gemini)
// -----------------------------------------------------------------------------
// Punto ÚNICO de la llamada a GET /api/objetos/buscar_precio_referencia/ y del
// markup de la tarjeta con el resultado. Lo consumen TODAS las pantallas que
// cotizan:
//   · /objetos/nuevo          → lib/objetos/objetoMercadoLibre.ts
//   · /objetos/<id>/editar    → lib/editarObjetoPrecio.ts
//   · /objetos/<id> (detalle) → lib/objetos/objetoDetallePrecio.ts
// Antes cada pantalla armaba su propio fetch + su propio HTML de tarjeta; acá
// vive una sola versión (disciplina de modularidad del proyecto).
//
// La interpretación de `fuente` / `fuente_error` NO se duplica acá: sale del
// módulo compartido lib/precioReferencia.ts (esFuenteMercadoLibre /
// mensajeSinPrecio).
//
// EL ENLACE LO DECIDE SIEMPRE EL BACKEND (`link`):
//   · coincidencia real en MLA → permalink del ítem publicado.
//   · estimación de IA        → https://listado.mercadolibre.com.ar/<búsqueda>.
// El frontend NO arma URLs de Mercado Libre a mano (el viejo
// «mercadolibre.com.ar/search?q=…» no validaba coincidencia ni moneda).
// Auth 100% centralizada en services/auth (getAuthHeaders).
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from '../../services/auth';
import { esFuenteMercadoLibre } from '../precioReferencia';

/** Respuesta de GET /api/objetos/buscar_precio_referencia/. */
export interface ResultadoPrecioReferencia {
  encontrado: boolean;
  fuente?: string | null;
  fuente_error?: string | null;
  titulo?: string | null;
  precio_original?: number | null;
  precio_ajustado?: number | null;
  moneda?: string | null;
  link?: string | null;
  estado_aplicado?: string | null;
  porcentaje_aplicado?: number | null;
  mensaje?: string | null;
}

/** Parámetros de la búsqueda (todos salvo `q` son opcionales). */
export interface ConsultaPrecioReferencia {
  q: string;
  /** Estado de conservación aplicado al ajuste del precio (default «bueno»). */
  estado?: string | null;
  /** Categoría: ID oficial MLA, subtipo («ropa») o nombre («Ropa»). */
  categoria?: string | null;
  /** LIBROS: ISBN/ISSN de la edición exacta. */
  isbn?: string | null;
  /** LIBROS: autor (habilita la búsqueda «Título + Autor»). */
  autor?: string | null;
}

/** Etiquetas legibles del estado de conservación aplicado al ajuste. */
const ETIQUETAS_ESTADO: Record<string, string> = {
  nuevo: 'Nuevo',
  como_nuevo: 'Como nuevo',
  excelente: 'Excelente',
  bueno: 'Bueno',
  regular: 'Regular',
  malo: 'Malo',
  muy_malo: 'Muy malo',
};

/** Nombre legible del estado de conservación. */
export function etiquetaEstadoPrecio(estado: string): string {
  return ETIQUETAS_ESTADO[estado] || estado;
}

/** El backend informa el % que SE CONSERVA: el descuento es su complemento. */
export function etiquetaDescuentoPrecio(porcentaje: number): string {
  const descuento = 100 - porcentaje;
  return descuento > 0 ? `-${descuento}%` : '0%';
}

/** Escapa un valor para interpolarlo dentro de un atributo o texto HTML. */
function escapeHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Consulta el precio de referencia (scraping MLA pineado en ARS + Gemini).
 * Lanza SOLO ante un fallo real de red/servidor: la ausencia de coincidencia
 * llega como `encontrado = false` con `mensaje` (error controlado).
 */
export async function consultarPrecioReferencia(
  consulta: ConsultaPrecioReferencia,
): Promise<ResultadoPrecioReferencia> {
  const params = new URLSearchParams({
    q: consulta.q,
    estado: consulta.estado || 'bueno',
  });
  if (consulta.categoria) params.set('categoria', consulta.categoria);
  if (consulta.isbn) params.set('isbn', consulta.isbn);
  if (consulta.autor) params.set('autor', consulta.autor);

  const response = await fetch(
    `${API_BASE_URL}/objetos/buscar_precio_referencia/?${params.toString()}`,
    { headers: getAuthHeaders() },
  );
  if (!response.ok) throw new Error(`Error del servidor (${response.status})`);

  return (await response.json()) as ResultadoPrecioReferencia;
}

/**
 * Tarjeta del resultado: link externo, precio real de ML o estimación de IA.
 * El contenedor lleva `data-link` cuando hay enlace; se abre con
 * `activarAperturaTarjetaPrecio()`.
 */
export function tarjetaPrecioReferenciaHtml(data: ResultadoPrecioReferencia): string {
  const esML = esFuenteMercadoLibre(data.fuente);
  const link = String(data.link || '').trim();
  const tieneLink = link.length > 0;
  const precioOriginal = Number(data.precio_original ?? 0).toFixed(2);
  const precioAjustado = Number(data.precio_ajustado ?? 0).toFixed(2);
  const estado = etiquetaEstadoPrecio(String(data.estado_aplicado || ''));
  const descuento = etiquetaDescuentoPrecio(Number(data.porcentaje_aplicado ?? 100));
  const claseCaja = esML
    ? 'border border-blue-200 bg-blue-50 hover:bg-blue-100'
    : 'border border-purple-200 bg-purple-50 hover:bg-purple-100';
  const pie = esML
    ? '<p class="text-xs text-blue-600 mt-1">🔗 Ver en MercadoLibre →</p>'
    : tieneLink
      ? '<p class="text-xs text-purple-600 mt-1">🔗 Ver resultados en MercadoLibre →</p>'
      : '<p class="text-xs text-purple-600 mt-1">🤖 Estimación de IA (Gemini)</p>';

  return `
    <div class="${tieneLink ? 'cursor-pointer ' : ''}${claseCaja} rounded-lg p-3 transition-base" ${
      tieneLink ? `data-link="${escapeHtml(link)}"` : ''
    }>
      <div class="flex items-start gap-2">
        <span class="text-lg">${esML ? '📦' : '🤖'}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(data.titulo)}</p>
          <div class="mt-1 space-y-0.5">
            <p class="text-xs text-gray-500">Precio original: <span class="font-semibold text-gray-700">$${precioOriginal}</span></p>
            <p class="text-xs text-gray-500">Ajuste por estado (${estado} ${descuento}): <span class="font-semibold text-blue-700">$${precioAjustado}</span></p>
            ${pie}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Abre en una pestaña nueva el enlace del resultado al hacer clic en la tarjeta.
 * Idempotente por nodo: si el contenedor se vuelve a pintar, los nodos son
 * nuevos y se enlazan una sola vez.
 */
export function activarAperturaTarjetaPrecio(contenedor: HTMLElement): void {
  const tarjeta = contenedor.querySelector<HTMLElement>('[data-link]');
  if (!tarjeta || tarjeta.dataset.apertura === 'true') return;
  tarjeta.dataset.apertura = 'true';
  tarjeta.addEventListener('click', () => {
    const link = tarjeta.dataset.link;
    if (link) window.open(link, '_blank', 'noopener');
  });
}
