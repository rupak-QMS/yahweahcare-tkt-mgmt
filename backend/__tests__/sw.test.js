/**
 * Unit tests — frontend/sw.js (Service Worker)
 *
 * Covers:
 *  1. push event  — shows notification with correct title/body/icon
 *  2. push event  — falls back to defaults when payload is missing/malformed
 *  3. notificationclick — calls postMessage + focus (NOT navigate) when app is open
 *  4. notificationclick — extracts hash correctly from various URL formats
 *  5. notificationclick — opens new window when no client is open
 *  6. notificationclick — does NOT call client.navigate() (the blank-screen bug)
 *  7. Full button flow  — /push/test → webpush.sendNotification → SW shows notification
 */

const path = require('path');
const fs   = require('fs');

// ── Load sw.js into a fake service-worker global ────────────
function loadSW() {
  // Build a minimal SW global that captures addEventListener calls
  const listeners = {};
  const mockClients = { matchAll: jest.fn(), openWindow: jest.fn() };
  const mockRegistration = { showNotification: jest.fn() };

  const swGlobal = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: jest.fn(),
    clients: mockClients,
    registration: mockRegistration,
    caches: {
      keys:   jest.fn().mockResolvedValue([]),
      open:   jest.fn().mockResolvedValue({ match: jest.fn().mockResolvedValue(null), put: jest.fn() }),
      delete: jest.fn(),
    },
  };

  // Execute sw.js in the fake global scope
  const swCode = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/sw.js'), 'utf8'
  );
  // Replace `self.` references so they use our swGlobal
  const fn = new Function(
    'self', 'caches', 'fetch',
    swCode.replace(/\bself\b/g, 'self')
  );
  fn(swGlobal, swGlobal.caches, jest.fn());

  return { listeners, mockClients, mockRegistration };
}

// ── Helper: make a fake ExtendableEvent ─────────────────────
function makeEvent(type, extra = {}) {
  const waited = [];
  return {
    type,
    waitUntil: jest.fn(p => waited.push(p)),
    _waited: waited,
    ...extra,
  };
}

// ════════════════════════════════════════════════════════════
// push event
// ════════════════════════════════════════════════════════════
describe('Service Worker — push event', () => {
  test('shows notification with payload title, body and icon', async () => {
    const { listeners, mockRegistration } = loadSW();
    const payload = { title: 'New ticket', body: 'YAH-000042 created', icon: '/logo.svg', data: { url: '/#tickets' } };
    const event = makeEvent('push', {
      data: { json: () => payload },
    });

    listeners['push'](event);
    await Promise.all(event._waited);

    expect(mockRegistration.showNotification).toHaveBeenCalledWith(
      'New ticket',
      expect.objectContaining({
        body:  'YAH-000042 created',
        icon:  '/logo.svg',
        tag:   'yc-notification',
        data:  { url: '/#tickets' },
      })
    );
  });

  test('uses default title and body when push has no data', async () => {
    const { listeners, mockRegistration } = loadSW();
    const event = makeEvent('push', { data: null });

    listeners['push'](event);
    await Promise.all(event._waited);

    expect(mockRegistration.showNotification).toHaveBeenCalledWith(
      'Yahwehcare',
      expect.objectContaining({ body: 'You have a new notification.' })
    );
  });

  test('uses default icon when payload omits icon', async () => {
    const { listeners, mockRegistration } = loadSW();
    const event = makeEvent('push', {
      data: { json: () => ({ title: 'Hi', body: 'Hello' }) },
    });

    listeners['push'](event);
    await Promise.all(event._waited);

    expect(mockRegistration.showNotification).toHaveBeenCalledWith(
      'Hi',
      expect.objectContaining({ icon: '/favicon.svg' })
    );
  });

  test('falls back to defaults when payload JSON is malformed', async () => {
    const { listeners, mockRegistration } = loadSW();
    const event = makeEvent('push', {
      data: { json: () => { throw new SyntaxError('bad json'); } },
    });

    listeners['push'](event);
    await Promise.all(event._waited);

    // Should not throw — should show default notification
    expect(mockRegistration.showNotification).toHaveBeenCalledWith(
      'Yahwehcare',
      expect.objectContaining({ body: 'You have a new notification.' })
    );
  });
});

// ════════════════════════════════════════════════════════════
// notificationclick event
// ════════════════════════════════════════════════════════════
describe('Service Worker — notificationclick event', () => {
  function makeClickEvent(url) {
    return makeEvent('notificationclick', {
      notification: {
        close: jest.fn(),
        data: { url },
      },
    });
  }

  function makeClient(opts = {}) {
    return {
      focus:       jest.fn().mockResolvedValue(undefined),
      postMessage: jest.fn(),
      navigate:    jest.fn(), // should NOT be called
      ...opts,
    };
  }

  // ── Core fix: no page refresh ────────────────────────────
  test('calls postMessage + focus — NOT navigate — when app window is open', async () => {
    const { listeners, mockClients } = loadSW();
    const client = makeClient();
    mockClients.matchAll.mockResolvedValue([client]);

    const event = makeClickEvent('/#tickets');
    listeners['notificationclick'](event);
    await Promise.all(event._waited);

    expect(client.postMessage).toHaveBeenCalledWith({ type: 'SW_NAVIGATE', hash: '#tickets' });
    expect(client.focus).toHaveBeenCalled();
    expect(client.navigate).not.toHaveBeenCalled(); // ← the blank-screen bug
  });

  test('extracts hash correctly from /#tickets URL', async () => {
    const { listeners, mockClients } = loadSW();
    const client = makeClient();
    mockClients.matchAll.mockResolvedValue([client]);

    const event = makeClickEvent('/#tickets');
    listeners['notificationclick'](event);
    await Promise.all(event._waited);

    expect(client.postMessage).toHaveBeenCalledWith({ type: 'SW_NAVIGATE', hash: '#tickets' });
  });

  test('extracts hash correctly from /#dashboard URL', async () => {
    const { listeners, mockClients } = loadSW();
    const client = makeClient();
    mockClients.matchAll.mockResolvedValue([client]);

    const event = makeClickEvent('/#dashboard');
    listeners['notificationclick'](event);
    await Promise.all(event._waited);

    expect(client.postMessage).toHaveBeenCalledWith({ type: 'SW_NAVIGATE', hash: '#dashboard' });
  });

  test('uses #dashboard when notification data has no URL', async () => {
    const { listeners, mockClients } = loadSW();
    const client = makeClient();
    mockClients.matchAll.mockResolvedValue([client]);

    const event = makeEvent('notificationclick', {
      notification: { close: jest.fn(), data: {} },
    });
    listeners['notificationclick'](event);
    await Promise.all(event._waited);

    expect(client.postMessage).toHaveBeenCalledWith({ type: 'SW_NAVIGATE', hash: '#dashboard' });
    expect(client.focus).toHaveBeenCalled();
  });

  test('closes the notification', async () => {
    const { listeners, mockClients } = loadSW();
    const client = makeClient();
    mockClients.matchAll.mockResolvedValue([client]);

    const event = makeClickEvent('/#tickets');
    listeners['notificationclick'](event);
    await Promise.all(event._waited);

    expect(event.notification.close).toHaveBeenCalled();
  });

  test('opens new window when no existing client is found', async () => {
    const { listeners, mockClients } = loadSW();
    mockClients.matchAll.mockResolvedValue([]); // no open windows
    mockClients.openWindow = jest.fn().mockResolvedValue(undefined);

    const event = makeClickEvent('/#tickets');
    listeners['notificationclick'](event);
    await Promise.all(event._waited);

    expect(mockClients.openWindow).toHaveBeenCalledWith('/#tickets');
  });

  test('does not call postMessage when there is no hash in the URL', async () => {
    const { listeners, mockClients } = loadSW();
    const client = makeClient();
    mockClients.matchAll.mockResolvedValue([client]);

    // Notification with a plain URL (no hash)
    const event = makeEvent('notificationclick', {
      notification: { close: jest.fn(), data: { url: 'https://app.example.com' } },
    });
    listeners['notificationclick'](event);
    await Promise.all(event._waited);

    expect(client.postMessage).not.toHaveBeenCalled();
    expect(client.focus).toHaveBeenCalled(); // still focuses the window
  });
});

// ════════════════════════════════════════════════════════════
// Full push test button flow (backend → webpush → SW shows notification)
// ════════════════════════════════════════════════════════════
describe('Push test button — full flow', () => {
  jest.mock('web-push', () => ({
    setVapidDetails:  jest.fn(),
    sendNotification: jest.fn(),
  }));

  const webpush = require('web-push');

  function makePool(rows) {
    return {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })    // CREATE TABLE
        .mockResolvedValueOnce({ rows }),        // SELECT subscriptions
      on: jest.fn(),
    };
  }

  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY  = 'BTestPublicKey123';
    process.env.VAPID_PRIVATE_KEY = 'TestPrivateKey456';
    process.env.VAPID_SUBJECT     = 'mailto:test@test.com';
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  test('button calls /push/test → sends notification with correct payload structure', async () => {
    const express = require('express');
    const request = require('supertest');
    const pushModule = require('../push-routes.js');

    const sub = { endpoint: 'https://push.example.com/sub', p256dh: 'pk', auth: 'ak' };
    const pool = makePool([sub]);
    webpush.sendNotification.mockResolvedValue({ statusCode: 201 });

    const auth = (req, _res, next) => { req.user = { id: 1 }; next(); };
    const router = pushModule(pool, auth);
    const app = express();
    app.use(express.json());
    app.use('/api', router);

    const res = await request(app).post('/api/push/test');

    // Button response
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sent).toBe(1);
    expect(res.body.failed).toBe(0);

    // Notification payload sent to the browser
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    const [subscription, rawPayload] = webpush.sendNotification.mock.calls[0];

    // Subscription object
    expect(subscription).toEqual({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    });

    // Payload is valid JSON
    const payload = JSON.parse(rawPayload);
    expect(payload).toMatchObject({
      title: expect.stringContaining('Test Notification'),
      body:  expect.stringContaining('working'),
      icon:  '/favicon.svg',
      data:  { url: '/' },
    });
  });

  test('button returns 404 and does not call webpush when user has no subscription', async () => {
    const express = require('express');
    const request = require('supertest');

    jest.resetModules();
    jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));
    const wp = require('web-push');
    const pushModule = require('../push-routes.js');

    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })   // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }),   // SELECT → empty
      on: jest.fn(),
    };
    const auth = (req, _res, next) => { req.user = { id: 99 }; next(); };
    const router = pushModule(pool, auth);
    const app = express();
    app.use(express.json());
    app.use('/api', router);

    const res = await request(app).post('/api/push/test');

    expect(res.status).toBe(404);
    expect(wp.sendNotification).not.toHaveBeenCalled();
  });

  test('button returns 503 and does not call webpush when VAPID keys are missing', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const express = require('express');
    const request = require('supertest');

    jest.resetModules();
    jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));
    const wp = require('web-push');
    const pushModule = require('../push-routes.js');

    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }), on: jest.fn() };
    const auth = (req, _res, next) => { req.user = { id: 1 }; next(); };
    const router = pushModule(pool, auth);
    const app = express();
    app.use(express.json());
    app.use('/api', router);

    const res = await request(app).post('/api/push/test');

    expect(res.status).toBe(503);
    expect(wp.sendNotification).not.toHaveBeenCalled();
  });
});
