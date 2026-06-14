// ============================================================
// Email admin REST endpoints
// All routes require Bootstrap Admin authentication.
//
// GET  /email/logs            — paginated email log
// GET  /email/logs/:id        — single log entry
// POST /email/test            — send a test email
// POST /email/retry/:id       — retry a failed queue entry
// GET  /email/queue           — view notification_queue (admin)
// GET  /email/stats           — summary stats
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { sendEmail, isValidEmail } from '../../services/email/resend.service';
import { processQueue } from '../../services/email/email.queue';
import { env } from '../../config/env';

const router = Router();

// ── Bootstrap admin guard ─────────────────────────────────────
async function requireBootstrapAdmin(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): Promise<void> {
  if (!req.auth) { res.status(401).json({ error: 'unauthorized' }); return; }

  const { rows } = await pool.query(
    `SELECT is_bootstrap_admin FROM yc_tkt_mgmt.users WHERE id = $1`,
    [req.auth.userId],
  );
  if (!rows[0]?.is_bootstrap_admin) {
    res.status(403).json({ error: 'forbidden', message: 'Bootstrap admin only' });
    return;
  }
  next();
}

// ── GET /email/logs ───────────────────────────────────────────
router.get('/logs', requireAuth, requireBootstrapAdmin, async (req, res, next) => {
  try {
    const page    = Math.max(1, Number(req.query.page)  || 1);
    const limit   = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset  = (page - 1) * limit;
    const status  = req.query.status as string | undefined;
    const search  = req.query.search as string | undefined;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let pi = 1;

    if (status && ['sent','failed','skipped'].includes(status)) {
      conditions.push(`status = $${pi++}`);
      params.push(status);
    }
    if (search?.trim()) {
      conditions.push(`(recipient_email ILIKE $${pi} OR subject ILIKE $${pi})`);
      params.push(`%${search.trim()}%`);
      pi++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT id, ticket_id, queue_id, recipient_email, subject,
                resend_message_id, status, error_message, sent_at, created_at
         FROM yc_tkt_mgmt.email_logs
         ${where}
         ORDER BY created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) FROM yc_tkt_mgmt.email_logs ${where}`,
        params,
      ),
    ]);

    res.json({
      logs:  rows,
      total: Number(countRows[0].count),
      page,
      limit,
    });
  } catch (err) { next(err); }
});

// ── GET /email/logs/:id ───────────────────────────────────────
router.get('/logs/:id', requireAuth, requireBootstrapAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM yc_tkt_mgmt.email_logs WHERE id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ log: rows[0] });
  } catch (err) { next(err); }
});

// ── GET /email/queue ──────────────────────────────────────────
router.get('/queue', requireAuth, requireBootstrapAdmin, async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const conditions = status ? `WHERE status = $1` : '';
    const params = status ? [status] : [];

    const { rows } = await pool.query(
      `SELECT id, event_name, recipients, status, retry_count,
              next_retry_at, last_error, sent_at, created_at
       FROM yc_tkt_mgmt.notification_queue
       ${conditions}
       ORDER BY created_at DESC
       LIMIT 200`,
      params,
    );
    res.json({ queue: rows });
  } catch (err) { next(err); }
});

// ── GET /email/config ─────────────────────────────────────────
// Returns whether Resend is configured — safe to expose to bootstrap admin
router.get('/config', requireAuth, requireBootstrapAdmin, async (_req, res) => {
  res.json({
    configured: !!env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
  });
});

// ── POST /email/test ──────────────────────────────────────────
router.post('/test', requireAuth, requireBootstrapAdmin, async (req, res, next) => {
  try {
    // Fail fast if Resend isn't configured — don't silently skip
    if (!env.RESEND_API_KEY) {
      return res.status(503).json({
        error: 'not_configured',
        message: 'RESEND_API_KEY is not set. Add it to your Vercel environment variables and redeploy.',
      });
    }

    const { to } = req.body || {};
    if (!to || !isValidEmail(String(to))) {
      return res.status(400).json({ error: 'invalid_email', message: 'A valid recipient email is required' });
    }

    const from = env.EMAIL_FROM ?? 'Yahweahcare <noreply@yahwehcare.com.au>';
    const result = await sendEmail({
      to: String(to),
      subject: '[TMS] Email Configuration Test',
      html: `
        <div style="font-family:sans-serif;padding:24px;max-width:480px;">
          <h2 style="color:#4F46E5;margin:0 0 12px;">✅ Email Configuration Test</h2>
          <p style="color:#374151;margin:0 0 8px;">This is a test email from the <strong>Yahweahcare Ticket Management System</strong>.</p>
          <hr style="border:none;border-top:1px solid #E5E7EB;margin:16px 0;" />
          <p style="color:#6B7280;font-size:13px;margin:0 0 4px;">From: <strong>${from}</strong></p>
          <p style="color:#6B7280;font-size:13px;margin:0;">Sent at: <strong>${new Date().toISOString()}</strong></p>
        </div>
      `,
    });

    if (result.ok) {
      res.json({ ok: true, message: `Test email sent to ${to}`, resendMessageId: result.resendMessageId });
    } else {
      res.status(500).json({ ok: false, error: result.error });
    }
  } catch (err) { next(err); }
});

// ── POST /email/retry/:id ─────────────────────────────────────
// Manually retry a single failed queue entry
router.post('/retry/:id', requireAuth, requireBootstrapAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM yc_tkt_mgmt.notification_queue WHERE id = $1`,
      [id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });

    const row = rows[0];
    if (row.status === 'sent') {
      return res.status(400).json({ error: 'already_sent', message: 'This message was already sent successfully' });
    }

    // Reset to pending so processQueue() picks it up immediately
    await pool.query(
      `UPDATE yc_tkt_mgmt.notification_queue
       SET status = 'pending', next_retry_at = NOW(), retry_count = 0
       WHERE id = $1`,
      [id],
    );

    // Run queue immediately
    const result = await processQueue();
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// ── POST /email/retry-all ─────────────────────────────────────
// Trigger a full queue flush (same as cron)
router.post('/retry-all', requireAuth, requireBootstrapAdmin, async (req, res, next) => {
  try {
    const result = await processQueue();
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// ── GET /email/stats ──────────────────────────────────────────
router.get('/stats', requireAuth, requireBootstrapAdmin, async (req, res, next) => {
  try {
    const [logStats, queueStats] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)                                        AS total,
          COUNT(*) FILTER (WHERE status = 'sent')         AS sent,
          COUNT(*) FILTER (WHERE status = 'failed')       AS failed,
          COUNT(*) FILTER (WHERE status = 'skipped')      AS skipped,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h
        FROM yc_tkt_mgmt.email_logs
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')            AS pending,
          COUNT(*) FILTER (WHERE status = 'failed')             AS failed,
          COUNT(*) FILTER (WHERE status = 'permanently_failed') AS permanently_failed,
          COUNT(*) FILTER (WHERE status = 'sent')               AS sent
        FROM yc_tkt_mgmt.notification_queue
      `),
    ]);

    res.json({
      logs:  logStats.rows[0],
      queue: queueStats.rows[0],
    });
  } catch (err) { next(err); }
});

export default router;
