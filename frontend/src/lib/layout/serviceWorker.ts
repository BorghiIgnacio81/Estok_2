// =============================================================================
// PWA · SERVICE WORKER + BANNER DE NUEVA VERSIÓN
// Extraído de layouts/BaseLayout.astro (Fase A · refactor preventivo).
// =============================================================================


  // ===========================================================================
  // PWA: SERVICE WORKER + DETECCIÓN DE NUEVA VERSIÓN
  // ===========================================================================

  if ('serviceWorker' in navigator) {
    // Variable para tracking de registro
    let swRegistration: ServiceWorkerRegistration | null = null;

    // =====================================================================
    // CONTROLLERCHANGE: Cuando el nuevo SW toma control (después de que
    // el usuario hizo clic en "Actualizar ahora" y se llamó a
    // registration.waiting.postMessage({ type: 'SKIP_WAITING' })),
    // recargar la página para que el usuario vea la nueva versión.
    // =====================================================================
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('🔄 Nuevo SW tomó control, recargando...');
      window.location.reload();
    });

    // Registrar el Service Worker
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      swRegistration = registration;
      console.log('✅ SW registrado:', registration.scope);

      // =====================================================================
      // DETECCIÓN DE NUEVO SW (updatefound)
      // Cuando el browser detecta que el sw.js cambió (porque el hash o
      // contenido es diferente), instala el nuevo SW. Este nuevo SW queda
      // en estado "waiting" (porque NO llamamos a self.skipWaiting() en install).
      // Acá detectamos ese estado y mostramos el banner.
      // =====================================================================
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('🆕 Nueva versión detectada via updatefound');
              mostrarBannerActualizacion(registration);
            }
          });
        }
      });

      // =====================================================================
      // VERIFICACIÓN INICIAL: Si ya hay un SW esperando (por ejemplo, si
      // la página se cargó mientras se actualizaba en segundo plano).
      // =====================================================================
      if (registration.waiting && navigator.serviceWorker.controller) {
        console.log('🆕 Nueva versión detectada via registration.waiting');
        mostrarBannerActualizacion(registration);
      }

      // =====================================================================
      // VERIFICACIÓN PERIÓDICA: Cada 60 segundos, checkeamos si hay un
      // nuevo SW disponible llamando a registration.update(). Esto es
      // necesario porque algunos browsers (especialmente en PWA/PWAs
      // instaladas en Android) no siempre disparan 'updatefound'
      // automáticamente.
      // =====================================================================
      setInterval(() => {
        registration.update().catch((err) => {
          console.warn('⚠️ Error en SW update check:', err);
        });
      }, 60000); // cada 60 segundos

      // =====================================================================
      // DETECCIÓN POST-UPDATE: Después de llamar a update(), si hay un
      // nuevo SW, el evento 'updatefound' se dispara. Pero por si acaso
      // el evento no se dispara, también verificamos registration.waiting
      // después de cada update().
      // =====================================================================
      const originalUpdate = registration.update.bind(registration);
      const wrappedUpdate = async function(): Promise<ServiceWorkerRegistration> {
        await originalUpdate();
        if (registration.waiting && navigator.serviceWorker.controller) {
          console.log('🆕 Nueva versión detectada post-update()');
          mostrarBannerActualizacion(registration);
        }
        return registration;
      };
      // Reasignar update() tipando a la firma nativa (ServiceWorkerRegistration['update'])
      // para evitar el error TS en modo estricto al asignar la función envuelta.
      (registration as unknown as { update: () => Promise<ServiceWorkerRegistration> }).update = wrappedUpdate;

    }).catch((err) => {
      console.warn('❌ Error registrando SW:', err);
    });
  }

  // ===========================================================================
  // BANNER DE ACTUALIZACIÓN DISPONIBLE
  // ===========================================================================

  function mostrarBannerActualizacion(registration: ServiceWorkerRegistration) {
    // Evitar duplicados
    if (document.getElementById('updateBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'updateBanner';
    banner.className = 'fixed bottom-0 left-0 right-0 z-[9999] bg-green-600 text-white px-4 py-3 shadow-2xl transform translate-y-full transition-transform duration-500 ease-out';
    banner.innerHTML = `
      <div class="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <svg class="w-6 h-6 flex-shrink-0 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <div>
            <p class="text-sm font-semibold">🆕 Nueva versión disponible</p>
            <p class="text-xs text-green-200">Hay una actualización de Estok lista para instalar.</p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button id="updateLaterBtn" class="text-xs text-green-200 hover:text-white px-3 py-1.5 rounded-lg transition-base">
            Ahora no
          </button>
          <button id="updateNowBtn" class="text-xs font-semibold bg-white text-green-700 px-4 py-1.5 rounded-lg hover:bg-green-50 transition-base shadow-sm">
            🔄 Actualizar ahora
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    // Animar entrada
    requestAnimationFrame(() => {
      banner.classList.remove('translate-y-full');
    });

    // Botón "Actualizar ahora"
    document.getElementById('updateNowBtn')?.addEventListener('click', () => {
      // Enviar mensaje al SW para que skipWaiting()
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      // Recargar la página para usar la nueva versión
      window.location.reload();
    });

    // Botón "Ahora no"
    document.getElementById('updateLaterBtn')?.addEventListener('click', () => {
      banner.classList.add('translate-y-full');
      setTimeout(() => banner.remove(), 500);
    });
  }
