// =============================================================================
// SUBIDAS MULTIPART (FOTOS) - JWT EXPLÍCITO + REFRESCO AUTOMÁTICO
// -----------------------------------------------------------------------------
// ÚNICO punto de salida de los formularios multipart con archivos (fotos de
// objetos, espacios y muebles). Garantiza:
//   · Authorization: Bearer <token leído de localStorage en el momento>,
//   · X-Estok-Id (multi-tenant) e X-CSRFToken cuando Django lo emitió,
//   · NO fija Content-Type: el navegador agrega el boundary de multipart,
//   · si el JWT venció (PWA abierta varios días) refresca UNA vez y reenvía el
//     MISMO FormData, en vez de devolver un 401/403 silencioso.
// Auth centralizada: los headers SIEMPRE salen de services/auth.
// =============================================================================

import { API_BASE_URL } from './apiBase';
import { getToken, refreshToken } from './tokens';
import { getAuthHeaders } from './session';

/** Métodos aceptados por las subidas multipart del proyecto. */
export type MetodoFormData = 'POST' | 'PUT' | 'PATCH';

/**
 * Envía un FormData a `${API_BASE_URL}${path}` con autenticación explícita.
 * @param headersExtra headers adicionales para ESTA petición (p. ej. el
 *   `X-Estok-Id`/`X-CSRFToken` reforzados del tutorial). Nunca reemplazan a los
 *   centralizados: se fusionan sobre ellos.
 * @returns la Response del backend (el llamador decide cómo interpretarla)
 */
export async function enviarFormData(
  path: string,
  formData: FormData,
  method: MetodoFormData = 'POST',
  headersExtra: Record<string, string> = {},
): Promise<Response> {
  const enviar = (token: string | null): Promise<Response> =>
    fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: headersDeSubida(token, headersExtra),
      body: formData,
      // Mismo origen: deja disponible la cookie de sesión/CSRF de Django.
      credentials: 'same-origin',
    });

  const tokenInicial = getToken();
  let respuesta = await enviar(tokenInicial);

  // JWT vencido: un único reintento con el token renovado.
  if (respuesta.status === 401 && tokenInicial) {
    try {
      const tokenNuevo = await refreshToken();
      respuesta = await enviar(tokenNuevo);
    } catch {
      // Sin refresh válido se devuelve el 401 original.
    }
  }

  return respuesta;
}

/** Headers de una subida: los centralizados + el token del intento vigente. */
function headersDeSubida(
  token: string | null,
  headersExtra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = { ...getAuthHeaders(), ...headersExtra };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // multipart/form-data: el boundary lo calcula el navegador.
  delete headers['Content-Type'];
  return headers;
}
