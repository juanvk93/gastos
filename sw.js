/**
 * sw.js — Service Worker mínimo
 *
 * Estrategia:
 *   - Pre-cache del shell (HTML/CSS/JS propios) en install.
 *   - Para peticiones same-origin: cache-first con actualización en background.
 *   - Para CDN (Chart.js, fonts): stale-while-revalidate.
 *   - Fallback a la app shell si la red falla.
 */

const CACHE_VERSION = 'gastos-v1.16';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/utils.js',
  './js/db.js',
  './js/icons.js',
  './js/chart.js',
  './js/app.js',
  './js/workers/reports-worker.js',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // Cache-first con revalidación en background
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
          }
          return resp;
        }).catch(() => cached || caches.match('./index.html'));
        return cached || fetchPromise;
      })
    );
  } else {
    // Stale-while-revalidate para CDN
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const fetchPromise = fetch(req).then((resp) => {
            if (resp && resp.ok) cache.put(req, resp.clone());
            return resp;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
  }
});
