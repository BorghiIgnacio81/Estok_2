// =============================================================================
// URL BASE DE LA API — FUENTE ÚNICA DE VERDAD (anti Mixed Content)
// -----------------------------------------------------------------------------
// Todas las rutas fetch del frontend deben resolver su base importando
// `API_BASE_URL` desde este módulo (o desde '../services/auth', que la
// re-exporta). Está PROHIBIDO volver a definir `API_BASE_URL` en otro archivo
// (regla de Auth centralizado del proyecto).
//
// POR QUÉ EXISTE LA NORMALIZACIÓN:
// La página se sirve por HTTPS (https://eeestok.duckdns.org). Si la variable
// PUBLIC_API_URL (env del build/deploy) quedara configurada como URL absoluta
// `http://eeestok.duckdns.org/api`, cada fetch a /api/objetos/,
// /api/contenedores/, etc. sería Mixed Content: el navegador lo BLOQUEA y la
// bandeja de «elementos por ubicar» termina en 0.
//
// Regla aplicada en el navegador (window disponible):
//   1. Base absoluta del MISMO origen que la página → se reduce a ruta
//      relativa (p.ej. 'http://eeestok.duckdns.org/api' → '/api'). Mismo
//      origen = cero Mixed Content y cero CORS.
//   2. Base absoluta `http://` vista desde una página `https://` de OTRO
//      origen → se fuerza `https://` (única vía legal desde una página HTTPS).
//   3. Base relativa (`/api`), vacía o protocolo-relativa (`//host/api`) → se
//      mantiene: hereda el esquema de la página y jamás genera Mixed Content.
// Fuera del navegador (SSR / build) se devuelve el valor configurado tal cual.
// =============================================================================

const PUBLIC_API_URL = (import.meta.env.PUBLIC_API_URL || '').trim();

function esUrlAbsolutaHttp(valor: string): boolean {
  return /^https?:\/\//i.test(valor);
}

function relativaSinTrailingSlash(ruta: string): string {
  const limpia = ruta.replace(/\/+$/, '');
  return limpia.startsWith('/') ? limpia : `/${limpia}`;
}

/**
 * Normaliza una URL de la API (base o `next` de paginación de DRF) para que
 * NUNCA se dispare un fetch http:// desde una página https://.
 * - URL absoluta del mismo origen que la página → ruta relativa (path + query).
 * - URL http:// distinta de la página (https) → esquema https://.
 * - Ruta relativa / protocolo-relativa → se devuelve intacta.
 * - null/'' → null (para consumir data.next sin condicionales).
 */
export function normalizarUrlApi(url: string | null | undefined): string | null {
  if (url == null) return null;
  const crudo = String(url).trim();
  if (!crudo) return null;

  // Relativa o protocolo-relativa: ya es segura (hereda el esquema de la página).
  if (!esUrlAbsolutaHttp(crudo)) return crudo;

  try {
    const apiUrl = new URL(crudo);
    const hayNavegador = typeof window !== 'undefined' && !!window.location;
    if (hayNavegador) {
      // Mismo origen → ruta relativa limpia (evita Mixed Content Y CORS).
      if (apiUrl.origin === window.location.origin) {
        return apiUrl.pathname + apiUrl.search + apiUrl.hash;
      }
      // Página HTTPS nunca debe llamar por HTTP.
      if (window.location.protocol === 'https:' && apiUrl.protocol === 'http:') {
        apiUrl.protocol = 'https:';
      }
    }
    return apiUrl.toString();
  } catch {
    return crudo;
  }
}

/**
 * Resuelve la URL base (sin trailing slash) de la API de Django.
 * PUBLIC_API_URL vacío → '/api' (mismo origen, vía Nginx interno del contenedor).
 */
export function resolverApiBaseUrl(): string {
  if (!PUBLIC_API_URL) return '/api';

  if (!esUrlAbsolutaHttp(PUBLIC_API_URL)) {
    return relativaSinTrailingSlash(PUBLIC_API_URL);
  }

  const normalizada = normalizarUrlApi(PUBLIC_API_URL) ?? PUBLIC_API_URL;

  if (esUrlAbsolutaHttp(normalizada)) {
    try {
      const u = new URL(normalizada);
      u.pathname = u.pathname.replace(/\/+$/, '') || '/';
      return u.toString().replace(/\/+$/, '');
    } catch {
      return normalizada.replace(/\/+$/, '');
    }
  }

  return relativaSinTrailingSlash(normalizada);
}

/** URL base definitiva: único valor que deben consumir los fetch del frontend. */
export const API_BASE_URL = resolverApiBaseUrl();
