/**
 * Unit tests — email-routes.js
 * Tests Resend config endpoint, email queue, send/retry logic,
 * stats, logs, and the queueEmail helper.
 *
 * Key setup rules:
 *  - Set NODE_ENV=test so the worker setTimeout is skipped
 *  - Set global.fetch mock AFTER buildApp (buildApp resets modules)
 *  - Each pool mock chain must account for the 2 CREATE TABLE calls on module load
 */

process.env.NODE_ENV = 'test';

const express = require('express');
const request = require('supertest');

// ── Helpers ──────────────────────────────────────────────────
function makePool(queryMock) {
  return {
    query: queryMock || jest.fn().mockResolvedValue({ rows: [] }),
    on:    jest.fn(),
  };
}

function makeAuth(user = { id: 7, email: 'admin@test.com', name: 'Admin' }) {
  return (req, _res, next) => { req.user = user; next(); };
}

/**
 * Builds a fresh Express app with email routes.
 * Always call this BEFORE configuring global.fetch mocks for the test,
 * since buildApp calls jest.resetModules() which clears module state.
 */
function buildApp(pool, envOverrides = {}) {
  process.env.RESEND_API_KEY = envOverrides.RESEND_API_KEY ?? 'test-resend-key';
  process.env.RESEND_FROM    = envOverrides.RESEND_FROM    ?? 'Test <test@yahwehcare.com.au>';
  process.env.NODE_ENV       = 'test';

  jest.resetModules();
  global.fetch = jest.fn(); // fresh fetch mock for this test

  const emailModule = require('../email-routes.js');
  const router = emailModule(pool, makeAuth());
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return app;
}

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  jest.clearAllMocks();
  jest.resetModules();
});

// ════════════════════════════════════════════════════════════
// GET /api/email/config
// ════════════════════════════════════════════════════════════
describe('GET /api/email/config', () => {
  test('returns configured:true when RESEND_API_KEY is set', async () => {
    const app = buildApp(makePool());
    const res = await request(app).get('/api/email/config');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.from).toContain('yahwehcare.com.au');
  });

  test('returns configured:false when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY;
    jest.resetModules();
    global.fetch = jest.fn();
    const emailModule = require('../email-routes.js');
    const router = emailModule(makePool(), makeAuth());
    const app = express();
    app.use('/api', router);

    const res = await request(app).get('/api/email/config');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// GET /api/email/logs
// ════════════════════════════════════════════════════════════
describe('GET /api/email/logs', () => {
  test('returns paginated logs', async () => {
    const fakeRow = { id: 1, recipient_email: 'a@b.com', subject: 'Hi', status: 'sent', ticket_id: 5, sent_at: new Date().toISOString() };
    const pool = makePool(jest.fn()
      .mockResolvedValueOnce({ rows: [] })                     // CREATE TABLE email_logs
      .mockResolvedValueOnce({ rows: [] })                     // CREATE TABLE email_queue
      .mockResolvedValueOnce({ rows: [fakeRow] })              // SELECT logs
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })       // COUNT
    );
    const app = buildApp(pool);

    const res = await request(app).get('/api/email/logs?page=1&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].recipient_email).toBe('a@b.com');
    expect(res.body.total).toBe(1);
  });

  test('applies status filter in SQL', async () => {
    const pool = makePool(jest.fn()
      .mockResolvedValue({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    );
    const app = buildApp(pool);

    await request(app).get('/api/email/logs?status=failed');

    const selectCall = pool.query.mock.calls.find(
      ([q]) => q.includes('SELECT') && q.includes('email_logs') && q.includes('status')
    );
    expect(selectCall).toBeTruthy();
    expect(selectCall[1]).toContain('failed');
  });
});

// ════════════════════════════════════════════════════════════
// GET /api/email/queue
// ════════════════════════════════════════════════════════════
describe('GET /api/email/queue', () => {
  test('returns non-sent queue entries', async () => {
    const entry = {
      id: 10, event_name: 'ApprovalRequested', recipient_email: 'approver@test.com',
      status: 'pending', retry_count: 0, next_retry_at: null, created_at: new Date().toISOString(),
    };
    const pool = makePool(jest.fn()
      .mockResolvedValueOnce({ rows: [] })         // CREATE TABLE email_logs
      .mockResolvedValueOnce({ rows: [] })         // CREATE TABLE email_queue
      .mockResolvedValueOnce({ rows: [entry] })    // SELECT queue
    );
    const app = buildApp(pool);

    const res = await request(app).get('/api/email/queue');
    expect(res.status).toBe(200);
    expect(res.body.queue).toHaveLength(1);
    expect(res.body.queue[0].event_name).toBe('ApprovalRequested');
  });
});

// ════════════════════════════════════════════════════════════
// GET /api/email/stats
// ════════════════════════════════════════════════════════════
describe('GET /api/email/stats', () => {
  test('returns aggregated log + queue stats', async () => {
    const pool = makePool(jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '42', sent: '38', failed: '3', skipped: '1', last_24h: '10' }] })
      .mockResolvedValueOnce({ rows: [{ pending: '2', failed: '1', permanently_failed: '0' }] })
    );
    const app = buildApp(pool);

    const res = await request(app).get('/api/email/stats');
    expect(res.status).toBe(200);
    expect(res.body.logs.total).toBe(42);
    expect(res.body.logs.sent).toBe(38);
    expect(res.body.logs.failed).toBe(3);
    expect(res.body.logs.last_24h).toBe(10);
    expect(res.body.queue.pending).toBe(2);
    expect(res.body.queue.permanently_failed).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// POST /api/email/test
// ════════════════════════════════════════════════════════════
describe('POST /api/email/test', () => {
  test('returns 400 when "to" is missing', async () => {
    const app = buildApp(makePool());
    const res = await request(app).post('/api/email/test').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/to is required/i);
  });

  test('returns 503 when RESEND_API_KEY not configured', async () => {
    delete process.env.RESEND_API_KEY;
    jest.resetModules();
    global.fetch = jest.fn();
    const emailModule = require('../email-routes.js');
    const router = emailModule(makePool(), makeAuth());
    const app = express();
    app.use(express.json());
    app.use('/api', router);

    const res = await request(app).post('/api/email/test').send({ to: 'u@test.com' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/RESEND_API_KEY/);
  });

  test('calls Resend API and returns ok:true on success', async () => {
    const pool = makePool(jest.fn()
      .mockResolvedValueOnce({ rows: [] })  // CREATE TABLE email_logs
      .mockResolvedValueOnce({ rows: [] })  // CREATE TABLE email_queue
      .mockResolvedValueOnce({ rows: [] })  // INSERT email_logs (success log)
    );
    const app = buildApp(pool);

    // Set fetch mock AFTER buildApp (buildApp resets global.fetch)
    global.fetch.mockResolvedValue({
      ok:   true,
      json: async () => ({ id: 'msg_123' }),
    });

    const res = await request(app).post('/api/email/test').send({ to: 'user@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.to).toContain('user@test.com');
    expect(body.from).toContain('yahwehcare.com.au');
    expect(body.subject).toMatch(/test email/i);
  });

  test('logs failure and returns 500 when Resend returns an error', async () => {
    const pool = makePool(jest.fn()
      .mockResolvedValueOnce({ rows: [] })  // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] })  // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] })  // INSERT failure log
    );
    const app = buildApp(pool);

    global.fetch.mockResolvedValue({
      ok:   false,
      json: async () => ({ message: 'Invalid API key' }),
    });

    const res = await request(app).post('/api/email/test').send({ to: 'user@test.com' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/invalid api key/i);
    const failureLog = pool.query.mock.calls.find(
      ([q]) => q.includes('INSERT') && q.includes('email_logs') && q.includes("'failed'")
    );
    expect(failureLog).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════
// POST /api/email/retry/:id
// ════════════════════════════════════════════════════════════
describe('POST /api/email/retry/:id', () => {
  test('returns 404 for unknown id', async () => {
    const pool = makePool(jest.fn()
      .mockResolvedValueOnce({ rows: [] })  // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] })  // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] })  // UPDATE → empty = not found
    );
    const app = buildApp(pool);
    const res = await request(app).post('/api/email/retry/9999');
    expect(res.status).toBe(404);
  });

  test('resets queue entry status and triggers processing', async () => {
    const entry = {
      id: 5, event_name: 'TicketCreated', recipient_email: 'r@test.com',
      subject: 'Test', html_body: '<p>Hi</p>', ticket_id: 1, retry_count: 0,
    };
    const pool = makePool(jest.fn()
      .mockResolvedValueOnce({ rows: [] })        // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] })        // CREATE TABLE
      .mockResolvedValueOnce({ rows: [entry] })   // UPDATE → returns reset entry
      .mockResolvedValue({ rows: [] })            // processQueueEntry DB calls
    );
    const app = buildApp(pool);

    // Resend succeeds for the background processing
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'x' }) });

    const res = await request(app).post('/api/email/retry/5');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify the UPDATE reset retry_count to 0
    const resetCall = pool.query.mock.calls.find(
      ([q]) => q.includes('UPDATE') && q.includes('email_queue') && q.includes('retry_count=0')
    );
    expect(resetCall).toBeTruthy();
    expect(resetCall[1]).toContain('5'); // route param is always a string
  });
});

// ════════════════════════════════════════════════════════════
// POST /api/email/retry-all
// ════════════════════════════════════════════════════════════
describe('POST /api/email/retry-all', () => {
  test('resets all failed/permanently_failed entries and returns count', async () => {
    const entries = [
      { id: 1, event_name: 'E1', recipient_email: 'a@b.com', subject: 'S', html_body: '<p>B</p>', ticket_id: null, retry_count: 2 },
      { id: 2, event_name: 'E2', recipient_email: 'c@d.com', subject: 'S', html_body: '<p>B</p>', ticket_id: null, retry_count: 1 },
    ];
    const pool = makePool(jest.fn()
      .mockResolvedValueOnce({ rows: [] })         // CREATE TABLE
      .mockResolvedValueOnce({ rows: [] })         // CREATE TABLE
      .mockResolvedValueOnce({ rows: entries })    // UPDATE → returns all reset entries
      .mockResolvedValue({ rows: [] })             // background processQueueEntry calls
    );
    const app = buildApp(pool);
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'x' }) });

    const res = await request(app).post('/api/email/retry-all');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.processed).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════
// queueEmail helper
// ════════════════════════════════════════════════════════════
describe('queueEmail helper', () => {
  test('inserts a row into email_queue with correct fields', async () => {
    jest.resetModules();
    global.fetch = jest.fn();
    const { queueEmail } = require('../email-routes.js');
    const pool = makePool();

    await queueEmail(pool, {
      to:        'approver@test.com',
      subject:   '[Yahweahcare] Approval Required: Fix bug',
      bodyText:  'Hi John,\n\nA ticket needs your approval.',
      ticketId:  10,
      ticketRef: 'YAH-000010',
      eventName: 'ApprovalRequested',
    });

    const insertCall = pool.query.mock.calls.find(
      ([q]) => q.includes('INSERT INTO') && q.includes('email_queue')
    );
    expect(insertCall).toBeTruthy();
    const [, params] = insertCall;
    expect(params[0]).toBe('ApprovalRequested');        // event_name
    expect(params[1]).toBe('approver@test.com');        // recipient_email
    expect(params[2]).toContain('Approval Required');   // subject
    expect(params[3]).toContain('YAH-000010');          // html_body contains ticketRef link
    expect(params[4]).toBe(10);                         // ticket_id
  });

  test('skips silently when "to" is not provided', async () => {
    jest.resetModules();
    const { queueEmail } = require('../email-routes.js');
    const pool = makePool();

    await queueEmail(pool, { subject: 'Test', bodyText: 'Body' }); // no "to"
    expect(pool.query).not.toHaveBeenCalled();
  });
});
