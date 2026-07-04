// ============================================================
// Tests for src/services/email/resend.service.ts
// Covers:
//   isValidEmail()  — valid/invalid patterns
//   sendEmail()     — no RESEND_API_KEY (skipped), valid recipients,
//                     invalid recipients, Resend API success/error/throw,
//                     multi-recipient, email_logs written per send
// ============================================================

import { pool } from '../db/pool';

const mockPool = pool as any;

// ── Mock Resend SDK ──────────────────────────────────────────────────────────
const mockEmailsSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockEmailsSend },
  })),
}));

// ── Mock env ─────────────────────────────────────────────────────────────────
jest.mock('../config/env', () => ({
  env: {
    RESEND_API_KEY: undefined as string | undefined,
    EMAIL_FROM: 'Yahweahcare <noreply@yahwehcare.com.au>',
    FRONTEND_URL: 'https://yahweahcare-tkt-mgmt.vercel.app',
  },
}));

import { sendEmail, isValidEmail } from '../services/email/resend.service';
import { env } from '../config/env';
import { Resend } from 'resend';

const mockEnv = env as any;
const MockResend = Resend as jest.MockedClass<typeof Resend>;

// Re-register Resend constructor before each test because resetMocks:true clears
// mockImplementation, and the module-level _resend cache means the constructor
// must always return an object with the correct shape.
beforeEach(() => {
  mockEnv.RESEND_API_KEY = undefined;
  MockResend.mockImplementation((() => ({
    emails: { send: mockEmailsSend },
  })) as any);
});

// ── isValidEmail ──────────────────────────────────────────────────────────────

describe('isValidEmail()', () => {
  it.each([
    'user@example.com',
    'admin@yahwehcare.com.au',
    'first.last+tag@sub.domain.org',
    'test123@test.io',
  ])('returns true for valid email: %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    '',
    'notanemail',
    '@nodomain.com',
    'missing@',
    'spaces in@email.com',
    'double@@at.com',
  ])('returns false for invalid email: %s', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

// ── sendEmail ─────────────────────────────────────────────────────────────────

describe('sendEmail()', () => {
  beforeEach(() => {
    mockEnv.RESEND_API_KEY = undefined;
  });

  it('returns ok:true and skips when RESEND_API_KEY is not set', async () => {
    // writeLog hits pool.query once
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await sendEmail({ to: 'user@example.com', subject: 'Test', html: '<p>hi</p>' });

    expect(result.ok).toBe(true);
    expect(mockEmailsSend).not.toHaveBeenCalled();
    // email_logs INSERT should still run (status: 'skipped')
    const logCall = mockPool.query.mock.calls[0];
    expect(logCall[0]).toContain('INSERT INTO');
    expect(logCall[0]).toContain('email_logs');
    expect(logCall[1]).toContain('skipped');
  });

  it('returns ok:false and logs when all recipients are invalid', async () => {
    mockEnv.RESEND_API_KEY = 're_test_key';
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // writeLog

    const result = await sendEmail({ to: ['notvalid', 'also bad'], subject: 'S', html: '<p/>' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no valid recipient/i);
    expect(mockEmailsSend).not.toHaveBeenCalled();
  });

  it('sends email and returns ok:true with resendMessageId on success', async () => {
    mockEnv.RESEND_API_KEY = 're_test_key';
    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'msg_abc123' }, error: null });
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // writeLog

    const result = await sendEmail({
      to: 'admin@yahwehcare.com.au',
      subject: 'Welcome',
      html: '<h1>Hi</h1>',
      ticketId: 42,
      queueId: 'queue-uuid-1',
    });

    expect(result.ok).toBe(true);
    expect(result.resendMessageId).toBe('msg_abc123');
    expect(mockEmailsSend).toHaveBeenCalledTimes(1);
    const sendArgs = mockEmailsSend.mock.calls[0][0];
    expect(sendArgs.to).toEqual(['admin@yahwehcare.com.au']);
    expect(sendArgs.subject).toBe('Welcome');
    // Verify email_logs INSERT has status='sent'
    const logCall = mockPool.query.mock.calls[0];
    expect(logCall[1]).toContain('sent');
  });

  it('returns ok:false when Resend returns an error object', async () => {
    mockEnv.RESEND_API_KEY = 're_test_key';
    mockEmailsSend.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } });
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // writeLog

    const result = await sendEmail({ to: 'user@example.com', subject: 'S', html: '<p/>' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('domain not verified');
    const logCall = mockPool.query.mock.calls[0];
    expect(logCall[1]).toContain('failed');
    expect(logCall[1]).toContain('domain not verified');
  });

  it('returns ok:false and logs when Resend.send() throws', async () => {
    mockEnv.RESEND_API_KEY = 're_test_key';
    mockEmailsSend.mockRejectedValueOnce(new Error('Network timeout'));
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // writeLog

    const result = await sendEmail({ to: 'user@example.com', subject: 'S', html: '<p/>' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Network timeout');
    const logCall = mockPool.query.mock.calls[0];
    expect(logCall[1]).toContain('failed');
  });

  it('filters out invalid addresses and sends only to valid ones', async () => {
    mockEnv.RESEND_API_KEY = 're_test_key';
    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'msg_xyz' }, error: null });
    // one writeLog per valid recipient
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // log for valid1@example.com
      .mockResolvedValueOnce({ rows: [] }); // log for valid2@example.com

    const result = await sendEmail({
      to: ['valid1@example.com', 'not-valid', 'valid2@example.com'],
      subject: 'Multi',
      html: '<p>hi</p>',
    });

    expect(result.ok).toBe(true);
    const sendArgs = mockEmailsSend.mock.calls[0][0];
    expect(sendArgs.to).toEqual(['valid1@example.com', 'valid2@example.com']);
  });

  it('writes one email_log row per valid recipient on success', async () => {
    mockEnv.RESEND_API_KEY = 're_test_key';
    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'msg_multi' }, error: null });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await sendEmail({
      to: ['a@example.com', 'b@example.com', 'c@example.com'],
      subject: 'Bulk',
      html: '<p/>',
    });

    const logInserts = mockPool.query.mock.calls.filter(([sql]: [string]) =>
      sql.includes('INSERT INTO') && sql.includes('email_logs'),
    );
    expect(logInserts).toHaveLength(3);
  });

  it('does not throw when email_logs INSERT fails — error logged silently', async () => {
    mockEnv.RESEND_API_KEY = 're_test_key';
    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'msg_ok' }, error: null });
    mockPool.query.mockRejectedValueOnce(new Error('DB down')); // writeLog fails

    await expect(
      sendEmail({ to: 'user@example.com', subject: 'S', html: '<p/>' })
    ).resolves.not.toThrow();
  });

  it('accepts a string as `to` and normalises to an array', async () => {
    mockEnv.RESEND_API_KEY = 're_test_key';
    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'msg_str' }, error: null });
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await sendEmail({ to: 'single@example.com', subject: 'S', html: '<p/>' });

    const sendArgs = mockEmailsSend.mock.calls[0][0];
    expect(Array.isArray(sendArgs.to)).toBe(true);
    expect(sendArgs.to).toContain('single@example.com');
  });
});
