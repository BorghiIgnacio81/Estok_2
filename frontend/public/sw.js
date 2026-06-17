// =============================================================================
// Service Worker - Estok PWA
// Caches static assets for offline support
// Handles push notifications
// =============================================================================

const CACHE_NAME = 'estok-cache-v5';
const STATIC_ASSETS = [
  '/',
  '/favicon.ico',
  '/favicon.png',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/apple-touch-icon.png',
];

// Listen for SKIP_WAITING message from the client (BaseLayout.astro)
// This allows the new SW to activate immediately when a new version is detected
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Strategy: Cache First for static assets, Network First for API
// IMPORTANT: Do NOT cache navigation requests (HTML pages) to avoid flashing/reload loops
self.addEventListener('install', (event) => {
  // Don't use cache.addAll() - it can fail if any resource is unavailable
  // Just skip waiting and let the activate handler clean up
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all pages immediately so the new SW is active
  // This is safe now because we don't intercept navigation requests
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Do NOT intercept navigation requests (HTML pages) - let them load from network
  // This prevents flashing/reload loops when the SW takes control
  if (request.mode === 'navigate') return;

  // Do NOT intercept API calls - let them go to network normally
  if (url.pathname.startsWith('/api/')) return;

  // Only cache static assets (CSS, JS, images, fonts, icons)
  const isStaticAsset = /\.(css|js|json|ico|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|eot)$/i.test(url.pathname);
  if (!isStaticAsset) return;

  // Static assets - Cache First
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      return cachedResponse || fetch(request).then((response) => {
        // Only cache successful responses
        if (response.ok) {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clonedResponse);
          });
        }
        return response;
      });
    })
  );
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
