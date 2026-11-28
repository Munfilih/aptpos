/* aptPOS Progressive Web App Service Worker */
const CACHE_VERSION = 'aptpos-pwa-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// Read-only catalog/config endpoints safe to serve stale when store Wi-Fi briefly drops
const CACHEABLE_READ_API_PATHS = new Set([
  '/api/products',
  '/api/settings',
  '/api/customers',
  '/api/inventory-options',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith('aptpos-pwa-') &&
                key !== SHELL_CACHE &&
                key !== STATIC_CACHE &&
                key !== API_CACHE
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin HTTP(S) requests
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never intercept Server-Sent Events or Vite HMR endpoints
  if (
    url.pathname === '/api/events' ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/__vite') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return;
  }

  // API traffic: never cache writes; Network-First with offline cache fallback for safe read catalog routes
  if (url.pathname.startsWith('/api/')) {
    if (request.method !== 'GET') return;

    if (CACHEABLE_READ_API_PATHS.has(url.pathname)) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(API_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
          .catch(async () => {
            const cached = await caches.match(request);
            if (cached) return cached;
            return new Response(
              JSON.stringify({
                error: 'Offline — Primary Server is currently unreachable.',
                offline: true,
              }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
              }
            );
          })
      );
    }
    return;
  }

  // SPA navigation requests: Network-First so clients always receive the latest server UI,
  // falling back to cached app shell when Wi-Fi is momentarily down.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const cached = (await caches.match(request)) || (await caches.match('/index.html'));
          if (cached) return cached;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>aptPOS Offline</title><body style="font-family:system-ui;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px"><div style="max-width:420px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:24px;text-align:center"><h2 style="margin:0 0 8px">Primary Server Unreachable</h2><p style="color:#94a3b8;font-size:14px;line-height:1.5">Check your store Wi-Fi connection and make sure aptPOS is running on the Primary Server PC.</p><button onclick="location.reload()" style="margin-top:12px;background:#2563eb;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-weight:600;cursor:pointer">Retry Connection</button></div></body>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // Built static assets (/assets/*, /icons/*, fonts): Cache-First + background refresh
  if (
    request.method === 'GET' &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/icons/') ||
      url.pathname === '/manifest.webmanifest')
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              cache.put(request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })
    );
  }
});
