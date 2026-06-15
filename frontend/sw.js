// Yahwehcare Service Worker — CDN caching + push notifications
const CDN_CACHE = 'yc-cdn-v2';

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

// ── CDN cache-first ───────────────────────────────────────────────────────────
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

// ── Push notification received ────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'Yahweh Care', body: 'You have a new notification.', icon: '/favicon.svg', data: {} };
  try { data = Object.assign(data, event.data ? event.data.json() : {}); } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:     data.body,
      icon:     data.icon  || '/favicon.svg',
      badge:    data.badge || '/favicon.svg',
      tag:      'yc-notification',
      renotify: true,
      data:     data.data  || {},
    })
  );
});

// ── Notification click — focus app and navigate without reload ────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const d = event.notification.data || {};
  const targetHash = d.ticketId ? `#tickets` : '#dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'SW_NAVIGATE', hash: targetHash });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow('/' + targetHash);
    })
  );
});
