// =============================================================================
// BASE LAYOUT - Orquestador de la lógica de cliente del layout
// -----------------------------------------------------------------------------
// Fase A (refactor preventivo): el <script> inline de layouts/BaseLayout.astro
// se fragmentó en módulos cohesivos bajo src/lib/layout/. Este archivo los
// importa en el mismo orden en que se ejecutaban antes y dispara la
// inicialización de la UI cuando el DOM está listo.
// =============================================================================

// Módulos con efectos de arranque (registran sus propios listeners al importarse):
import './toasts';        // toasts globales (window.showToast/showSuccess/...)
import './nativeShell';   // PWA standalone / TWA / WebView: tema, atrás, safe-area
import './godModeNav';    // navbar Admin Global (solo ygumy44)
import './darkMode';      // toggle de modo oscuro
import './serviceWorker'; // registro de SW + banner de nueva versión
import './heartbeat';     // ping cada 30 s
import './presencia';     // usuarios online
import './redeploy';      // detección de nuevo deploy

import { updateAuthUI } from './navEscritorio';
import { updateEstokUIMobile, updateEstokBarMobile } from './navMovil';

/**
 * Inicializa la UI del layout. Se invoca después de que todos los módulos
 * estén cargados para evitar errores de TDZ (Temporal Dead Zone).
 */
function initUI(): void {
  updateAuthUI();          // incluye updateEstokUI() y updateGodModeUI()
  updateEstokUIMobile();
  updateEstokBarMobile();
}

if (document.readyState === 'complete') {
  initUI();
} else {
  window.addEventListener('load', () => {
    initUI();
  });
}
