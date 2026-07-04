// ============================================================
// Tests for /audit-logs routes — filtered export + the manual
// quarterly archive / email / truncate workflow.
//
// audit.service (logAudit) and archive.migrate (ensureArchiveTable)
// are mocked wholesale so tests only need to track the pool.query
// calls that matter for each route's own logic, not their side effects.
// ============================================================

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

const mockPool = pool as any;

jest.mock('../modules/audit/audit.service', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../modules/audit/archive.migrate', () => ({
  ensureArchiveTable: jest.fn().mockResolvedValue(undefined),
}));
const mockSendEmail = jest.fn();
jest.mock('../services/email/resend.service', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  isValidEmail: (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
}));

function makeApp(auth: Record<string, unknown> | null = { userId: 1, email: 'ron@yahwehcare.com.au', role: 'super_admin', permissions: [], sessionId: 1 }) {
  const app = express();
  app.use(express.json());
  if (auth) app.use((req: any, _res, next) => { req.auth = auth; next(); });
  const router = require('../modules/audit/audit.routes').default;
  app.use('/audit-logs', router);
  return app;
}

const OK = { rows: [], rowCount: 0 };

function mockBootstrapCheck(isAdmin: boolean) {
  mockPool.query.mockResolvedValueOnce({ rows: [{ is_bootstrap_admin: isAdmin }] });
}

beforeEach(() => {
  mockPool.query.mockReset();
  mockSendEmail.mockReset();
});

// ── Bootstrap-admin gating ───────────────────────────────────────────────────

describe('requireBootstrapAdmin gating', () => {
  it('returns 401 when unauthenticated (no req.auth, no token)', async () => {
    const res = await request(makeApp(null)).get('/audit-logs/export?format=csv');
    expect(res.status).toBe(401);
  });

  it('returns 403 when the user is authenticated but not a bootstrap admin', async () => {
    mockBootstrapCheck(false);
    const res = await request(makeApp()).get('/audit-logs/export?format=csv');
    expect(res.status).toBe(403);
  });
});

// ── GET /audit-logs/export ───────────────────────────────────────────────────

describe('GET /audit-logs/export', () => {
  it('rejects an unsupported format', async () => {
    mockBootstrapCheck(true);
    const res = await request(makeApp()).get('/audit-logs/export?format=pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_format');
  });

  it('exports matching rows as CSV with the right content type', async () => {
    mockBootstrapCheck(true);
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1, user_id: 1, user_name: 'Ron', actor_email: 'ron@x.com', role: 'super_admin',
        action: 'login.success', module: 'auth', target_type: null, target_id: null,
        metadata: {}, ip_address: '1.1.1.1', user_agent: 'UA', success: true, created_at: new Date(),
      }],
    });
    const res = await request(makeApp()).get('/audit-logs/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('login.success');
  });

  it('exports matching rows as JSON', async () => {
    mockBootstrapCheck(true);
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 2, user_id: 2, user_name: 'Alex', actor_email: 'alex@x.com', role: 'admin',
        action: 'ticket.create', module: 'tickets', target_type: 'ticket', target_id: '24',
        metadata: {}, ip_address: null, user_agent: null, success: true, created_at: new Date(),
      }],
    });
    const res = await request(makeApp()).get('/audit-logs/export?format=json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const parsed = JSON.parse(res.text);
    expect(parsed[0].action).toBe('ticket.create');
  });
});

// ── POST /audit-logs/archive/generate ────────────────────────────────────────

describe('POST /audit-logs/archive/generate', () => {
  it('rejects an invalid quarter', async () => {
    mockBootstrapCheck(true);
    const res = await request(makeApp()).post('/audit-logs/archive/generate').send({ fyYear: 2026, quarter: 9 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_period');
  });

  it('builds and stores a ZIP archive, returning metadata only (never the zip bytes)', async () => {
    mockBootstrapCheck(true);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 1, user_id: 1, user_name: 'Ron', actor_email: 'ron@x.com', role: 'super_admin',
          action: 'login.success', module: 'auth', target_type: null, target_id: null,
          metadata: {}, ip_address: null, user_agent: null, success: true, created_at: new Date(),
        }],
      }) // audit_logs rows for the quarter
      .mockResolvedValueOnce({ rows: [{ id: 'abc-123', generated_at: new Date().toISOString() }] }); // INSERT archive

    const res = await request(makeApp()).post('/audit-logs/archive/generate').send({ fyYear: 2026, quarter: 1 });
    expect(res.status).toBe(200);
    expect(res.body.archive.filename).toBe('Activity_Log_AU_FY2026_Q1.zip');
    expect(res.body.archive.recordCount).toBe(1);
    expect(res.body.archive.zip_data).toBeUndefined();

    const insertCall = mockPool.query.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO yc_tkt_mgmt.activity_log_archives');
    expect(insertCall[1]).toEqual([2026, 1, expect.any(String), expect.any(String), 'Activity_Log_AU_FY2026_Q1.zip', 1, expect.any(Buffer), 1, 'ron@yahwehcare.com.au']);
  });
});

// ── GET /audit-logs/archives ──────────────────────────────────────────────────

describe('GET /audit-logs/archives', () => {
  it('returns archive metadata rows', async () => {
    mockBootstrapCheck(true);
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'a1', fy_year: 2026, quarter: 1, filename: 'x.zip', record_count: 5 }] });
    const res = await request(makeApp()).get('/audit-logs/archives');
    expect(res.status).toBe(200);
    expect(res.body.archives).toHaveLength(1);
    expect(res.body.archives[0].filename).toBe('x.zip');
  });
});

// ── POST /audit-logs/archives/:id/email ──────────────────────────────────────

describe('POST /audit-logs/archives/:id/email', () => {
  it('emails the ZIP to all active bootstrap admins and marks email_status = sent', async () => {
    mockBootstrapCheck(true);
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'a1', fy_year: 2026, quarter: 1, filename: 'x.zip', zip_data: Buffer.from('zip') }] }) // archive fetch
      .mockResolvedValueOnce({ rows: [{ email: 'admin1@x.com' }, { email: 'admin2@x.com' }] }) // active bootstrap admin emails
      .mockResolvedValueOnce(OK); // UPDATE archive row
    mockSendEmail.mockResolvedValueOnce({ ok: true, resendMessageId: 'msg_1' });

    const res = await request(makeApp()).post('/audit-logs/archives/a1/email');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.emailStatus).toBe('sent');
    expect(res.body.recipients).toEqual(['admin1@x.com', 'admin2@x.com']);

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: ['admin1@x.com', 'admin2@x.com'],
      subject: 'Australian Financial Quarter Activity Log Archive – FY2026 Q1',
      attachments: [{ filename: 'x.zip', content: expect.any(Buffer) }],
    }));

    const updateCall = mockPool.query.mock.calls[3];
    expect(updateCall[0]).toContain('UPDATE yc_tkt_mgmt.activity_log_archives');
    expect(updateCall[1]).toEqual(['a1', 1, 'sent', null, JSON.stringify(['admin1@x.com', 'admin2@x.com'])]);
  });

  it('records email_status = failed when the send fails, without throwing', async () => {
    mockBootstrapCheck(true);
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'a1', fy_year: 2026, quarter: 1, filename: 'x.zip', zip_data: Buffer.from('zip') }] })
      .mockResolvedValueOnce({ rows: [{ email: 'admin1@x.com' }] })
      .mockResolvedValueOnce(OK);
    mockSendEmail.mockResolvedValueOnce({ ok: false, error: 'Resend API error' });

    const res = await request(makeApp()).post('/audit-logs/archives/a1/email');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.emailStatus).toBe('failed');
  });

  it('returns 400 when there are no active bootstrap admins with an email', async () => {
    mockBootstrapCheck(true);
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'a1', fy_year: 2026, quarter: 1, filename: 'x.zip', zip_data: Buffer.from('zip') }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).post('/audit-logs/archives/a1/email');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_recipients');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown archive id', async () => {
    mockBootstrapCheck(true);
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).post('/audit-logs/archives/missing/email');
    expect(res.status).toBe(404);
  });
});

// ── POST /audit-logs/archives/:id/truncate ───────────────────────────────────

describe('POST /audit-logs/archives/:id/truncate', () => {
  it('requires confirm:true in the body', async () => {
    mockBootstrapCheck(true);
    const res = await request(makeApp()).post('/audit-logs/archives/a1/truncate').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('confirmation_required');
  });

  it('refuses to truncate an archive that has not been successfully emailed', async () => {
    mockBootstrapCheck(true);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'a1', fy_year: 2026, quarter: 1, filename: 'x.zip', period_start: '2025-07-01', period_end: '2025-10-01', email_status: null, truncated_at: null }],
    });
    const res = await request(makeApp()).post('/audit-logs/archives/a1/truncate').send({ confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('email_not_sent');
  });

  it('refuses to truncate an archive that was already truncated', async () => {
    mockBootstrapCheck(true);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'a1', email_status: 'sent', truncated_at: new Date().toISOString() }],
    });
    const res = await request(makeApp()).post('/audit-logs/archives/a1/truncate').send({ confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('already_truncated');
  });

  it('returns 404 for an unknown archive id', async () => {
    mockBootstrapCheck(true);
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).post('/audit-logs/archives/missing/truncate').send({ confirm: true });
    expect(res.status).toBe(404);
  });

  it('deletes exactly the archived period\'s rows once confirmed + emailed, and records the count', async () => {
    mockBootstrapCheck(true);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'a1', fy_year: 2026, quarter: 1, filename: 'x.zip',
          period_start: '2025-07-01T00:00:00.000Z', period_end: '2025-10-01T00:00:00.000Z',
          email_status: 'sent', truncated_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 42 }) // DELETE
      .mockResolvedValueOnce(OK); // UPDATE archive row

    const res = await request(makeApp()).post('/audit-logs/archives/a1/truncate').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.truncatedCount).toBe(42);

    const deleteCall = mockPool.query.mock.calls[2];
    expect(deleteCall[0]).toContain('DELETE FROM yc_tkt_mgmt.audit_logs');
    expect(deleteCall[1]).toEqual(['2025-07-01T00:00:00.000Z', '2025-10-01T00:00:00.000Z']);
  });
});
