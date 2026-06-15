// Yahwehcare Service Worker — CDN asset caching
const CDN_CACHE = 'yc-cdn-v2';

// CDN scripts that are safe to cache indefinitely (versioned URLs, immutable content)
const CDN_ORIGINS = [
  'https://unpkg.com',
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://cdn.tailwindcss.com',
];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CDN_CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim())
));

// ── CDN cache-first strategy ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const isCDN = CDN_ORIGINS.some(o => url.startsWith(o));
  if (!isCDN) return;

  event.respondWith(
    caches.open(CDN_CACHE).then(cache =>
      cache.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        });
      })
    )
  );
});
