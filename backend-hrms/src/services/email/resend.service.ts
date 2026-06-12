// ============================================================
// Thin wrapper around the Resend SDK.
// All sends go through sendEmail() — it never throws; it returns
// a result so callers can decide whether to retry.
// ============================================================

import { Resend } from 'resend';
import { env } from '../../config/env';
import { pool } from '../../db/pool';

let _resend: Resend | null = null;

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

export interface SendEmailOptions {
  to:          string | string[];
  subject:     string;
  html:        string;
  /** For email_logs.ticket_id */
  ticketId?:   number;
  /** Queue row ID — written to logs so we can trace retries */
  queueId?:    string;
}

export interface SendEmailResult {
  ok:               boolean;
  resendMessageId?: string;
  error?:           string;
}

/** Fire an email. Never throws. Logs result to email_logs. */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const from = env.EMAIL_FROM ?? 'Yahweahcare <noreply@yahwehcare.com.au>';
  const to   = Array.isArray(opts.to) ? opts.to : [opts.to];

  // Validate all recipients
  const validTo = to.filter(isValidEmail);
  if (validTo.length === 0) {
    const err = 'No valid recipient email addresses';
    await writeLog({ ticketId: opts.ticketId, queueId: opts.queueId, to, subject: opts.subject, status: 'failed', error: err });
    return { ok: false, error: err };
  }

  const client = getClient();
  if (!client) {
    // Resend not configured — skip silently in dev, log warning
    console.warn('[email] RESEND_API_KEY not set — email not sent:', opts.subject);
    await writeLog({ ticketId: opts.ticketId, queueId: opts.queueId, to: validTo, subject: opts.subject, status: 'skipped', error: 'RESEND_API_KEY not configured' });
    return { ok: true }; // treat as success so we don't block operations
  }

  try {
    const { data, error } = await client.emails.send({
      from,
      to: validTo,
      subject: opts.subject,
      html: opts.html,
    });

    if (error) {
      await writeLog({ ticketId: opts.ticketId, queueId: opts.queueId, to: validTo, subject: opts.subject, status: 'failed', error: String((error as { message?: string }).message ?? error) });
      return { ok: false, error: String((error as { message?: string }).message ?? error) };
    }

    await writeLog({ ticketId: opts.ticketId, queueId: opts.queueId, to: validTo, subject: opts.subject, status: 'sent', resendMessageId: data?.id });
    return { ok: true, resendMessageId: data?.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeLog({ ticketId: opts.ticketId, queueId: opts.queueId, to: validTo, subject: opts.subject, status: 'failed', error: msg });
    return { ok: false, error: msg };
  }
}

// ── Logging ───────────────────────────────────────────────────

interface LogArgs {
  ticketId?:          number;
  queueId?:           string;
  to:                 string[];
  subject:            string;
  status:             'sent' | 'failed' | 'skipped';
  error?:             string;
  resendMessageId?:   string;
}

async function writeLog(args: LogArgs): Promise<void> {
  try {
    // One row per recipient
    const rows = args.to.map(email => ({
      email,
      ticket_id:          args.ticketId   ?? null,
      queue_id:           args.queueId    ?? null,
      subject:            args.subject,
      resend_message_id:  args.resendMessageId ?? null,
      status:             args.status,
      error_message:      args.error      ?? null,
      sent_at:            args.status === 'sent' ? new Date() : null,
    }));

    for (const r of rows) {
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.email_logs
           (ticket_id, queue_id, recipient_email, subject, resend_message_id, status, error_message, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [r.ticket_id, r.queue_id, r.email, r.subject, r.resend_message_id, r.status, r.error_message, r.sent_at],
      );
    }
  } catch (e) {
    // Never let logging errors bubble up
    console.error('[email] failed to write email_log:', e);
  }
}

// ── Validation ────────────────────────────────────────────────

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
