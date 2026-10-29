// =============================================================================
// Service Worker - Estok PWA
// Estrategia: Stale-While-Revalidate (Network First con fallback a caché)
// - Siempre intenta obtener la versión más reciente de la red
// - Si la red falla, sirve desde la caché
// - En segundo plano, actualiza la caché con la respuesta de la red
// - El nuevo SW queda en "waiting" hasta que el usuario acepte actualizar
// - Al hacer clic en "Actualizar ahora", el SW toma control y recarga
// =============================================================================

// =============================================================================
// CACHE VERSION - Incrementar CADA VEZ que se haga un deploy con cambios
// en el frontend. Esto fuerza al browser a detectar un nuevo Service Worker
// y descargar los assets frescos desde la red.
// =============================================================================
const CACHE_VERSION = 16;
const CACHE_NAME = 'estok-cache-v' + CACHE_VERSION;

// =============================================================================
// ASSETS DE INTERFAZ (imágenes de botones e iconos)
// =============================================================================
// Espejo EXACTO de frontend/src/lib/assetsUi.ts: si agregás o renombrás un
// asset de interfaz, actualizá los DOS archivos y subí CACHE_VERSION.
// Son WebP ya redimensionados al tamaño real de renderizado (lado mayor 128 px,
// salvo el fondo de la cómoda del login a 768 px de ancho), así que pesan entre
// 1 y 17 KB en vez de los 175 KB a 3,4 MB de los PNG/JPG originales.
// =============================================================================
const UI_ASSETS = [
  '/nuevo-objeto.webp',
  '/nueva-categoria.webp',
  '/mudanza.webp',
  '/contenedor-grande.webp',
  '/nuevo-contenedor.webp',
  '/mueble.webp',
  '/fluffy-objeto.webp',
  '/nueva-ubicacion.webp',
  '/login-comoda.webp',
];

const STATIC_ASSETS = [
  '/',
  '/favicon.ico',
  '/favicon.png',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-192x192-maskable.png',
  '/icons/icon-512x512-maskable.png',
  '/icons/apple-touch-icon.png',
].concat(UI_ASSETS);

// Assets de interfaz servidos CACHE-FIRST: son pequeños, inmutables por nombre
// y se piden en CADA recarga (botones, lienzos y placeholders). Servirlos desde
// caché deja la recarga instantánea y sin parpadeo de imágenes.
const UI_ASSET_SET = new Set(UI_ASSETS);

// =============================================================================
// INSTALL - Precargar assets críticos
// =============================================================================
// IMPORTANTE: NO llamar a self.skipWaiting() aquí. El nuevo SW debe quedar
// en estado "waiting" para que el frontend pueda mostrar el banner de
// "Nueva versión disponible" y darle al usuario la opción de actualizar.
// Si skipWaiting() se llama en install, el SW se activa inmediatamente,
// el controllerchange se dispara y la página se recarga sin que el usuario
// vea el banner.
// =============================================================================
self.addEventListener('install', (event) => {
  // Precargar assets críticos en la caché para que estén disponibles offline.
  // Se cachea UNO POR UNO (cache.add) en vez de cache.addAll: addAll aborta la
  // precarga COMPLETA si un solo asset falla, dejando sin caché a los demás.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url))).then((resultados) => {
        const fallidos = resultados.filter((r) => r.status === 'rejected').length;
        if (fallidos > 0) {
          console.warn('[SW] No se pudieron precargar', fallidos, 'de', STATIC_ASSETS.length, 'assets estáticos.');
        }
      })
    )
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
  // ASSETS DE INTERFAZ (imágenes de botones e iconos) - CACHE FIRST
  // =====================================================================
  // Ya vienen precacheados en install y su nombre es inmutable, así que ir a
  // la red en cada recarga sólo agrega latencia y parpadeo. Si no están en
  // caché (primera visita tras el deploy), se bajan y se guardan.
  if (UI_ASSET_SET.has(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then((response) => {
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
    return;
  }

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
// - SKIP_WAITING: el usuario hizo clic en "Actualizar ahora" en el banner.
//   El SW salta del estado "waiting" a "activating", toma control y
//   dispara controllerchange, que recarga la página.
// - SW_UPDATED: el frontend puede reaccionar si lo desea
// =============================================================================
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
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
