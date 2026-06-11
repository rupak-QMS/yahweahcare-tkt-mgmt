// ============================================================
// Tests for /notifications routes
// Covers: GET (list), PATCH /:id/read, POST /read-all,
//         POST / (create), POST /send-report-email (no RESEND key guard)
// ============================================================

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

const mockPool = pool as any;

function makeApp(userId = 7) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { userId, email: 'user@yahwehcare.com.au', role: 'staff', sessionId: 1, isAdmin: false, bootstrapAdmin: false, permissions: [] };
    next();
  });
  const router = require('../modules/notifications/notifications.routes').default;
  app.use('/notifications', router);
  return app;
}

// ── Module warm-up: run ensurePushTable() once so migrationDone=true ─────────
// After this beforeAll the module-level migrationDone flag stays true for the
// entire file; individual tests only need to mock their own query, not the 3
// CREATE TABLE / ALTER TABLE queries that ensurePushTable() fires.
beforeAll(async () => {
  for (let i = 0; i < 3; i++) {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
  }
  const { ensurePushTable } = require('../modules/notifications/notifications.service');
  await ensurePushTable();
});

const notifRows = [
  { id: 1, recipient_id: 7, subject: 'New ticket', body: 'Ticket created', status: 'pending', read_at: null, created_at: new Date().toISOString() },
  { id: 2, recipient_id: 7, subject: 'Ticket closed', body: 'Ticket closed', status: 'read',    read_at: new Date().toISOString(), created_at: new Date().toISOString() },
];

// ── GET /notifications ────────────────────────────────────────────────────────

describe('GET /notifications', () => {
  it('returns notifications for the current user', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: notifRows });
    const res = await request(app).get('/notifications');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.notifications)).toBe(true);
    expect(res.body.notifications).toHaveLength(2);
  });

  it('returns empty array when user has no notifications', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/notifications');
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(0);
  });
});

// ── PATCH /notifications/:id/read ─────────────────────────────────────────────

describe('PATCH /notifications/:id/read', () => {
  it('marks notification as read and returns ok: true', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app).patch('/notifications/1/read');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── POST /notifications/read-all ──────────────────────────────────────────────

describe('POST /notifications/read-all', () => {
  it('marks all notifications read and returns ok: true', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    const res = await request(app).post('/notifications/read-all');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── POST /notifications — create ──────────────────────────────────────────────

describe('POST /notifications — create', () => {
  it('returns 400 when required fields are missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/notifications').send({ subject: 'Hello' }); // missing body + channel
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('creates notification and returns 201', async () => {
    const app = makeApp();
    const newRow = { id: 5, recipient_id: 7, subject: 'Test', body: 'Test body', channel: 'push', status: 'pending' };
    mockPool.query.mockResolvedValueOnce({ rows: [newRow] });
    const res = await request(app).post('/notifications').send({ subject: 'Test', body: 'Test body', channel: 'push', recipientId: 7 });
    expect(res.status).toBe(201);
    expect(res.body.notification).toBeDefined();
    expect(res.body.notification.subject).toBe('Test');
  });
});

// ── POST /notifications/send-report-email ─────────────────────────────────────

describe('POST /notifications/send-report-email', () => {
  it('returns 400 when required fields are missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/notifications/send-report-email').send({ to: 'user@yahwehcare.com.au' }); // missing reportTitle
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 503 when RESEND_API_KEY is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    const app = makeApp();
    const res = await request(app).post('/notifications/send-report-email').send({ to: 'user@yahwehcare.com.au', reportTitle: 'Test Report' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('email_not_configured');
  });

  it('returns 400 when recipient list is empty after filtering', async () => {
    const app = makeApp();
    const res = await request(app).post('/notifications/send-report-email').send({ to: '', reportTitle: 'Report' });
    expect(res.status).toBe(400);
  });
});
