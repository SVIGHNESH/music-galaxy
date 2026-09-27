// Service worker template. The build (see vite.config.ts) replaces the two
// placeholders with this build's version and its exact file list.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `music-galaxy-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

// Drop caches from previous builds so old hashed assets don't pile up.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('music-galaxy-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Pages: network first so a new deploy shows up, cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html', { ignoreVary: true }).then((r) => r ?? Response.error())));
    return;
  }

  // Everything else is content-hashed or static: cache first. ignoreVary:
  // module scripts carry an Origin header, and servers answering with
  // `Vary: Origin` would otherwise make every precached file a miss offline.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
