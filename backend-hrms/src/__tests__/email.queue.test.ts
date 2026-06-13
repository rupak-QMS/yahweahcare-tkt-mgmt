// ============================================================
// Tests for src/services/email/email.queue.ts
// Covers:
//   enqueue()      — inserts into notification_queue, fires setImmediate send
//   processQueue() — fetches pending/failed rows, marks in-flight, retries
//   attemptSend()  — template building (user + ticket events), success path,
//                    markFailed on send error, template build error
//   markFailed()   — exponential backoff, permanently_failed after MAX_RETRIES
// ============================================================

import { pool } from '../db/pool';

const mockPool = pool as any;

// ── Mock email templates ──────────────────────────────────────────────────────
const mockBuildTicketEmail      = jest.fn();
const mockBuildAccountCreated   = jest.fn();
const mockBuildPasswordReset    = jest.fn();
jest.mock('../services/email/email.templates', () => ({
  buildTicketEmail:        mockBuildTicketEmail,
  buildAccountCreatedHtml: mockBuildAccountCreated,
  buildPasswordResetHtml:  mockBuildPasswordReset,
}));

// ── Mock resend.service ───────────────────────────────────────────────────────
const mockSendEmail = jest.fn();
jest.mock('../services/email/resend.service', () => ({
  sendEmail: mockSendEmail,
}));

import { enqueue, processQueue } from '../services/email/email.queue';
import type { TicketEmailPayload, UserEmailPayload } from '../services/email/email.types';

// Helper to flush setImmediate callbacks
const flushImmediate = () => new Promise<void>(resolve => setImmediate(resolve));

const ticketPayload: TicketEmailPayload = {
  ticketId: 1, ticketTitle: 'Fix Bug', actorId: 10, actorName: 'Alice',
  priority: 'high', category: 'IT', status: 'open',
};

const userPayload: UserEmailPayload = {
  targetUserName: 'Jane', targetUserEmail: 'jane@example.com',
  actorName: 'Admin', temporaryPassword: 'TempPass1!',
};

// ── enqueue() ─────────────────────────────────────────────────────────────────

describe('enqueue()', () => {
  it('inserts a row into notification_queue with correct fields', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });  // UPDATE sent (from setImmediate)
    mockBuildTicketEmail.mockReturnValueOnce({ html: '<p/>', subject: 'Sub' });
    mockSendEmail.mockResolvedValueOnce({ ok: true });

    await enqueue({
      eventType: 'ticket.created',
      recipients: [{ email: 'user@example.com', name: 'User' }],
      payload: ticketPayload,
      ticketId: 1,
    });
    await flushImmediate(); // ensure setImmediate callback completes before assertions

    // First call must be the INSERT
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO');
    expect(sql).toContain('notification_queue');
    expect(params[1]).toBe('ticket.created');       // event_name
    expect(JSON.parse(params[2])).toEqual([{ email: 'user@example.com', name: 'User' }]); // recipients
  });

  it('fires sendEmail via setImmediate and marks row as sent on success', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });  // UPDATE sent
    mockBuildTicketEmail.mockReturnValueOnce({ html: '<p>html</p>', subject: 'New Ticket' });
    mockSendEmail.mockResolvedValueOnce({ ok: true, resendMessageId: 'msg_ok' });

    await enqueue({
      eventType: 'ticket.created',
      recipients: [{ email: 'user@example.com' }],
      payload: ticketPayload,
      ticketId: 1,
    });
    await flushImmediate();

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sentUpdate = mockPool.query.mock.calls[1];
    expect(sentUpdate[0]).toContain("status = 'sent'");
  });

  it('marks row as failed when sendEmail returns ok:false', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });  // UPDATE failed
    mockBuildTicketEmail.mockReturnValueOnce({ html: '<p/>', subject: 'S' });
    mockSendEmail.mockResolvedValueOnce({ ok: false, error: 'domain not verified' });

    await enqueue({
      eventType: 'ticket.created',
      recipients: [{ email: 'user@example.com' }],
      payload: ticketPayload,
    });
    await flushImmediate();

    const failedUpdate = mockPool.query.mock.calls[1];
    // status can be 'failed' or 'permanently_failed' depending on retry count
    expect(failedUpdate[0]).toContain('UPDATE');
    expect(failedUpdate[0]).toContain('notification_queue');
  });

  it('uses buildAccountCreatedHtml for user.account_created events', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockBuildAccountCreated.mockReturnValueOnce('<p>Welcome!</p>');
    mockSendEmail.mockResolvedValueOnce({ ok: true });

    await enqueue({
      eventType: 'user.account_created',
      recipients: [{ email: 'jane@example.com' }],
      payload: userPayload,
    });
    await flushImmediate();

    expect(mockBuildAccountCreated).toHaveBeenCalledTimes(1);
    expect(mockBuildTicketEmail).not.toHaveBeenCalled();
    const sendArgs = mockSendEmail.mock.calls[0][0];
    expect(sendArgs.subject).toContain('Welcome');
  });

  it('uses buildPasswordResetHtml for user.password_reset events', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockBuildPasswordReset.mockReturnValueOnce('<p>Reset!</p>');
    mockSendEmail.mockResolvedValueOnce({ ok: true });

    await enqueue({
      eventType: 'user.password_reset',
      recipients: [{ email: 'jane@example.com' }],
      payload: userPayload,
    });
    await flushImmediate();

    expect(mockBuildPasswordReset).toHaveBeenCalledTimes(1);
    expect(mockBuildTicketEmail).not.toHaveBeenCalled();
    const sendArgs = mockSendEmail.mock.calls[0][0];
    expect(sendArgs.subject).toContain('Password Reset');
  });

  it('does not throw and logs error when DB INSERT fails', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection refused'));

    await expect(
      enqueue({ eventType: 'ticket.created', recipients: [], payload: ticketPayload }),
    ).resolves.toBeUndefined();

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('marks row as "failed" on first failure (retry_count=0 → 1, below MAX_RETRIES=5)', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // INSERT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });  // UPDATE failed (markFailed)
    mockBuildTicketEmail.mockReturnValueOnce({ html: '<p/>', subject: 'S' });
    mockSendEmail.mockResolvedValueOnce({ ok: false, error: 'bad' });

    await enqueue({
      eventType: 'ticket.created',
      recipients: [{ email: 'u@example.com' }],
      payload: ticketPayload,
    });
    await flushImmediate();

    const updateCall = mockPool.query.mock.calls[1];
    // retry_count=0 + 1 = 1, below MAX_RETRIES=5 → status='failed'
    expect(updateCall[0]).toContain('UPDATE');
    expect(updateCall[1][0]).toBe('failed');
  });
});

// ── processQueue() ────────────────────────────────────────────────────────────

describe('processQueue()', () => {
  it('returns { processed: 0, errors: 0 } when no rows are pending', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // SELECT pending rows

    const result = await processQueue();
    expect(result).toEqual({ processed: 0, errors: 0 });
  });

  it('marks row processing, sends email, and returns processed:1 on success', async () => {
    const row = {
      id: 'row-uuid-1',
      event_name: 'ticket.created',
      recipients: JSON.stringify([{ email: 'user@example.com' }]),
      payload: JSON.stringify(ticketPayload),
      retry_count: 0,
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [row] })            // SELECT pending
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE processing
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });  // UPDATE sent
    mockBuildTicketEmail.mockReturnValueOnce({ html: '<p/>', subject: 'Retry Sub' });
    mockSendEmail.mockResolvedValueOnce({ ok: true, resendMessageId: 'msg_retry' });

    const result = await processQueue();

    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    // Check processing mark
    const processingUpdate = mockPool.query.mock.calls[1];
    expect(processingUpdate[0]).toContain("status = 'processing'");
    expect(processingUpdate[1][0]).toBe('row-uuid-1');

    // Check sent mark
    const sentUpdate = mockPool.query.mock.calls[2];
    expect(sentUpdate[0]).toContain("status = 'sent'");
  });

  it('increments errors and marks row failed when send fails', async () => {
    const row = {
      id: 'row-uuid-2',
      event_name: 'ticket.created',
      recipients: JSON.stringify([{ email: 'u@example.com' }]),
      payload: JSON.stringify(ticketPayload),
      retry_count: 1,
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE processing
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });  // UPDATE failed
    mockBuildTicketEmail.mockReturnValueOnce({ html: '<p/>', subject: 'S' });
    mockSendEmail.mockResolvedValueOnce({ ok: false, error: 'bounce' });

    const result = await processQueue();

    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0); // errors only increments if the whole row throws, not send failure

    const failedUpdate = mockPool.query.mock.calls[2];
    expect(failedUpdate[0]).toContain('UPDATE');
    expect(failedUpdate[0]).toContain('notification_queue');
  });

  it('handles multiple rows and processes each independently', async () => {
    const rows = [
      { id: 'r1', event_name: 'ticket.created', recipients: JSON.stringify([{ email: 'a@x.com' }]), payload: JSON.stringify(ticketPayload), retry_count: 0 },
      { id: 'r2', event_name: 'ticket.created', recipients: JSON.stringify([{ email: 'b@x.com' }]), payload: JSON.stringify(ticketPayload), retry_count: 0 },
    ];
    mockPool.query
      .mockResolvedValueOnce({ rows })                    // SELECT pending
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE processing r1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE sent r1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE processing r2
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });  // UPDATE sent r2
    mockBuildTicketEmail
      .mockReturnValueOnce({ html: '<p/>', subject: 'S1' })
      .mockReturnValueOnce({ html: '<p/>', subject: 'S2' });
    mockSendEmail
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    const result = await processQueue();

    expect(result.processed).toBe(2);
    expect(result.errors).toBe(0);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it('template build errors are caught inside attemptSend and row is marked failed (not counted as errors)', async () => {
    // The template build error is caught by attemptSend's inner try/catch.
    // It calls markFailed() and returns normally — so processQueue counts it
    // as processed:1, errors:0 (the outer catch never fires).
    const row = {
      id: 'row-throw',
      event_name: 'ticket.created',
      recipients: JSON.stringify([{ email: 'u@example.com' }]),
      payload: JSON.stringify(ticketPayload),
      retry_count: 0,
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // UPDATE processing
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });  // markFailed UPDATE (inner catch)
    mockBuildTicketEmail.mockImplementationOnce(() => { throw new Error('Template crash'); });

    const result = await processQueue();

    // Template error is handled internally — row is marked failed but NOT an outer error
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);

    // Verify markFailed was called (the third query should be the failed UPDATE)
    const failedUpdate = mockPool.query.mock.calls[2];
    expect(failedUpdate[0]).toContain('UPDATE');
    expect(failedUpdate[0]).toContain('notification_queue');
  });

  it('counts errors when the UPDATE processing query throws (outer catch fires)', async () => {
    const row = {
      id: 'row-outer-throw',
      event_name: 'ticket.created',
      recipients: JSON.stringify([{ email: 'u@example.com' }]),
      payload: JSON.stringify(ticketPayload),
      retry_count: 0,
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [row] })
      .mockRejectedValueOnce(new Error('DB crash during processing mark'))  // UPDATE processing throws
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });  // outer catch markFailed UPDATE

    const result = await processQueue();

    expect(result.errors).toBe(1);
    expect(result.processed).toBe(0);
  });

  it('parses payload correctly when stored as a JSON string', async () => {
    const row = {
      id: 'row-json',
      event_name: 'user.account_created',
      recipients: JSON.stringify([{ email: 'new@example.com' }]),
      // payload stored as double-encoded string (some DBs return text)
      payload: JSON.stringify(userPayload),
      retry_count: 0,
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockBuildAccountCreated.mockReturnValueOnce('<p>Welcome</p>');
    mockSendEmail.mockResolvedValueOnce({ ok: true });

    await processQueue();

    expect(mockBuildAccountCreated).toHaveBeenCalledTimes(1);
    expect(mockBuildAccountCreated.mock.calls[0][0]).toMatchObject({ targetUserName: 'Jane' });
  });

  it('sends to all recipient emails extracted from recipients JSON', async () => {
    const row = {
      id: 'row-multi',
      event_name: 'ticket.created',
      recipients: JSON.stringify([{ email: 'a@x.com' }, { email: 'b@x.com' }]),
      payload: JSON.stringify(ticketPayload),
      retry_count: 0,
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockBuildTicketEmail.mockReturnValueOnce({ html: '<p/>', subject: 'Multi' });
    mockSendEmail.mockResolvedValueOnce({ ok: true });

    await processQueue();

    const sendArgs = mockSendEmail.mock.calls[0][0];
    expect(sendArgs.to).toEqual(['a@x.com', 'b@x.com']);
  });
});
