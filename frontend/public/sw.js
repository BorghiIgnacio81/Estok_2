// =============================================================================
// Service Worker - Estok PWA
// Estrategia: Stale-While-Revalidate (Network First con fallback a caché)
// - Siempre intenta obtener la versión más reciente de la red
// - Si la red falla, sirve desde la caché
// - En segundo plano, actualiza la caché con la respuesta de la red
// - Se auto-activa inmediatamente al detectar un nuevo SW (self.skipWaiting())
// - Recarga la página automáticamente cuando el SW toma el control
// =============================================================================

// =============================================================================
// CACHE VERSION - Incrementar CADA VEZ que se haga un deploy con cambios
// en el frontend. Esto fuerza al browser a detectar un nuevo Service Worker
// y descargar los assets frescos desde la red.
// =============================================================================
const CACHE_VERSION = 13;
const CACHE_NAME = 'estok-cache-v' + CACHE_VERSION;
const STATIC_ASSETS = [
  '/',
  '/favicon.ico',
  '/favicon.png',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/apple-touch-icon.png',
];

// =============================================================================
// INSTALL - Precargar assets críticos y activarse inmediatamente
// =============================================================================
self.addEventListener('install', (event) => {
  // Auto-activar este SW inmediatamente, sin esperar a que el usuario cierre
  // todas las pestañas. Esto evita que quede un SW viejo sirviendo contenido
  // cacheado mientras el nuevo espera en estado "waiting".
  self.skipWaiting();

  // Precargar assets críticos en la caché para que estén disponibles offline
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] No se pudieron precargar todos los assets estáticos:', err);
      });
    })
  );
});

// =============================================================================
// ACTIVATE - Limpiar cachés viejas y tomar control de todas las pestañas
// =============================================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Eliminando caché vieja:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Tomar control de todas las pestañas abiertas inmediatamente
      // para que el nuevo SW empiece a interceptar requests
      return self.clients.claim();
    }).then(() => {
      // Notificar a todas las pestañas que el SW se actualizó
      // para que puedan recargar la página automáticamente
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED' });
        });
      });
    })
  );
});

// =============================================================================
// FETCH - Estrategia Stale-While-Revalidate
// =============================================================================
// 1. Para navegación (HTML): siempre va a la red, NUNCA usa caché
// 2. Para API calls: siempre va a la red, NUNCA usa caché
// 3. Para assets estáticos: intenta red primero, si falla usa caché
//    (Stale-While-Revalidate)
// =============================================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo manejar requests del mismo origen
  if (url.origin !== self.location.origin) return;

  // =====================================================================
  // NAVEGACIÓN (HTML) - Siempre red, nunca caché
  // =====================================================================
  // Las páginas HTML deben cargarse siempre desde la red para garantizar
  // que el usuario vea la versión más reciente después de un deploy.
  // Si la red falla, mostrar página de error (no servir HTML cacheado).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        // Si la red falla, intentar servir la página principal desde caché
        // como fallback de emergencia (offline total)
        return caches.match('/').then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Si no hay nada en caché, devolver un error 503
          return new Response('Sin conexión', { status: 503, statusText: 'Service Unavailable' });
        });
      })
    );
    return;
  }

  // =====================================================================
  // API CALLS - Siempre red, nunca caché
  // =====================================================================
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/ml-callback/')) return;

  // =====================================================================
  // ASSETS ESTÁTICOS - Stale-While-Revalidate
  // =====================================================================
  // Estrategia: intentar red primero. Si la red responde, actualizar caché
  // y devolver la respuesta. Si la red falla, devolver desde caché.
  // Esto asegura que los assets siempre estén actualizados cuando hay red,
  // pero la app sigue funcionando offline.
  const isStaticAsset = /\.(css|js|json|ico|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot)$/i.test(url.pathname);
  if (!isStaticAsset) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Si la respuesta es válida, actualizar la caché en segundo plano
        if (response.ok) {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clonedResponse);
          });
        }
        return response;
      })
      .catch(() => {
        // Si la red falla, servir desde caché
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Si no está en caché ni en red, devolver un 404
          return new Response('', { status: 404, statusText: 'Not Found' });
        });
      })
  );
});

// =============================================================================
// MENSAJES DESDE LA PÁGINA (cliente)
// =============================================================================
// Escuchar mensajes del frontend (BaseLayout.astro) para:
// - SKIP_WAITING: legacy, ya no es necesario porque usamos self.skipWaiting()
// - SW_UPDATED: el frontend puede reaccionar si lo desea
// =============================================================================
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    // Legacy: mantener por compatibilidad con versiones anteriores del frontend
    self.skipWaiting();
  }
});

// =============================================================================
// PUSH NOTIFICATIONS
// =============================================================================
self.addEventListener('push', (event) => {
  let data = { title: 'Estok', body: 'System notification', icon: '/icons/icon-192x192.png' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (error) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/',
    },
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
