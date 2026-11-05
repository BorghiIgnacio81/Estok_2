// =============================================================================
// SUSCRIPCIÓN PRO (MONETIZACIÓN) — llamadas a la API
// -----------------------------------------------------------------------------
// Único módulo del frontend que habla con /api/suscripciones/. Los headers de
// autenticación se toman de `services/auth` (regla de Auth centralizado: acá NO
// se define ninguna versión propia de getAuthHeaders/getToken).
//
// Flujo:
//   1. crearPreferenciaPro() → POST /suscripciones/crear_preferencia/
//   2. irACheckoutPro()      → redirige a `init_point` (Checkout Pro).
//   3. Mercado Pago avisa al backend (/suscripciones/webhook/) y el plan Pro se
//      activa: al volver, el `?suscripcion=ok` de la back_url refresca el plan.
// =============================================================================

import { API_BASE_URL, getAuthHeaders } from './auth';

export interface PreferenciaPro {
  suscripcion_id: string;
  referencia: string;
  preferencia_id: string;
  init_point: string;
  sandbox_init_point?: string;
  monto: string;
  moneda: string;
  dias: number;
  plan: string;
}

/** Códigos estables que devuelve el backend (no traducir ni renombrar). */
export type CodigoErrorSuscripcion = 'pasarela_no_configurada' | 'pasarela_error';

interface ErrorApi {
  error?: string;
  codigo?: CodigoErrorSuscripcion;
  status?: number;
}

/**
 * Crea la preferencia de Checkout Pro para el usuario autenticado.
 *
 * Devuelve `init_point` (URL de pago de Mercado Pago). Lanza un `ErrorApi` con
 * mensaje listo para mostrar si la pasarela no está configurada (503) o
 * rechazó la operación (502).
 */
export async function crearPreferenciaPro(estokId?: string | null): Promise<PreferenciaPro> {
  const cuerpo: Record<string, string> = {};
  if (estokId) cuerpo.estok_id = estokId;

  const respuesta = await fetch(`${API_BASE_URL}/suscripciones/crear_preferencia/`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });

  if (!respuesta.ok) {
    let datos: ErrorApi = {};
    try {
      datos = await respuesta.json();
    } catch {
      // Respuesta sin JSON: se usa el mensaje genérico.
    }
    throw {
      error: datos.error || 'No se pudo iniciar el pago. Intentá de nuevo más tarde.',
      codigo: datos.codigo,
      status: respuesta.status,
    } as ErrorApi;
  }

  return respuesta.json();
}

/**
 * Inicia el checkout: crea la preferencia y redirige a Mercado Pago.
 *
 * Si algo falla, muestra el aviso con el toast global del layout y devuelve
 * `false` para que el llamador no navegue.
 */
export async function irACheckoutPro(estokId?: string | null): Promise<boolean> {
  try {
    const preferencia = await crearPreferenciaPro(estokId);
    const destino = preferencia.init_point || preferencia.sandbox_init_point || '';
    if (!destino) {
      (window as any).showError?.('La pasarela no devolvió una URL de pago.');
      return false;
    }
    window.location.href = destino;
    return true;
  } catch (error) {
    const detalle = error as ErrorApi;
    (window as any).showError?.(detalle.error || 'No se pudo iniciar el pago.');
    return false;
  }
}
