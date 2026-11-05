// =============================================================================
// PUBLICIDAD DINÁMICA (MONETIZACIÓN) — lógica de cliente
// -----------------------------------------------------------------------------
// ÚNICO lugar que decide si el usuario ve anuncios. El backend ya resuelve el
// plan (`GET /api/usuarios/me/` devuelve `ocultar_publicidad`, `es_premium` y
// `plan_suscripcion` heredados del hogar); acá sólo se aplica a la UI.
//
// Regla de oro: cuando corresponde ocultar la publicidad, los contenedores
// `[data-ad-container]` se DESTRUYEN con `remove()`. No se usa `display:none`
// ni `visibility:hidden`: así no queda ningún hueco, margen ni borde en la UI.
//
// El componente `<AdContainer />` (components/AdContainer.astro) renderiza el
// slot OCULTO por defecto, de modo que un usuario Pro nunca ve un parpadeo de
// anuncio antes de que este módulo resuelva el plan.
//
// Puente nativo (TWA / Capacitor): el wrapper Android puede leer
// `window.EstokAds.estado` y escuchar el evento `estok:publicidad` para
// montar/desmontar el banner nativo de AdMob en el mismo slot.
// =============================================================================

import { API_BASE_URL, getAuthHeaders, getCachedUser } from '../../services/auth';

export interface EstadoPublicidad {
  /** true = no debe verse ningún anuncio (plan Pro propio o heredado). */
  ocultar: boolean;
  /** true = el usuario tiene plan Pro activo. */
  premium: boolean;
  /** 'free' | 'pro' */
  plan: string;
  motivo: 'pro' | 'gratuito' | 'anonimo';
}

const CLAVE_CACHE = 'estok_publicidad_estado';
const SELECTOR = '[data-ad-container]';

export const ESTADO_PUBLICIDAD_INICIAL: EstadoPublicidad = {
  ocultar: true,          // por defecto NO se muestra publicidad hasta resolver
  premium: false,
  plan: 'free',
  motivo: 'anonimo',
};

/** Estado de publicidad derivado del usuario cacheado (sin red). */
export function estadoDesdeUsuario(usuario: Record<string, any> | null): EstadoPublicidad {
  if (!usuario) return { ...ESTADO_PUBLICIDAD_INICIAL };

  const plan = String(usuario.plan_suscripcion || 'free').toLowerCase();
  const premium = Boolean(usuario.es_premium) || plan === 'pro';
  const ocultar = Boolean(usuario.ocultar_publicidad) || premium;

  return {
    ocultar,
    premium,
    plan: premium ? 'pro' : 'free',
    motivo: ocultar ? 'pro' : 'gratuito',
  };
}

function leerCache(): EstadoPublicidad | null {
  try {
    const crudo = localStorage.getItem(CLAVE_CACHE);
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    if (typeof datos?.ocultar !== 'boolean') return null;
    return {
      ocultar: datos.ocultar,
      premium: Boolean(datos.premium),
      plan: String(datos.plan || 'free'),
      motivo: datos.motivo === 'pro' ? 'pro' : 'gratuito',
    };
  } catch {
    return null;
  }
}

function guardarCache(estado: EstadoPublicidad): void {
  try {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify(estado));
  } catch {
    // Sin localStorage (modo privado estricto): la UI igual funciona.
  }
}

/**
 * Aplica el estado a TODOS los contenedores de publicidad del documento.
 *
 * - ocultar + plan RESUELTO → `remove()` (el hueco desaparece del layout).
 * - ocultar sin resolver (todavía no sabemos el plan) → se deja `hidden`: el
 *   slot ya nace oculto en el HTML, así que NO se destruye. Destruirlo acá era
 *   el bug que dejaba a un usuario gratuito sin banner en su primera visita
 *   (la respuesta del backend llegaba después del `remove()`).
 * - mostrar → se revela el slot y se avisa por evento para que se pinte el
 *   banner (AdSense en web / AdMob nativo en la TWA).
 */
export function aplicarEstadoPublicidad(estado: EstadoPublicidad): void {
  if (typeof document === 'undefined') return;

  const contenedores = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
  const planResuelto = estado.motivo !== 'anonimo';

  for (const contenedor of contenedores) {
    if (estado.ocultar) {
      if (planResuelto) contenedor.remove();
      continue;
    }
    contenedor.hidden = false;
    contenedor.removeAttribute('aria-hidden');
    contenedor.dataset.estado = 'visible';
  }

  const visibles = estado.ocultar ? [] : contenedores;

  // Puente para el wrapper nativo (banner AdMob montado por la app Android).
  const puente = (window as any).EstokAds || {};
  puente.estado = estado;
  puente.contenedores = visibles;
  (window as any).EstokAds = puente;

  window.dispatchEvent(new CustomEvent('estok:publicidad', {
    detail: { estado, contenedores: visibles },
  }));
}

/** Consulta el plan real en el backend (fuente de verdad). */
async function consultarEstado(): Promise<EstadoPublicidad | null> {
  const headers = getAuthHeaders();
  if (!headers.Authorization) {
    // Sin sesión (páginas públicas: legales, login) no se muestra publicidad.
    return { ...ESTADO_PUBLICIDAD_INICIAL };
  }

  try {
    const respuesta = await fetch(`${API_BASE_URL}/usuarios/me/`, { headers });
    if (!respuesta.ok) return null;
    const usuario = await respuesta.json();
    return estadoDesdeUsuario(usuario);
  } catch {
    return null;
  }
}

/**
 * Resuelve el plan y aplica el resultado. Devuelve el estado usado.
 *
 * Es la función que deben llamar las páginas después de un cambio de plan
 * (por ejemplo al volver del checkout de la suscripción Pro).
 */
export async function refrescarPublicidad(): Promise<EstadoPublicidad> {
  const estado = (await consultarEstado()) ?? leerCache() ?? estadoDesdeUsuario(getCachedUser());
  guardarCache(estado);
  aplicarEstadoPublicidad(estado);
  return estado;
}

/**
 * Arranque del módulo (lo llama BaseLayout):
 *   1. aplica el estado cacheado al instante (sin parpadeo de anuncios),
 *   2. consulta el backend y corrige si cambió el plan,
 *   3. re-aplica si el usuario cambia de plan en otra pestaña.
 */
export function inicializarPublicidad(): void {
  if (typeof window === 'undefined') return;

  const cache = leerCache() ?? estadoDesdeUsuario(getCachedUser());
  aplicarEstadoPublicidad(cache);

  void refrescarPublicidad();

  window.addEventListener('storage', (evento) => {
    if (!evento.key || evento.key.startsWith('estok_')) {
      void refrescarPublicidad();
    }
  });
}
