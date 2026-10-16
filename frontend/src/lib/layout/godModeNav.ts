// =============================================================================
// NAVBAR · ADMIN GLOBAL (god mode, solo 'ygumy44')
// Extraído de layouts/BaseLayout.astro (Fase A · refactor preventivo).
// =============================================================================
import { getCachedUser } from '../../services/auth';


  // ===========================================================================
  // ADMIN GLOBAL - Toggle directo del Panel de Control (SOLO ygumy44)
  // El botón ROJO es INVISIBLE para cualquier otro usuario.
  // El requisito es estricto: username EXACTO 'ygumy44'.
  //
  // Al presionarlo alterna la visibilidad del panel #godPanel integrado en el
  // Dashboard (index.astro). Si no estamos en el Dashboard, navega a "/" y
  // guarda un flag en sessionStorage para que el panel se abra al cargar.
  // ===========================================================================

  const godModeWrap = document.getElementById('godModeWrap');
  const godModeBtn = document.getElementById('godModeBtn');
  const godModeWrapMobile = document.getElementById('godModeWrapMobile');
  const godModeBtnMobile = document.getElementById('godModeBtnMobile');

  export function updateGodModeUI() {
    const user = getCachedUser();
    const esGod = user?.username === 'ygumy44';
    godModeWrap?.classList.toggle('hidden', !esGod);
    godModeWrapMobile?.classList.toggle('hidden', !esGod);
  }

  function toggleAdminGlobal() {
    const panel = document.getElementById('godPanel');
    if (panel) {
      // Estamos en el Dashboard (index.astro). El panel es dueño de su propia
      // visibilidad: se dispara el evento global y un listener vanilla JS en
      // index.astro expande/colapsa #godPanel y sincroniza el estado .is-open
      // de los botones. Así el Navbar no queda acoplado al DOM interno del panel.
      window.dispatchEvent(new CustomEvent('estok:admin-open'));
    } else {
      // No estamos en el Dashboard: navegar con flag para abrir el panel
      sessionStorage.setItem('estok_admin_panel', '1');
      window.location.href = '/';
    }
  }

  // Toggle desde el navbar desktop
  godModeBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleAdminGlobal();
  });

  // Toggle desde el acceso móvil (Admin Global vive justo debajo de las 3
  // barras naranja-crema: ya no hay menú hamburguesa que cerrar).
  godModeBtnMobile?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleAdminGlobal();
  });
