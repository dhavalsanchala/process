/* ProcDocs service worker
 * Strategy: network-first for the app shell (HTML/CSS/JS) so deploys are
 * picked up immediately when online; cache-first for static assets (icons,
 * fonts); cache-only fallback when offline.
 *
 * IMPORTANT: bump CACHE_VERSION on every deploy that changes shell files.
 * Format: procdocs-shell-YYYYMMDD-N
 */
const CACHE_VERSION = 'procdocs-shell-20260603-9';

// Shell files = the app code itself. These are network-first.
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js'
];

// Static files = rarely change. These are cache-first.
const STATIC_FILES = [
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

const PRECACHE = [...SHELL_FILES, ...STATIC_FILES];

/* INSTALL — precache the app */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()) // activate the new SW immediately
  );
});

/* ACTIVATE — clean up old caches and claim all open tabs */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell all open clients an update has been applied
        return self.clients.matchAll().then((clients) => {
          clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION }));
        });
      })
  );
});

/* FETCH — routing by request type */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Cross-origin (e.g. Google Fonts) — cache with network fallback
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Same-origin shell file (HTML/CSS/JS/manifest) — network-first
  const pathname = url.pathname.toLowerCase();
  const isShell =
    pathname.endsWith('.html') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.json') ||
    pathname.endsWith('/') ||
    pathname === '' ||
    event.request.mode === 'navigate';

  if (isShell) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Final fallback for navigations: return index.html
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        }))
    );
    return;
  }

  // Same-origin static (images, icons) — cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return res;
      });
    })
  );
});

/* Listen for messages from the page (e.g. "skip waiting" requests) */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
