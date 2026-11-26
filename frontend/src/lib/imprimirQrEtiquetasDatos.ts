// =============================================================================
// ETIQUETAS QR · ACCESO A DATOS (cajas + PDF)
// -----------------------------------------------------------------------------
// Fuente ÚNICA de las llamadas HTTP del modal «🖨️ Imprimir QRs»
// (components/inventario/ModalImprimirQR.astro → lib/imprimirQrEtiquetas.ts).
//
//   cargarCajasQr()      → GET /api/contenedores/?bandeja=true&page_size=1000
//                          `bandeja=true` aplica la MISMA regla de «caja móvil
//                          reconocible» que la canasta «Elementos por ubicar»:
//                          nunca lista habitaciones «Espacio N» ni muebles.
//   pedirPdfEtiquetas()  → GET /api/cajas/generar_pdf_qr/ (PDF A4 + marcado de
//                          `qr_impreso` en el backend).
//
// Auth centralizada: los headers salen SIEMPRE de services/auth
// (getAuthHeaders → Authorization + X-Estok-Id). Este módulo no los arma.
// =============================================================================

import { API_BASE_URL, getAuthHeaders, normalizarUrlApi } from '../services/auth';

/** Caja del inventario móvil (subconjunto del serializado de /contenedores/). */
export interface CajaQr {
  id: string;
  nombre: string;
  qr_impreso?: boolean;
  ubicacion_nombre?: string;
  parent_contenedor_nombre?: string | null;
}

/** Etiquetas por hoja A4 según la grilla elegida en el modal. */
export const ETIQUETAS_POR_HOJA: Record<string, number> = {
  '2x2': 4,
  '3x3': 9,
  '4x4': 16,
};

/** Marca de error para cortar el flujo cuando ya se redirigió a /login. */
export const SESION_EXPIRADA = 'estok-sesion-expirada';

/** PDF generado + nombre sugerido de descarga. */
export interface PdfEtiquetas {
  blob: Blob;
  nombre: string;
}

/** Filtros del modal tal como viajan al backend. */
export interface OpcionesPdfEtiquetas {
  filtro: 'todas' | 'nuevas' | 'manual';
  formato: string;
  ids: string[];
}

function nombreDesdeCabecera(res: Response, porDefecto: string): string {
  const cabecera = res.headers.get('Content-Disposition') || '';
  const coincidencia = /filename="?([^";]+)"?/i.exec(cabecera);
  return coincidencia ? coincidencia[1] : porDefecto;
}

/** Mensaje legible del error del backend (DRF: string, lista u objeto). */
async function textoDeError(res: Response): Promise<string> {
  try {
    const datos = await res.json();
    if (typeof datos === 'string') return datos;
    if (Array.isArray(datos)) return datos.map(String).join(' ');
    if (datos && typeof datos === 'object') {
      if (datos.error) return String(datos.error);
      if (datos.detail) return String(datos.detail);
      return Object.values(datos).flat().map(String).join(' ');
    }
  } catch {
    /* respuesta sin JSON */
  }
  return `No se pudo generar el PDF (HTTP ${res.status}).`;
}

/** Descarga un blob con el nombre indicado (fallback cuando el pop-up se bloquea). */
export function descargarBlob(blob: Blob, nombre: string): void {
  const url = window.URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
}

/**
 * Cajas imprimibles del Estok activo, ordenadas por nombre.
 *
 * Lanza `Error(SESION_EXPIRADA)` tras redirigir al login, o un Error con el
 * mensaje del servidor para que la UI lo muestre.
 */
export async function cargarCajasQr(): Promise<CajaQr[]> {
  const acumuladas: CajaQr[] = [];
  let url: string | null = `${API_BASE_URL}/contenedores/?bandeja=true&page_size=1000`;

  while (url) {
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error(SESION_EXPIRADA);
    }
    if (!res.ok) throw new Error(await textoDeError(res));
    const data = await res.json();
    acumuladas.push(...((data.results || []) as CajaQr[]));
    url = normalizarUrlApi(data.next);
  }

  return acumuladas.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
}

/**
 * Pide el PDF de etiquetas al backend y devuelve el blob listo para imprimir.
 *
 * El backend marca `qr_impreso = true` en las cajas incluidas cuando el PDF se
 * generó correctamente (`marcar_impreso=1`).
 */
export async function pedirPdfEtiquetas(opciones: OpcionesPdfEtiquetas): Promise<PdfEtiquetas> {
  const params = new URLSearchParams({
    filtro: opciones.filtro,
    formato: opciones.formato,
    marcar_impreso: '1',
  });
  if (opciones.filtro === 'manual') params.set('ids', opciones.ids.join(','));

  const res = await fetch(
    `${API_BASE_URL}/cajas/generar_pdf_qr/?${params.toString()}`,
    { headers: getAuthHeaders() },
  );

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error(SESION_EXPIRADA);
  }
  if (!res.ok) throw new Error(await textoDeError(res));

  return {
    blob: await res.blob(),
    nombre: nombreDesdeCabecera(res, 'etiquetas_qr.pdf'),
  };
}
