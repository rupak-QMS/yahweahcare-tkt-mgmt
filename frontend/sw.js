// Yahwehcare Service Worker — push notifications + CDN asset caching
// Bump CDN_CACHE version if CDN URLs change
const PUSH_CACHE = 'yc-push-v1';
const CDN_CACHE  = 'yc-cdn-v2';

// CDN scripts that are safe to cache indefinitely (versioned URLs, immutable content)
const CDN_ORIGINS = [
  'https://unpkg.com',
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://cdn.tailwindcss.com',
];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(
  // Clean up old caches on activate
  caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== PUSH_CACHE && k !== CDN_CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim())
));

// ── CDN cache-first strategy ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const isCDN = CDN_ORIGINS.some(o => url.startsWith(o));
  if (!isCDN) return; // let the browser handle everything else normally

  event.respondWith(
    caches.open(CDN_CACHE).then(cache =>
      cache.match(event.request).then(cached => {
        if (cached) return cached; // serve from cache instantly
        return fetch(event.request).then(response => {
          // Only cache successful responses
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        });
      })
    )
  );
});

// ── Push notification handler ─────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'Yahwehcare', body: 'You have a new notification.', icon: '/favicon.svg', data: {} };
  try { data = Object.assign(data, event.data ? event.data.json() : {}); } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon || '/favicon.svg',
      badge:   data.badge || '/favicon.svg',
      tag:     'yc-notification',
      renotify: true,
      data:    data.data || {},
    })
  );
});

// ── Notification click — navigate to the ticket or focus the app ─────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If app is already open, navigate the existing tab to the ticket URL
      for (const client of clientList) {
        if ('navigate' in client && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Otherwise open a new window at the ticket URL
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
