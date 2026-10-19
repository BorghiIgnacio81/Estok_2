// =============================================================================
// NATIVE SHELL · Compatibilidad PWA standalone / TWA (PWABuilder) / Capacitor
// -----------------------------------------------------------------------------
// Este módulo NO agrega lógica de negocio: sólo adapta la app al contenedor
// nativo donde corre (Chrome instalado, TWA o WebView de Capacitor/Cordova).
//
//   · Detecta standalone / WebView y marca clases en <html>
//     (`is-standalone`, `is-native-shell`, `is-ios`, `is-android`) para que el
//     CSS active safe-areas y desactive comportamientos de navegador.
//   · Sincroniza el color de tema (barra de estado / toolbar) con el dark mode.
//   · Enlaza el botón ATRÁS del hardware Android cuando corre dentro de
//     Capacitor o Cordova (en TWA lo maneja Chrome y no se toca).
//   · Bloquea el doble toque sobre las barras de navegación: en un WebView dos
//     taps rápidos disparan dos navegaciones y la segunda aborta la primera
//     (pantalla en blanco / "net::ERR_ABORTED"). El guard deja pasar un solo
//     tap por gesto.
// =============================================================================

const UA = navigator.userAgent;

const esIOS =
  /iPad|iPhone|iPod/.test(UA) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const esAndroid = /Android/i.test(UA);
// WebView de Android: el UA incluye "; wv)" y "Version/x.y".
const esWebViewAndroid = esAndroid && /; wv\)/i.test(UA) && /Version\/[\d.]+/i.test(UA);
// WebView de iOS (Capacitor/Cordova o navegador in-app): iOS + sin Safari/.
const esWebViewIOS = esIOS && !/Safari\//i.test(UA);

const enStandalone =
  window.matchMedia?.('(display-mode: standalone)').matches === true ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** ¿Corre como app instalada o dentro de un WebView nativo? */
const enShellNativo = enStandalone || esWebViewAndroid || esWebViewIOS;

// --- 1. Clases de entorno ----------------------------------------------------
function marcarEntorno(): void {
  const html = document.documentElement;
  html.classList.toggle('is-standalone', enStandalone);
  html.classList.toggle('is-native-shell', enShellNativo);
  html.classList.toggle('is-ios', esIOS);
  html.classList.toggle('is-android', esAndroid);
}

// --- 2. Color de tema (claro / oscuro) ---------------------------------------
const TEMA_CLARO = '#8B4513'; // marrón de marca (mismo que el manifest light)
const TEMA_OSCURO = '#1e293b'; // slate del dark mode (theme_color del manifest)

function sincronizarTema(): void {
  const oscuro = document.documentElement.classList.contains('dark');
  const color = oscuro ? TEMA_OSCURO : TEMA_CLARO;

  const metaTema = document.getElementById('metaThemeColor') as HTMLMetaElement | null;
  if (metaTema && metaTema.content !== color) metaTema.content = color;

  // iOS standalone: con fondo oscuro conviene la barra translúcida (texto
  // claro); con fondo claro, la barra por defecto mantiene el texto legible.
  const metaBarra = document.getElementById('metaAppleStatusBar') as HTMLMetaElement | null;
  if (metaBarra) metaBarra.content = oscuro ? 'black-translucent' : 'default';
}

// El toggle de dark mode (lib/layout/darkMode.ts) sólo cambia la clase `dark`
// en <html>; observarla evita duplicar aquí la lógica del toggle.
new MutationObserver(sincronizarTema).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class'],
});


// --- 3. Botón ATRÁS del hardware (sólo shell nativo) -------------------------
interface CapacitorAppPlugin {
  addListener?: (evento: string, callback: () => void) => void;
  exitApp?: () => void;
  minimizeApp?: () => void;
}
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: { App?: CapacitorAppPlugin };
}

function navegarAtras(): void {
  // Historial propio: comportamiento esperado (volver a la pantalla anterior).
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  // Raíz de la app: minimizar (Android) o salir, igual que una app nativa.
  const app = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor?.Plugins?.App;
  if (app?.minimizeApp) app.minimizeApp();
  else if (app?.exitApp) app.exitApp();
}

function enlazarBotonAtras(): void {
  const capacitor = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  if (capacitor?.isNativePlatform?.() && capacitor.Plugins?.App?.addListener) {
    capacitor.Plugins.App.addListener('backButton', navegarAtras);
  }
  // Cordova / Capacitor legacy emiten el evento `backbutton` en document.
  document.addEventListener('backbutton', navegarAtras as EventListener);
}

// --- 4. Guard anti doble-toque en la navegación ------------------------------
// Sólo aplica a enlaces marcados como navegación (MobileNavBars y cualquier
// futuro control con [data-native-nav]); no interfiere con botones de formulario.
let bloqueoNavHasta = 0;

document.addEventListener(
  'click',
  (evento) => {
    const objetivo = evento.target as HTMLElement | null;
    const enlace = objetivo?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!enlace) return;
    if (!enlace.matches('[data-mobile-nav-item], [data-native-nav]')) return;
    if (evento.defaultPrevented || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    if (enlace.target && enlace.target !== '_self') return;

    const href = enlace.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

    const ahora = Date.now();
    if (ahora < bloqueoNavHasta) {
      evento.preventDefault();
      return;
    }
    bloqueoNavHasta = ahora + 700;
  },
  true,
);

// --- 5. Ciclo de vida ---------------------------------------------------------
marcarEntorno();
sincronizarTema();
enlazarBotonAtras();

// Al volver desde el historial (bfcache) se libera el guard y se avisa a los
// componentes que deben re-pintar su estado activo.
window.addEventListener('pageshow', (evento) => {
  bloqueoNavHasta = 0;
  if (evento.persisted) marcarEntorno();
  document.dispatchEvent(
    new CustomEvent('estok:pageshow', { detail: { persisted: evento.persisted } }),
  );
});

// Si la app pasa a standalone sin recargar (instalación desde el menú), se
// actualizan las clases para que el CSS de safe-area entre en efecto.
window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', marcarEntorno);
