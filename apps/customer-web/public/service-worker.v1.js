const CACHE_NAME = 'fetanagent-public-v1';
const PUBLIC_RESOURCES = [
  '/offline',
  '/assets/app.v1.css',
  '/assets/mark.v1.svg',
  '/assets/mark-192.v1.png',
  '/assets/mark-512.v1.png',
  '/assets/mark-maskable-192.v1.png',
  '/assets/mark-maskable-512.v1.png',
  '/assets/register-sw.v1.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_RESOURCES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    if (url.pathname === '/offline') {
      event.respondWith(caches.match('/offline').then((cached) => cached ?? fetch(request)));
    }
    return;
  }

  if (!PUBLIC_RESOURCES.includes(url.pathname)) return;
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});
