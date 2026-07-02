// ============================================================
// Email Routes — Resend API + notification queue
// Uses RESEND_API_KEY env var (set in Vercel)
// RESEND_FROM  env var, e.g. "Yahweahcare <notifications@yourdomain.com>"
//
// Tables auto-created on first run:
//   yc_tkt_mgmt.email_queue  — async email job queue
//   yc_tkt_mgmt.email_logs   — sent/failed history
//
// Routes:
//   GET  /email/config
//   GET  /email/logs
//   GET  /email/queue
//   GET  /email/stats
//   POST /email/test
//   POST /email/retry/:id
//   POST /email/retry-all
// ============================================================

const express = require('express');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM    = process.env.RESEND_FROM || 'Yahweahcare <onboarding@resend.dev>';
const MAX_RETRIES    = 3;

// ── Resend API call ──────────────────────────────────────────
async function resendSend({ to, subject, html }) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: Array.isArray(to) ? to : [to], subject, html }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || json.error || `Resend HTTP ${res.status}`);
  return json;
}

// ── Simple HTML email template ───────────────────────────────
function emailTemplate(subject, bodyText, ticketRef) {
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f9fafb;padding:32px;margin:0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
    <div style="margin-bottom:24px">
      <img src="https://yahweahcare-tkt-mgmt.vercel.app/favicon.svg" width="40" alt="Yahweahcare" style="vertical-align:middle;margin-right:10px" />
      <span style="font-size:18px;font-weight:700;color:#1e293b;vertical-align:middle">Yahweahcare</span>
    </div>
    <h2 style="margin:0 0 16px;font-size:17px;color:#1e293b">${subject}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6">${bodyText.replace(/\n/g, '<br>')}</p>
    ${ticketRef ? `<a href="https://yahweahcare-tkt-mgmt.vercel.app/#tickets" style="display:inline-block;padding:10px 20px;background:#4F46E5;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">View Ticket ${ticketRef}</a>` : ''}
    <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
    <p style="font-size:11px;color:#94a3b8;margin:0">You received this notification from the Yahweahcare Service Desk. Do not reply to this email.</p>
  </div>
</body></html>`;
}

module.exports = function emailRoutes(pool, auth) {
  const router = express.Router();

  // ── Auto-create tables ───────────────────────────────────────
  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.email_logs (
        id              SERIAL PRIMARY KEY,
        recipient_email TEXT NOT NULL,
        subject         TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sent','failed','skipped','permanently_failed')),
        ticket_id       INTEGER,
        sent_at         TIMESTAMPTZ,
        error_message   TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(e => console.error('[email] email_logs create error:', e.message));

    await pool.query(`
      CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.email_queue (
        id              SERIAL PRIMARY KEY,
        event_name      TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        subject         TEXT NOT NULL,
        html_body       TEXT NOT NULL,
        ticket_id       INTEGER,
        status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','sent','failed','permanently_failed')),
        retry_count     INTEGER NOT NULL DEFAULT 0,
        next_retry_at   TIMESTAMPTZ DEFAULT NOW(),
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(e => console.error('[email] email_queue create error:', e.message));

    console.log('✓ Email tables ready');
  }
  ensureTables();

  // ── Internal: process one queue entry ───────────────────────
  async function processQueueEntry(entry) {
    try {
      await pool.query(
        `UPDATE yc_tkt_mgmt.email_queue SET status='processing', updated_at=NOW() WHERE id=$1`,
        [entry.id]
      );
      await resendSend({ to: entry.recipient_email, subject: entry.subject, html: entry.html_body });
      await pool.query(
        `UPDATE yc_tkt_mgmt.email_queue SET status='sent', updated_at=NOW() WHERE id=$1`,
        [entry.id]
      );
      // Log success
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.email_logs (recipient_email, subject, status, ticket_id, sent_at)
         VALUES ($1, $2, 'sent', $3, NOW())
         ON CONFLICT DO NOTHING`,
        [entry.recipient_email, entry.subject, entry.ticket_id || null]
      );
      // Mark push_sent + email_sent on the notifications table if linked
      if (entry.ticket_id) {
        await pool.query(
          `UPDATE yc_tkt_mgmt.notifications SET email_sent=true WHERE ticket_id=$1 AND user_id IN (
             SELECT user_id FROM yc_tkt_mgmt.email_queue WHERE id=$2
           ) AND email_sent=false`,
          [entry.ticket_id, entry.id]
        ).catch(() => {});
      }
      console.log(`[email] sent to ${entry.recipient_email}: ${entry.subject}`);
    } catch (err) {
      const retries = entry.retry_count + 1;
      const permanent = retries >= MAX_RETRIES;
      const nextRetry = new Date(Date.now() + Math.pow(2, retries) * 60000); // exponential backoff
      await pool.query(
        `UPDATE yc_tkt_mgmt.email_queue
         SET status=$1, retry_count=$2, next_retry_at=$3, updated_at=NOW() WHERE id=$4`,
        [permanent ? 'permanently_failed' : 'failed', retries, nextRetry, entry.id]
      );
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.email_logs (recipient_email, subject, status, ticket_id, error_message)
         VALUES ($1, $2, $3, $4, $5)`,
        [entry.recipient_email, entry.subject, permanent ? 'permanently_failed' : 'failed',
         entry.ticket_id || null, err.message]
      ).catch(() => {});
      console.error(`[email] failed (${retries}/${MAX_RETRIES}) to ${entry.recipient_email}:`, err.message);
    }
  }

  // ── Email worker: poll queue every 60s ──────────────────────
  async function runWorker() {
    try {
      const { rows } = await pool.query(`
        SELECT * FROM yc_tkt_mgmt.email_queue
        WHERE status IN ('pending','failed') AND next_retry_at <= NOW() AND retry_count < $1
        ORDER BY created_at ASC LIMIT 20
      `, [MAX_RETRIES]);
      for (const entry of rows) await processQueueEntry(entry);
    } catch (e) { console.error('[email-worker] error:', e.message); }
  }
  // Delay first run 5s — skip in test environment
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(() => { runWorker(); setInterval(runWorker, 60000); }, 5000);
  }

  // ── GET /email/config ────────────────────────────────────────
  router.get('/email/config', (req, res) => {
    res.json({
      configured: !!RESEND_API_KEY,
      from: RESEND_FROM,
    });
  });

  // ── GET /email/logs ──────────────────────────────────────────
  router.get('/email/logs', auth, async (req, res) => {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    const { status, search } = req.query;

    const conditions = [];
    const params = [];
    let i = 1;
    if (status) { conditions.push(`status = $${i++}`); params.push(status); }
    if (search) { conditions.push(`(recipient_email ILIKE $${i} OR subject ILIKE $${i})`); params.push(`%${search}%`); i++; }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    try {
      const [data, count] = await Promise.all([
        pool.query(
          `SELECT * FROM yc_tkt_mgmt.email_logs ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`,
          [...params, limit, offset]
        ),
        pool.query(`SELECT COUNT(*) FROM yc_tkt_mgmt.email_logs ${where}`, params),
      ]);
      res.json({ logs: data.rows, total: parseInt(count.rows[0].count) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /email/queue ─────────────────────────────────────────
  router.get('/email/queue', auth, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT id, event_name, recipient_email, subject, status, retry_count, next_retry_at, created_at
        FROM yc_tkt_mgmt.email_queue
        WHERE status NOT IN ('sent')
        ORDER BY created_at DESC LIMIT 200
      `);
      res.json({ queue: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /email/stats ─────────────────────────────────────────
  router.get('/email/stats', auth, async (req, res) => {
    try {
      const [logStats, queueStats] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*)                                             AS total,
            COUNT(*) FILTER (WHERE status = 'sent')             AS sent,
            COUNT(*) FILTER (WHERE status = 'failed')           AS failed,
            COUNT(*) FILTER (WHERE status = 'skipped')          AS skipped,
            COUNT(*) FILTER (WHERE created_at >= NOW()-'24h'::interval) AS last_24h
          FROM yc_tkt_mgmt.email_logs
        `),
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'pending')               AS pending,
            COUNT(*) FILTER (WHERE status = 'failed')                AS failed,
            COUNT(*) FILTER (WHERE status = 'permanently_failed')    AS permanently_failed
          FROM yc_tkt_mgmt.email_queue
        `),
      ]);
      const l = logStats.rows[0];
      const q = queueStats.rows[0];
      res.json({
        logs: {
          total: parseInt(l.total), sent: parseInt(l.sent), failed: parseInt(l.failed),
          skipped: parseInt(l.skipped), last_24h: parseInt(l.last_24h),
        },
        queue: {
          pending: parseInt(q.pending), failed: parseInt(q.failed),
          permanently_failed: parseInt(q.permanently_failed),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /email/test ─────────────────────────────────────────
  router.post('/email/test', auth, async (req, res) => {
    const to = req.body?.to;
    if (!to) return res.status(400).json({ error: 'to is required' });
    if (!RESEND_API_KEY) {
      return res.status(503).json({
        error: 'RESEND_API_KEY not configured. Add it to Vercel environment variables and redeploy.',
      });
    }
    try {
      const subject  = 'Yahweahcare — Test Email';
      const html     = emailTemplate(subject, 'This is a test email from the Yahweahcare Service Desk.\n\nYour email configuration is working correctly.', null);
      await resendSend({ to, subject, html });
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.email_logs (recipient_email, subject, status, sent_at)
         VALUES ($1, $2, 'sent', NOW())`,
        [to, subject]
      ).catch(() => {});
      res.json({ ok: true });
    } catch (err) {
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.email_logs (recipient_email, subject, status, error_message)
         VALUES ($1, $2, 'failed', $3)`,
        [to, 'Yahweahcare — Test Email', err.message]
      ).catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /email/retry/:id ────────────────────────────────────
  router.post('/email/retry/:id', auth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE yc_tkt_mgmt.email_queue
         SET status='pending', retry_count=0, next_retry_at=NOW(), updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Queue entry not found' });
      // Process immediately
      processQueueEntry(rows[0]).catch(() => {});
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /email/retry-all ────────────────────────────────────
  router.post('/email/retry-all', auth, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        UPDATE yc_tkt_mgmt.email_queue
        SET status='pending', retry_count=0, next_retry_at=NOW(), updated_at=NOW()
        WHERE status IN ('failed','permanently_failed')
        RETURNING *
      `);
      // Fire all in background
      rows.forEach(entry => processQueueEntry(entry).catch(() => {}));
      res.json({ ok: true, processed: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

// ── Exported helper for other route modules ──────────────────
// Usage: await queueEmail(pool, { to, subject, bodyText, ticketId, eventName, ticketRef })
async function queueEmail(pool, { to, subject, bodyText, ticketId, eventName, ticketRef }) {
  if (!to) return;
  try {
    const html = emailTemplate(subject, bodyText, ticketRef || null);
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.email_queue (event_name, recipient_email, subject, html_body, ticket_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [eventName || 'Notification', to, subject, html, ticketId || null]
    );
  } catch (e) {
    console.error('[email] queueEmail error:', e.message);
  }
}

module.exports.queueEmail = queueEmail;
module.exports.emailTemplate = emailTemplate;
