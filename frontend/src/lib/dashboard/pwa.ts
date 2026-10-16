// =============================================================================
// DASHBOARD - PWA INSTALL (Android 1-tap + iOS Safari guiado)
// Extraido de pages/index.astro (Fase A refactor preventivo).
// =============================================================================

  // ===========================================================================
  // PWA INSTALL - Android nativo (1 tap) + iOS Safari (2 taps guiados)
  // ===========================================================================
  //
  // IMPORTANTE TÉCNICO: Apple NO permite beforeinstallprompt en iOS Safari.
  // Es una restricción de la plataforma, no del código. Todas las PWAs
  // (Twitter, Uber, Starbucks, Pinterest) tienen la misma limitación.
  // El flujo iOS usa el botón nativo "Compartir" de Safari, que es el
  // método oficial documentado por Apple.
  // ===========================================================================

  let deferredPrompt: any = null;

  const installPwaBtn = document.getElementById('installPwaBtn')!;

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isSafari = /Safari/i.test(navigator.userAgent) && !/CriOS|FxiOS|OPiOS|mercury/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true;

  if (isStandalone) {
    installPwaBtn?.classList.add('hidden');
  } else {
    installPwaBtn?.classList.remove('hidden');
  }

  // Android Chrome/Edge: capturar beforeinstallprompt para instalar en 1 tap
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('📲 PWA: beforeinstallprompt listo (1-tap)');
    window.dispatchEvent(new CustomEvent('estok-pwa-ready'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installPwaBtn?.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('estok-pwa-installed'));
    console.log('✅ Estok instalada como PWA');
  });

  function mostrarPromptIOS() {
    // Evitar duplicados
    if (document.getElementById('iosPrompt')) return;

    const esChrome = /CriOS/i.test(navigator.userAgent);

    const overlay = document.createElement('div');
    overlay.id = 'iosPrompt';
    overlay.className = 'fixed inset-0 z-[9999] flex items-end justify-center bg-black/40 backdrop-blur-sm animate-fade-in';
    overlay.innerHTML = `
      <div class="bg-white rounded-t-3xl w-full max-w-md mx-auto px-6 pt-6 pb-8 shadow-2xl animate-slide-up">
        <!-- Handle bar -->
        <div class="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5"></div>

        <!-- Icon + Title -->
        <div class="text-center mb-5">
          <img src="/icons/apple-touch-icon.png" alt="Estok" class="w-16 h-16 rounded-2xl mx-auto mb-3 shadow-md" />
          <h3 class="text-lg font-bold text-gray-900">Instalar Estok</h3>
          <p class="text-sm text-gray-500 mt-1">Agregá Estok a tu pantalla de inicio para usarla como una app.</p>
        </div>

        ${esChrome ? `
        <!-- Usuario en Chrome: necesita Safari -->
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-center">
          <p class="text-sm font-semibold text-amber-800 mb-2">⚠️ Necesitás Safari</p>
          <p class="text-xs text-amber-700 mb-3">Chrome en iPhone no permite instalar apps. Abrí esta página en Safari para continuar.</p>
          <button id="iosCopiarEnlaceBtn" class="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition-base shadow-sm">
            📋 Copiar enlace para abrir en Safari
          </button>
        </div>
        ` : `
        <!-- Usuario en Safari: mostrar instrucción simple -->
        <div class="text-center space-y-3">
          <div class="flex items-center justify-center gap-3 p-4 bg-blue-50 rounded-xl">
            <div class="flex-shrink-0 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
              <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <p class="text-sm font-semibold text-blue-800 text-left leading-snug">
              Tocá <span class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white rounded text-xs font-bold border border-blue-200">📤 Compartir</span><br>
              y luego <span class="font-bold">"Agregar a inicio"</span>
            </p>
          </div>
        </div>
        `}

        <button id="iosCerrarBtn" class="w-full mt-4 px-4 py-3 text-sm font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-base">
          ${esChrome ? 'Cerrar' : 'Entendido'}
        </button>
      </div>
    `;

    document.body.appendChild(overlay);

    const cerrar = () => {
      overlay.classList.add('animate-fade-out');
      setTimeout(() => overlay.remove(), 200);
    };

    document.getElementById('iosCerrarBtn')?.addEventListener('click', cerrar);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cerrar();
    });

    // Copiar enlace (solo Chrome)
    document.getElementById('iosCopiarEnlaceBtn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href).then(() => {
        (window as any).showSuccess?.('✅ Enlace copiado. Pegalo en Safari para instalar.');
      }).catch(() => {
        (window as any).showInfo?.('Copiá manualmente el enlace y abrilo en Safari.');
      });
      cerrar();
    });
  }

  async function installPWA(): Promise<boolean> {
    if (deferredPrompt) {
      // Android: 1-tap install vía beforeinstallprompt nativo
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (result.outcome === 'accepted') {
        (window as any).showSuccess?.('✅ Estok instalada');
        return true;
      }
      return false;
    }

    if (isIOS) {
      // iOS: mostrar prompt profesional con instrucción mínima
      mostrarPromptIOS();
      return false;
    }

    // Desktop / otros
    (window as any).showInfo?.('Usá el menú del navegador para instalar esta app.');
    return false;
  }

  (window as any).installPWA = installPWA;
  installPwaBtn?.addEventListener('click', () => installPWA());
