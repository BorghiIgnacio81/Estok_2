// =============================================================================
// PROPIEDAD DEL OBJETO Y MODO DE DECISIÓN (única regla de la UI patrimonial)
// -----------------------------------------------------------------------------
// La tarjeta de /alertas-stock y la ficha del objeto NO deciden por su cuenta
// qué botones mostrar: preguntan acá. Se compara el ID del usuario autenticado
// (`usuarioActualId()`) con el propietario registrado del objeto (`dueno_id`):
//
//   · 'propietario' → el objeto es SUYO: Conservar / Vender / Tirar (Donar).
//                     Se persiste con POST /api/objetos/{id}/tomar_decision/
//   · 'sin_dueno'   → el objeto NO tiene propietario (`dueno_id === null`): no
//                     hay decisión individual posible, se PROPONE al grupo con
//                     «Iniciar votación» (POST /api/objetos/{id}/iniciar_votacion/)
//   · 'ajeno'       → el objeto es de OTRO usuario: sólo «Avisar al propietario»
//                     (POST /api/objetos/{id}/avisar_propietario/). El backend
//                     además responde 403 si se intenta decidir igual.
//
// El dueño EXTERNO (texto plano, sin cuenta) no tiene `dueno_id`: la regla lo
// trata como 'sin_dueno' y la decisión se resuelve votando, igual que hace el
// backend (HTTP 202 → votación del Estok).
//
// Auth 100% centralizada: getCachedUser()/getToken() de services/auth.
// =============================================================================

import { getCachedUser, getToken } from '../services/auth';

/** Veredicto de propiedad sobre un objeto del inventario. */
export type ModoDecisionPropiedad = 'propietario' | 'sin_dueno' | 'ajeno';

/** Campos de propiedad que exponen la ficha y el tablero de Decisiones. */
export interface ObjetoConPropietario {
  /** Dueño registrado (FK). `null`/ausente ⇒ objeto sin propietario. */
  dueno_id?: string | null;
  /** Alias histórico del MISMO dato (`dueno_original` en el detalle). */
  dueno_original?: string | null;
  /** Dueño externo/fallecido (texto plano, sin cuenta en el Estok). */
  dueno_externo_nombre?: string | null;
}

/** ID del usuario autenticado desde el claim del JWT (respuesta secundaria). */
function idDelToken(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''));
    return payload?.user_id ? String(payload.user_id) : null;
  } catch {
    return null;
  }
}

/**
 * ID del usuario autenticado (`usuario_actual.id`).
 *
 * Prioriza la caché de sesión (services/auth) y cae al claim `user_id` del JWT
 * cuando la caché todavía no se hidrató. Devuelve null sin sesión.
 */
export function usuarioActualId(): string | null {
  const cacheado = getCachedUser()?.id;
  if (cacheado) return String(cacheado);
  return idDelToken();
}

/** Dueño registrado del objeto, normalizado a string (`null` si no tiene). */
export function duenoObjetoId(obj: ObjetoConPropietario | null | undefined): string | null {
  if (!obj) return null;
  const crudo = obj.dueno_id ?? obj.dueno_original ?? '';
  const id = String(crudo || '').trim();
  return id || null;
}

/** Nombre a mostrar del emisor del aviso (usuario autenticado). */
export function nombreUsuarioActual(): string {
  const usuario = getCachedUser();
  if (!usuario) return 'Un miembro del Estok';
  const completo = `${usuario.first_name || ''} ${usuario.last_name || ''}`.trim();
  return completo || usuario.username || 'Un miembro del Estok';
}

/**
 * Modo de decisión del objeto para el usuario autenticado.
 *
 * Es la ÚNICA fuente del condicional de la interfaz patrimonial: cualquier
 * página que necesite saber si mostrar los botones individuales, el de
 * votación o el de aviso debe llamar a esta función.
 */
export function modoDecisionObjeto(
  obj: ObjetoConPropietario | null | undefined,
): ModoDecisionPropiedad {
  const dueno = duenoObjetoId(obj);
  if (!dueno) return 'sin_dueno';
  const actual = usuarioActualId();
  return actual && dueno === actual ? 'propietario' : 'ajeno';
}
