// =============================================================================
// ASISTENTE DE BIENVENIDA (ONBOARDING) — PUNTO DE ENTRADA
// -----------------------------------------------------------------------------
// Intercepta el ESTADO VACÍO de inquilinato (usuario recién registrado como
// "Prueba1", sin Estok → 403 en Dashboard/Almacenamiento) y despliega a pantalla
// completa el Asistente de Bienvenida en vez del panel ordinario.
//
// Orden de decisión (multi-tenant):
//   1. Chequeo SÍNCRONO de la caché de sesión → la marca `data-estok-onboarding`
//      en <html> la fija un script inline del componente (sin flash de panel).
//   2. Confirmación contra el backend (GET /api/estoks/mis-estoks/): si el
//      usuario SÍ tiene Estoks, se desactiva el asistente y se activa el primero
//      (evita falsos positivos por caché obsoleta).
//   3. Si la lista real viene vacía → asistente activo (paso 1 obligatorio).
// =============================================================================

import { consultarEstoksDelUsuario, hayEstokEnCache, sincronizarEstokActivo } from './api';
import { AsistenteBienvenida } from './wizard';

export * from './api';
export { AsistenteBienvenida } from './wizard';

export const ATRIBUTO_ONBOARDING = 'data-estok-onboarding';

/** Marca global (<html>) que oculta el panel ordinario y muestra el asistente. */
export function activarOnboarding(): void {
  document.documentElement.setAttribute(ATRIBUTO_ONBOARDING, 'activo');
}

export function desactivarOnboarding(): void {
  document.documentElement.removeAttribute(ATRIBUTO_ONBOARDING);
}

let asistente: AsistenteBienvenida | null = null;
let iniciado = false;

/**
 * Arranca el asistente si corresponde. Idempotente: se puede invocar desde
 * cualquier página sin duplicar listeners.
 */
export async function iniciarAsistenteBienvenida(rootId = 'onbRoot'): Promise<void> {
  if (iniciado) return;
  const root = document.getElementById(rootId);
  if (!root) return;
  iniciado = true;

  // 1) Decisión inmediata (caché) → asistente visible y ya operativo.
  if (!hayEstokEnCache()) {
    activarOnboarding();
    asistente = new AsistenteBienvenida(root);
    asistente.iniciar();
  }

  // 2) Fuente de verdad: el backend.
  const estoks = await consultarEstoksDelUsuario();
  if (estoks === null) return; // No confirmado (red/403): se respeta la decisión local.
  if (estoks.length > 0) {
    // Tiene Estoks: NUNCA se bloquea al usuario con el asistente.
    if (asistente && !asistente.estokFundado) {
      asistente = null;
      desactivarOnboarding();
    }
    await sincronizarEstokActivo(estoks);
    return;
  }

  // 3) Lista real vacía → asistente obligatorio (aunque la caché mintiera).
  if (!asistente) {
    activarOnboarding();
    asistente = new AsistenteBienvenida(root);
    asistente.iniciar();
  }
}
