// SLH TMS Service Worker - network-first strategy
// Does not cache authenticated API responses
const CACHE_NAME = 'slh-tms-v7';
const STATIC_ASSETS = ['/', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API calls or authentication.
  if (url.pathname.includes('/api/') || url.pathname.startsWith('/tms-api/') || url.hostname === 'login.microsoftonline.com' || url.hostname.endsWith('.login.microsoftonline.com')) {
    return;
  }

  // Always prefer the deployed application shell so a new release is visible immediately.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // JavaScript and CSS must be network-first. Cache-first here can leave an old
  // planner bundle active after a production deployment.
  if (request.destination === 'style' || request.destination === 'script') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Never cache a failed/missing bundle response. This matters on wallboard TVs
          // that can stay open across deployments and briefly request an expired hash.
          if (!response.ok) return response;
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Images can remain cache-first because they do not affect application logic.
  if (request.destination === 'image') {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
      )
    );
  }
});
