// ============================================================
// Tests for /push routes
// Covers:
//   GET  /push/vapid-public-key  — 503 when unconfigured, 200 with key
//   POST /push/subscribe         — 401 unauth, 400 missing fields, 200 upsert
//   POST /push/test              — 401 unauth, in-app insert, pushSent counts,
//                                  VAPID-enabled/disabled paths, icon path
//   POST /push/unsubscribe       — 401 unauth, 400 missing endpoint, 200 delete
// ============================================================

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

const mockPool = pool as any;

// ── Mock web-push ────────────────────────────────────────────────────────────
// Supports both static import (webpush.sendNotification) used by notifications.service.ts
// and dynamic import (webpush.default.sendNotification) used by push.routes.ts
const mockSendNotification = jest.fn();
const mockSetVapidDetails  = jest.fn();
jest.mock('web-push', () => {
  const m = {
    setVapidDetails:  mockSetVapidDetails,
    sendNotification: mockSendNotification,
  };
  return { ...m, default: m };
});

// ── App factories ─────────────────────────────────────────────────────────────
function makeApp(userId = 5, email = 'user@yahwehcare.com.au') {
  const app = express();
  app.use(express.json());
  // Inject req.auth so requireAuth middleware passes without token validation
  app.use((req: any, _res, next) => {
    req.auth = {
      userId, email,
      role: 'staff', positionType: 'staff', sessionId: 1,
      isAdmin: false, bootstrapAdmin: false, permissions: [],
    };
    next();
  });
  const router = require('../modules/notifications/push.routes').default;
  app.use('/push', router);
  return app;
}

/** App with NO injected auth — used to test 401 responses */
function makeUnauthApp() {
  const app = express();
  app.use(express.json());
  const router = require('../modules/notifications/push.routes').default;
  app.use('/push', router);
  return app;
}

// ── Pre-warm ensurePushTable so migrationDone=true for all tests ─────────────
// Without this, the first route that calls ensurePushTable() would consume 3
// mock queries that the individual test hasn't provisioned.
beforeAll(async () => {
  for (let i = 0; i < 3; i++) {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
  }
  const { ensurePushTable } = require('../modules/notifications/notifications.service');
  await ensurePushTable();
});

// ── GET /push/vapid-public-key ────────────────────────────────────────────────

describe('GET /push/vapid-public-key', () => {
  it('returns 503 with push_not_configured when env var is absent', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const res = await request(makeApp()).get('/push/vapid-public-key');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('push_not_configured');
  });

  it('returns 200 with publicKey when VAPID_PUBLIC_KEY is set', async () => {
    process.env.VAPID_PUBLIC_KEY = 'BFAKE_VAPID_PUBLIC_KEY_FOR_TEST';
    const res = await request(makeApp()).get('/push/vapid-public-key');
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe('BFAKE_VAPID_PUBLIC_KEY_FOR_TEST');
    delete process.env.VAPID_PUBLIC_KEY;
  });

  it('this endpoint is public — no auth required', async () => {
    process.env.VAPID_PUBLIC_KEY = 'BFAKE_KEY';
    const res = await request(makeUnauthApp()).get('/push/vapid-public-key');
    // Should NOT return 401 — this endpoint is before requireAuth
    expect(res.status).not.toBe(401);
    delete process.env.VAPID_PUBLIC_KEY;
  });
});

// ── POST /push/subscribe ──────────────────────────────────────────────────────

describe('POST /push/subscribe', () => {
  it('returns 401 when request is unauthenticated', async () => {
    const res = await request(makeUnauthApp()).post('/push/subscribe').send({
      endpoint: 'https://fcm.googleapis.com/sub/1',
      keys: { p256dh: 'key', auth: 'authval' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 with invalid_subscription when endpoint is missing', async () => {
    const res = await request(makeApp()).post('/push/subscribe').send({
      keys: { p256dh: 'key', auth: 'authval' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_subscription');
  });

  it('returns 400 with invalid_subscription when keys.p256dh is missing', async () => {
    const res = await request(makeApp()).post('/push/subscribe').send({
      endpoint: 'https://fcm.googleapis.com/sub/1',
      keys: { auth: 'authval' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_subscription');
  });

  it('returns 400 with invalid_subscription when keys.auth is missing', async () => {
    const res = await request(makeApp()).post('/push/subscribe').send({
      endpoint: 'https://fcm.googleapis.com/sub/1',
      keys: { p256dh: 'p256dhval' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_subscription');
  });

  it('returns 400 when body is completely empty', async () => {
    const res = await request(makeApp()).post('/push/subscribe').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_subscription');
  });

  it('returns 200 and executes UPSERT with correct parameters', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(makeApp(7)).post('/push/subscribe').send({
      endpoint: 'https://fcm.googleapis.com/sub/abc',
      keys: { p256dh: 'p256dh_value', auth: 'auth_value' },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Verify ON CONFLICT UPSERT was called with the right values
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT');
    expect(params).toEqual([7, 'https://fcm.googleapis.com/sub/abc', 'p256dh_value', 'auth_value']);
  });

  it('returns 200 when overwriting an existing subscription (upsert path)', async () => {
    // Same endpoint submitted twice — second call still returns 200
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(makeApp(7)).post('/push/subscribe').send({
      endpoint: 'https://fcm.googleapis.com/sub/abc',
      keys: { p256dh: 'new_p256dh', auth: 'new_auth' },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── POST /push/test ───────────────────────────────────────────────────────────

describe('POST /push/test', () => {
  it('returns 401 when request is unauthenticated', async () => {
    const res = await request(makeUnauthApp()).post('/push/test');
    expect(res.status).toBe(401);
  });

  it('returns 200 with ok and inAppInserted:true when user has no subscriptions', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT notification
      .mockResolvedValueOnce({ rows: [] });               // SELECT subscriptions → empty
    const res = await request(makeApp(5, 'user@yahwehcare.com.au')).post('/push/test');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.inAppInserted).toBe(true);
    expect(res.body.pushSent).toBe(0);
  });

  it('returns a subject matching one of the 5 demo templates', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).post('/push/test');
    const validSubjects = [
      'New Ticket Created',
      'Ticket Escalated ⬆️',
      'Ticket Resolved ✅',
      'Status Updated',
      'New Team Member 👤',
    ];
    expect(validSubjects).toContain(res.body.subject);
    expect(typeof res.body.body).toBe('string');
    expect(res.body.body.length).toBeGreaterThan(0);
  });

  it('inserts in-app notification with channel=push for the current user', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });
    await request(makeApp(9, 'test@yahwehcare.com.au')).post('/push/test');
    const insertCall = mockPool.query.mock.calls[0];
    const [sql, params] = insertCall;
    expect(sql).toContain("'push'");
    // params[0]=userId, params[1]=email
    expect(params[0]).toBe(9);
    expect(params[1]).toBe('test@yahwehcare.com.au');
  });

  it('does not call sendNotification when VAPID keys are absent (even with subscription)', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [
        { endpoint: 'https://fcm.googleapis.com/sub/1', p256dh: 'k', auth: 'a' },
      ] });
    const res = await request(makeApp()).post('/push/test');
    expect(res.status).toBe(200);
    expect(res.body.pushSent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('calls sendNotification once and returns pushSent:1 when VAPID keys are set', async () => {
    process.env.VAPID_PUBLIC_KEY  = 'BFAKE_PUBLIC';
    process.env.VAPID_PRIVATE_KEY = 'fake_private';
    mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [
        { endpoint: 'https://fcm.googleapis.com/sub/1', p256dh: 'p256dh_val', auth: 'auth_val' },
      ] });
    const res = await request(makeApp()).post('/push/test');
    expect(res.status).toBe(200);
    expect(res.body.pushSent).toBe(1);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it('sends push to every subscription and returns correct pushSent count', async () => {
    process.env.VAPID_PUBLIC_KEY  = 'BFAKE_PUBLIC';
    process.env.VAPID_PRIVATE_KEY = 'fake_private';
    mockSendNotification
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockResolvedValueOnce({ statusCode: 201 });
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [
        { endpoint: 'https://fcm.googleapis.com/sub/1', p256dh: 'k1', auth: 'a1' },
        { endpoint: 'https://fcm.googleapis.com/sub/2', p256dh: 'k2', auth: 'a2' },
        { endpoint: 'https://fcm.googleapis.com/sub/3', p256dh: 'k3', auth: 'a3' },
      ] });
    const res = await request(makeApp()).post('/push/test');
    expect(res.status).toBe(200);
    expect(res.body.pushSent).toBe(3);
    expect(mockSendNotification).toHaveBeenCalledTimes(3);
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it('uses /favicon.svg (not .ico) in the push payload icon and badge', async () => {
    process.env.VAPID_PUBLIC_KEY  = 'BFAKE_PUBLIC';
    process.env.VAPID_PRIVATE_KEY = 'fake_private';
    mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [
        { endpoint: 'https://fcm.googleapis.com/sub/1', p256dh: 'k', auth: 'a' },
      ] });
    await request(makeApp()).post('/push/test');
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.icon).toBe('/favicon.svg');
    expect(payload.badge).toBe('/favicon.svg');
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it('calls setVapidDetails with correct subject, public and private keys', async () => {
    process.env.VAPID_PUBLIC_KEY  = 'BFAKE_PUBLIC';
    process.env.VAPID_PRIVATE_KEY = 'fake_private';
    process.env.VAPID_SUBJECT     = 'mailto:custom@example.com';
    mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [
        { endpoint: 'https://fcm.googleapis.com/sub/1', p256dh: 'k', auth: 'a' },
      ] });
    await request(makeApp()).post('/push/test');
    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      'mailto:custom@example.com',
      'BFAKE_PUBLIC',
      'fake_private',
    );
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  it('uses default VAPID subject when VAPID_SUBJECT env var is not set', async () => {
    process.env.VAPID_PUBLIC_KEY  = 'BFAKE_PUBLIC';
    process.env.VAPID_PRIVATE_KEY = 'fake_private';
    delete process.env.VAPID_SUBJECT;
    mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [
        { endpoint: 'https://fcm.googleapis.com/sub/1', p256dh: 'k', auth: 'a' },
      ] });
    await request(makeApp()).post('/push/test');
    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      'mailto:admin@yahwehcare.com.au',
      expect.any(String),
      expect.any(String),
    );
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it('skips failed sendNotification and does not count it in pushSent', async () => {
    process.env.VAPID_PUBLIC_KEY  = 'BFAKE_PUBLIC';
    process.env.VAPID_PRIVATE_KEY = 'fake_private';
    mockSendNotification
      .mockResolvedValueOnce({ statusCode: 201 })   // first sub succeeds
      .mockRejectedValueOnce({ statusCode: 400 });   // second sub fails
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [
        { endpoint: 'https://fcm.googleapis.com/sub/1', p256dh: 'k1', auth: 'a1' },
        { endpoint: 'https://fcm.googleapis.com/sub/2', p256dh: 'k2', auth: 'a2' },
      ] });
    const res = await request(makeApp()).post('/push/test');
    expect(res.status).toBe(200);
    expect(res.body.pushSent).toBe(1);
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });
});

// ── POST /push/unsubscribe ────────────────────────────────────────────────────

describe('POST /push/unsubscribe', () => {
  it('returns 401 when request is unauthenticated', async () => {
    const res = await request(makeUnauthApp()).post('/push/unsubscribe').send({
      endpoint: 'https://fcm.googleapis.com/sub/1',
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 with missing_endpoint when endpoint is absent', async () => {
    const res = await request(makeApp()).post('/push/unsubscribe').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_endpoint');
  });

  it('returns 400 with missing_endpoint when body is empty', async () => {
    const res = await request(makeApp()).post('/push/unsubscribe');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_endpoint');
  });

  it('returns 200 and executes DELETE with correct userId and endpoint', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(makeApp(5)).post('/push/unsubscribe').send({
      endpoint: 'https://fcm.googleapis.com/sub/1',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('DELETE');
    expect(sql).toContain('push_subscriptions');
    expect(params).toEqual([5, 'https://fcm.googleapis.com/sub/1']);
  });

  it('returns 200 even when the subscription did not exist (rowCount 0)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(makeApp()).post('/push/unsubscribe').send({
      endpoint: 'https://fcm.googleapis.com/sub/nonexistent',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
