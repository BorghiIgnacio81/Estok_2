// =============================================================================
// DETECCIÓN DE INSTALACIÓN PWA — FUENTE ÚNICA
// -----------------------------------------------------------------------------
// El botón «Instalar App» del hero del Dashboard NUNCA debe verse cuando Estok
// ya está instalada. Este módulo centraliza esa decisión para que cualquier
// pantalla (hoy sólo el Dashboard) la consulte sin duplicar reglas:
//
//   1. `display-mode` (Android / Chrome / Edge / iOS 16.4+):
//        · standalone  → app instalada abierta sin barra del navegador.
//        · fullscreen / minimal-ui → variantes equivalentes.
//   2. `navigator.standalone` (iOS Safari < 16.4): único indicador en iPhone.
//   3. Referrer `android-app://` → TWA/APK que envuelve la PWA en Android.
//   4. Marca persistente en localStorage: `appinstalled` sólo se dispara en la
//      sesión donde ocurrió la instalación; para las siguientes aperturas desde
//      el navegador se recuerda que la app YA está instalada.
//
// Ocultar SIEMPRE con `style.display = none` además de la clase `hidden`: en
// Tailwind v4 las utilidades de display comparten capa y el orden del bundle
// puede dejar `inline-flex` por encima de `hidden` (el botón reaparecería).
// =============================================================================

/** Id histórico del botón «Instalar App» (pages/index.astro). */
const ID_BOTON_INSTALAR = 'installPwaBtn';

/** Selector de TODO disparador de instalación: id histórico + atributo estable. */
const SELECTOR_BOTONES_INSTALAR = `#${ID_BOTON_INSTALAR}, [data-instalar-pwa]`;

/** Marca persistente de instalación (la escribe el evento `appinstalled`). */
const CLAVE_INSTALADA = 'estok-pwa-instalada';

/** Modos de visualización que significan «abierta como app, no como pestaña». */
const MODOS_APP = ['standalone', 'fullscreen', 'minimal-ui'] as const;

/** ¿El navegador está pintando la app como PWA instalada (no como web)? */
export function esModoAppInstalada(): boolean {
  if (typeof window === 'undefined') return false;

  for (const modo of MODOS_APP) {
    try {
      if (window.matchMedia(`(display-mode: ${modo})`).matches) return true;
    } catch {
      // Navegador sin soporte para esa media query: se prueba la siguiente.
    }
  }

  // iOS Safari (versiones previas a display-mode): bandera propia de Apple.
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;

  // TWA / APK de Android: el contenedor nativo se identifica por el referrer.
  return typeof document !== 'undefined' && document.referrer.startsWith('android-app://');
}

/** ¿Estok ya está instalada (modo app o instalación previa registrada)? */
export function pwaYaInstalada(): boolean {
  if (esModoAppInstalada()) return true;
  try {
    return localStorage.getItem(CLAVE_INSTALADA) === '1';
  } catch {
    // Modo privado / almacenamiento bloqueado: no hay memoria de instalación.
    return false;
  }
}

/** Registra que `appinstalled` se disparó (persiste entre sesiones). */
export function marcarPwaInstalada(): void {
  try {
    localStorage.setItem(CLAVE_INSTALADA, '1');
  } catch {
    // Sin localStorage la app sigue funcionando: sólo se pierde la memoria.
  }
}

/** Oculta de forma definitiva los botones «Instalar App» de la interfaz. */
export function ocultarBotonInstalarPwa(): void {
  document.querySelectorAll<HTMLElement>(SELECTOR_BOTONES_INSTALAR).forEach((boton) => {
    boton.classList.add('hidden');
    boton.setAttribute('hidden', '');
    boton.setAttribute('aria-hidden', 'true');
    boton.style.display = 'none';
  });
}

/** Vuelve a mostrar los botones «Instalar App» (app NO instalada). */
export function mostrarBotonInstalarPwa(): void {
  document.querySelectorAll<HTMLElement>(SELECTOR_BOTONES_INSTALAR).forEach((boton) => {
    boton.classList.remove('hidden');
    boton.removeAttribute('hidden');
    boton.removeAttribute('aria-hidden');
    // Sin estilo en línea vuelve a mandar la clase de display del markup.
    boton.style.display = '';
  });
}

/** Sincroniza la visibilidad del botón con el estado real de instalación. */
export function sincronizarBotonInstalarPwa(): boolean {
  if (!pwaYaInstalada()) return false;
  ocultarBotonInstalarPwa();
  return true;
}

/**
 * Vigila los cambios de estado que pueden ocurrir DESPUÉS de cargar la página:
 * instalación aceptada (`appinstalled`), cambio de `display-mode` (p. ej. abrir
 * desde el historial), retorno desde bfcache y vuelta del segundo plano.
 */
export function vigilarInstalacionPwa(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('appinstalled', () => {
    marcarPwaInstalada();
    ocultarBotonInstalarPwa();
  });

  for (const modo of MODOS_APP) {
    try {
      const consulta = window.matchMedia(`(display-mode: ${modo})`);
      const alCambiar = (): void => {
        if (pwaYaInstalada()) ocultarBotonInstalarPwa();
      };
      if (typeof consulta.addEventListener === 'function') {
        consulta.addEventListener('change', alCambiar);
      } else {
        // Safari antiguo: sólo expone el listener heredado (deprecado en TS).
        const consultaLegacy = consulta as unknown as { addListener: (cb: () => void) => void };
        consultaLegacy.addListener(alCambiar);
      }
    } catch {
      // Sin soporte de media queries: los listeners de abajo siguen cubriendo.
    }
  }

  window.addEventListener('pageshow', () => {
    sincronizarBotonInstalarPwa();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sincronizarBotonInstalarPwa();
  });

  sincronizarBotonInstalarPwa();
}
