// Yahwehcare Service Worker — CDN caching + app-shell caching + push notifications
const CDN_CACHE   = 'yc-cdn-v2';
const SHELL_CACHE = 'yc-shell-v1';

const CDN_ORIGINS = [
  'https://unpkg.com',
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://cdn.tailwindcss.com',
];

// App-shell assets — cached on install, served instantly on repeat visits
const SHELL_ASSETS = ['/', '/app.js', '/enterprise-components-compiled.js', '/favicon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CDN_CACHE && k !== SHELL_CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim())
));

// ── Fetch: cache-first for CDN and app-shell ─────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const isCDN   = CDN_ORIGINS.some(o => url.startsWith(o));
  const isShell = event.request.method === 'GET' && SHELL_ASSETS.some(a => {
    const origin = self.location.origin;
    return url === origin + a || (a === '/' && url === origin + '/');
  });

  if (isCDN) {
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
    return;
  }

  if (isShell) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          // Serve cached, update in background (stale-while-revalidate)
          const networkFetch = fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => {});
          return cached || networkFetch;
        })
      )
    );
  }
});

// ── Push notification received ────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'Yahwehcare', body: 'You have a new notification.', icon: '/favicon.svg', data: {} };
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

  // Extract hash from URL stored in notification data (e.g. '/#tickets' → '#tickets').
  // Fall back to '#dashboard' when data has no URL at all.
  // When the URL has no hash (e.g. a plain https:// link), targetHash is null — do not postMessage.
  const url = d.url || '';
  const hashIdx = url.indexOf('#');
  const targetHash = hashIdx !== -1 ? url.slice(hashIdx) : (url ? null : '#dashboard');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) {
          if (targetHash) client.postMessage({ type: 'SW_NAVIGATE', hash: targetHash });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url || '/');
    })
  );
});
