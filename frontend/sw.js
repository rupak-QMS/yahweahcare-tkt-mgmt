// Yahwehcare Service Worker — handles Web Push notifications
const CACHE = 'yc-sw-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Show push notification
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

// On notification click — focus or open the app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
