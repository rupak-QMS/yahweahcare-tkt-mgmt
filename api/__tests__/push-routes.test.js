/**
 * Unit tests — push-routes.js
 */

jest.mock('web-push', () => ({
  setVapidDetails:  jest.fn(),
  sendNotification: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

// Acquire the mock reference ONCE — do not call jest.resetModules() in afterEach
// (that would create a new module instance that the top-level require can't see)
const webpush = require('web-push');

// ── Helpers ──────────────────────────────────────────────────
function makePool(overrides = {}) {
  return { query: jest.fn().mockResolvedValue({ rows: [] }), on: jest.fn(), ...overrides };
}

function makeAuth(user = { id: 42, email: 'user@test.com', name: 'Test User' }) {
  return (req, _res, next) => { req.user = user; next(); };
}

function buildApp(pool, { noVapid = false } = {}) {
  process.env.VAPID_PUBLIC_KEY  = noVapid ? '' : 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = noVapid ? '' : 'test-private-key';
  process.env.VAPID_SUBJECT     = 'mailto:test@test.com';
  // Re-use same module instance (no resetModules) — mock stays intact
  const pushModule = require('../push-routes.js');
  const router = pushModule(pool, makeAuth());
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return app;
}

afterEach(() => {
  jest.clearAllMocks();
  // Clear env but do NOT call jest.resetModules() — breaks the module-level mock reference
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

// ════════════════════════════════════════════════════════════
// GET /api/push/vapid-public-key
// ════════════════════════════════════════════════════════════
describe('GET /api/push/vapid-public-key', () => {
  test('returns 503 when VAPID keys not configured', async () => {
    const app = buildApp(makePool(), { noVapid: true });
    const res = await request(app).get('/api/push/vapid-public-key');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  test('returns publicKey when VAPID keys are set', async () => {
    const app = buildApp(makePool());
    const res = await request(app).get('/api/push/vapid-public-key');
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe('test-public-key');
  });
});

// ════════════════════════════════════════════════════════════
// POST /api/push/subscribe
// ════════════════════════════════════════════════════════════
describe('POST /api/push/subscribe', () => {
  test('returns 400 for missing endpoint', async () => {
    const app = buildApp(makePool());
    const res = await request(app).post('/api/push/subscribe').send({ keys: { p256dh: 'a', auth: 'b' } });
    expect(res.status).toBe(400);
  });

  test('returns 400 for missing keys', async () => {
    const app = buildApp(makePool());
    const res = await request(app).post('/api/push/subscribe').send({ endpoint: 'https://push.example.com/xyz' });
    expect(res.status).toBe(400);
  });

  test('upserts subscription and returns ok:true', async () => {
    const pool = makePool();
    const app  = buildApp(pool);

    const res = await request(app).post('/api/push/subscribe').send({
      endpoint: 'https://push.example.com/xyz',
      keys: { p256dh: 'key1', auth: 'auth1' },
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const upsertCall = pool.query.mock.calls.find(
      ([q]) => q.includes('INSERT INTO') && q.includes('push_subscriptions')
    );
    expect(upsertCall).toBeTruthy();
    const [sql, params] = upsertCall;
    expect(sql).toMatch(/ON CONFLICT/);
    expect(params).toContain(42);
    expect(params).toContain('https://push.example.com/xyz');
    expect(params).toContain('key1');
    expect(params).toContain('auth1');
  });

  test('returns 503 when VAPID not configured', async () => {
    const app = buildApp(makePool(), { noVapid: true });
    const res = await request(app).post('/api/push/subscribe').send({
      endpoint: 'https://push.example.com/xyz',
      keys: { p256dh: 'key1', auth: 'auth1' },
    });
    expect(res.status).toBe(503);
  });
});

// ════════════════════════════════════════════════════════════
// POST /api/push/test
// ════════════════════════════════════════════════════════════
describe('POST /api/push/test', () => {
  test('returns 404 when user has no subscriptions', async () => {
    const pool = makePool({
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })  // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }), // SELECT → empty
    });
    const app = buildApp(pool);
    const res = await request(app).post('/api/push/test');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no push subscription/i);
  });

  test('sends push and returns sent:1 failed:0', async () => {
    const sub = { endpoint: 'https://push.example.com/sub', p256dh: 'pk', auth: 'ak' };
    const pool = makePool({
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [sub] }),
    });
    webpush.sendNotification.mockResolvedValue({ statusCode: 201 });

    const app = buildApp(pool);
    const res = await request(app).post('/api/push/test');

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      expect.stringContaining('Test Notification')
    );
  });

  test('deletes expired (410) subscription and counts it as failed', async () => {
    const sub = { endpoint: 'https://push.example.com/expired', p256dh: 'pk', auth: 'ak' };
    const pool = makePool({
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [sub] })
        .mockResolvedValueOnce({ rows: [] }),  // DELETE
    });
    const err410 = Object.assign(new Error('Gone'), { statusCode: 410 });
    webpush.sendNotification.mockRejectedValue(err410);

    const app = buildApp(pool);
    const res = await request(app).post('/api/push/test');

    expect(res.status).toBe(200);
    expect(res.body.failed).toBe(1);
    const del = pool.query.mock.calls.find(
      ([q]) => q.includes('DELETE') && q.includes('push_subscriptions')
    );
    expect(del).toBeTruthy();
  });

  test('returns 503 when VAPID not configured', async () => {
    const app = buildApp(makePool(), { noVapid: true });
    const res = await request(app).post('/api/push/test');
    expect(res.status).toBe(503);
  });
});

// ════════════════════════════════════════════════════════════
// sendPushToUser helper
// ════════════════════════════════════════════════════════════
describe('sendPushToUser helper', () => {
  test('sends a push to every subscription the user has', async () => {
    process.env.VAPID_PUBLIC_KEY  = 'vpk';
    process.env.VAPID_PRIVATE_KEY = 'vsk';
    webpush.sendNotification.mockResolvedValue({});

    const { sendPushToUser } = require('../push-routes.js');
    const pool = makePool({
      query: jest.fn().mockResolvedValue({
        rows: [
          { endpoint: 'https://push.example.com/1', p256dh: 'k1', auth: 'a1' },
          { endpoint: 'https://push.example.com/2', p256dh: 'k2', auth: 'a2' },
        ],
      }),
    });

    await sendPushToUser(pool, 99, { title: 'Hello', body: 'World' });

    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    expect(webpush.sendNotification.mock.calls[0][1]).toContain('Hello');
  });

  test('does nothing when VAPID_PUBLIC_KEY is absent', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const { sendPushToUser } = require('../push-routes.js');
    const pool = makePool();

    await sendPushToUser(pool, 99, { title: 'Hello' });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
