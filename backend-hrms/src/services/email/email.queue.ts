// ============================================================
// Email queue — DB-backed fire-and-forget.
//
// • enqueue()       — insert a row and immediately kick off
//                     an async attempt (setImmediate).
// • processQueue()  — called by /cron/email-retry every 5 min;
//                     retries rows that are pending / failed
//                     with retry_count < 5.
// • Backoff:        attempt 0→30s, 1→5m, 2→15m, 3→1h, 4→4h
// ============================================================

import { v4 as uuid } from 'uuid';
import { pool } from '../../db/pool';
import { buildTicketEmail } from './email.templates';
import { buildAccountCreatedHtml, buildPasswordResetHtml } from './email.templates';
import { sendEmail } from './resend.service';
import type {
  EmailEventType,
  TicketEmailPayload,
  UserEmailPayload,
  QueuedEmailRow,
} from './email.types';

// ── Backoff schedule ─────────────────────────────────────────
const BACKOFF_SECONDS = [30, 5 * 60, 15 * 60, 60 * 60, 4 * 60 * 60];
const MAX_RETRIES = 5;

function nextRetryAt(retryCount: number): Date {
  const delayMs = (BACKOFF_SECONDS[retryCount] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]) * 1000;
  return new Date(Date.now() + delayMs);
}

// ── Enqueue ───────────────────────────────────────────────────

export interface EnqueueOptions {
  eventType:  EmailEventType;
  recipients: Array<{ email: string; name?: string }>;
  payload:    TicketEmailPayload | UserEmailPayload;
  ticketId?:  number;
}

/**
 * Insert into notification_queue, then kick off an immediate
 * async attempt. Never awaits the send — always returns fast.
 */
export async function enqueue(opts: EnqueueOptions): Promise<void> {
  const id = uuid();

  try {
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.notification_queue
         (id, event_name, recipients, payload, status, retry_count, next_retry_at)
       VALUES ($1, $2, $3, $4, 'pending', 0, NOW())`,
      [
        id,
        opts.eventType,
        JSON.stringify(opts.recipients),
        JSON.stringify(opts.payload),
      ],
    );
  } catch (e) {
    // DB insert failed — log and bail, don't crash the request
    console.error('[email-queue] failed to enqueue:', opts.eventType, e);
    return;
  }

  // Fire-and-forget — do not await
  setImmediate(() => {
    attemptSend(id, opts.eventType, opts.recipients, opts.payload, opts.ticketId, 0)
      .catch((e) => console.error('[email-queue] immediate send error:', e));
  });
}

// ── Cron-driven retry ─────────────────────────────────────────

/** Called by /cron/email-retry */
export async function processQueue(): Promise<{ processed: number; errors: number }> {
  const { rows } = await pool.query<QueuedEmailRow & { recipients: string }>(
    `SELECT id, event_name, recipients, payload, retry_count
     FROM yc_tkt_mgmt.notification_queue
     WHERE status IN ('pending','failed')
       AND retry_count < $1
       AND next_retry_at <= NOW()
     ORDER BY next_retry_at ASC
     LIMIT 50`,
    [MAX_RETRIES],
  );

  let processed = 0;
  let errors    = 0;

  for (const row of rows) {
    try {
      // Mark in-flight so another cron invocation doesn't double-send
      await pool.query(
        `UPDATE yc_tkt_mgmt.notification_queue SET status = 'processing' WHERE id = $1`,
        [row.id],
      );

      const recipients: Array<{ email: string }> = JSON.parse(row.recipients as unknown as string);
      const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as TicketEmailPayload | UserEmailPayload;
      const ticketId = (payload as TicketEmailPayload).ticketId;

      await attemptSend(row.id, row.event_name as EmailEventType, recipients, payload, ticketId, row.retry_count);
      processed++;
    } catch (e) {
      console.error('[email-queue] processQueue error for row', row.id, e);
      errors++;
      await pool.query(
        `UPDATE yc_tkt_mgmt.notification_queue
         SET status = 'failed', retry_count = retry_count + 1, next_retry_at = $1
         WHERE id = $2`,
        [nextRetryAt(row.retry_count), row.id],
      );
    }
  }

  return { processed, errors };
}

// ── Core send logic ───────────────────────────────────────────

async function attemptSend(
  queueId:    string,
  eventType:  EmailEventType,
  recipients: Array<{ email: string; name?: string }>,
  payload:    TicketEmailPayload | UserEmailPayload,
  ticketId:   number | undefined,
  retryCount: number,
): Promise<void> {
  // Build template
  let subject: string;
  let html:    string;

  try {
    if (eventType === 'user.account_created') {
      html    = buildAccountCreatedHtml(payload as UserEmailPayload);
      subject = 'Welcome to Yahweahcare TMS — Your Account is Ready';
    } else if (eventType === 'user.password_reset') {
      html    = buildPasswordResetHtml(payload as UserEmailPayload);
      subject = 'Password Reset Request — Yahweahcare TMS';
    } else {
      const built = buildTicketEmail(eventType, payload as TicketEmailPayload);
      html        = built.html;
      subject     = built.subject;
    }
  } catch (e) {
    console.error('[email-queue] template build error:', e);
    await markFailed(queueId, retryCount, String(e));
    return;
  }

  // Send to each recipient
  const to = recipients.map((r) => r.email);
  const result = await sendEmail({ to, subject, html, ticketId, queueId });

  if (result.ok) {
    await pool.query(
      `UPDATE yc_tkt_mgmt.notification_queue
       SET status = 'sent', sent_at = NOW()
       WHERE id = $1`,
      [queueId],
    );
  } else {
    await markFailed(queueId, retryCount, result.error);
  }
}

async function markFailed(queueId: string, retryCount: number, error?: string): Promise<void> {
  const newCount  = retryCount + 1;
  const maxed     = newCount >= MAX_RETRIES;
  const retryAt   = maxed ? null : nextRetryAt(retryCount);

  await pool.query(
    `UPDATE yc_tkt_mgmt.notification_queue
     SET status = $1, retry_count = $2, next_retry_at = $3, last_error = $4
     WHERE id = $5`,
    [maxed ? 'permanently_failed' : 'failed', newCount, retryAt, error ?? null, queueId],
  );
}
