// ============================================================
// Vercel serverless function — wraps the Express app
// ============================================================
//
// Vercel routes every request matching the rewrite rule in vercel.json
// through this single function. Express handles routing internally.
//
// Cold start is ~150-300ms after first request; subsequent requests
// reuse the warm function instance for ~5-15 min.

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { env } from '../src/config/env';
import { apiLimiter } from '../src/middleware/rateLimit.middleware';
import { errorHandler, notFound } from '../src/middleware/error.middleware';

import authRoutes          from '../src/modules/auth/auth.routes';
import userRoutes          from '../src/modules/users/users.routes';
import roleRoutes          from '../src/modules/roles/roles.routes';
import auditRoutes         from '../src/modules/audit/audit.routes';
import scheduleRoutes      from '../src/modules/schedules/schedules.routes';
import ticketRoutes        from '../src/modules/tickets/tickets.routes';
import notificationRoutes  from '../src/modules/notifications/notifications.routes';
import pushRoutes          from '../src/modules/notifications/push.routes';
import lookupRoutes        from '../src/modules/lookup/lookup.routes';
import orgRoutes           from '../src/modules/org/org.routes';
import { pool }            from '../src/db/pool';
import { sendEmail, buildSlaBreachHtml, type SlaBreachTicket } from '../src/modules/notifications/email.service';
import { ensureEmailTables } from '../src/services/email/email.migrate';
import { processQueue }      from '../src/services/email/email.queue';
import { sendOverdueReminders, sendDueTomorrowReminders } from '../src/services/email/notification.service';
import emailAdminRoutes      from '../src/modules/email/email.routes';

// Ensure email tables exist on first cold start (idempotent)
ensureEmailTables().catch((e) => console.error('[startup] ensureEmailTables:', e));

// Build the Express app ONCE per cold start
const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(env.SESSION_SECRET));

// Health probe — bypass rate limit
app.get('/health', async (_req, res) => {
  const { pool } = await import('../src/db/pool');
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString(), runtime: 'vercel' });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
});

app.use('/auth',          apiLimiter);
app.use('/users',         apiLimiter);
app.use('/roles',         apiLimiter);
app.use('/audit-logs',    apiLimiter);
app.use('/tickets',       apiLimiter);
app.use('/schedules',     apiLimiter);
app.use('/notifications', apiLimiter);
app.use('/push',          apiLimiter);
app.use('/lookup',        apiLimiter);

app.use('/auth',          authRoutes);
app.use('/users',         userRoutes);
app.use('/roles',         roleRoutes);
app.use('/audit-logs',    auditRoutes);
app.use('/tickets',       ticketRoutes);
app.use('/schedules',     scheduleRoutes);
app.use('/notifications', notificationRoutes);
app.use('/push',          pushRoutes);
app.use('/lookup',        lookupRoutes);
app.use('/org',           orgRoutes);
app.use('/email',         apiLimiter);
app.use('/email',         emailAdminRoutes);

// ── SLA breach cron — called by Vercel Cron daily ─────────
// Secured by CRON_SECRET header to prevent public access.
app.post('/cron/sla-check', async (req, res) => {
  // Verify cron secret
  const secret = env.CRON_SECRET;
  const provided = req.headers['x-cron-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  if (secret && provided !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    // Find tickets past their due date that haven't been alerted yet
    const { rows: breached } = await pool.query(`
      SELECT t.id, t.title, t.due_date, t.category_id, t.priority_id,
             c.name AS category_name,
             COALESCE(u.name, 'Unassigned') AS assignee_name,
             EXTRACT(DAY FROM NOW() - t.due_date)::int AS days_overdue
        FROM yc_tkt_mgmt.tickets t
        LEFT JOIN yc_tkt_mgmt.categories c ON c.id = t.category_id
        LEFT JOIN yc_tkt_mgmt.users u ON u.id = t.assignee_id
       WHERE t.due_date < NOW()
         AND t.status NOT IN ('resolved', 'closed')
         AND (t.sla_breach_alerted_at IS NULL OR t.sla_breach_alerted_at < NOW() - INTERVAL '24 hours')
       ORDER BY t.due_date ASC
       LIMIT 100
    `);

    if (!breached.length) {
      return res.json({ ok: true, alerted: 0 });
    }

    // Get admin + director emails
    const { rows: adminRows } = await pool.query(`
      SELECT DISTINCT u.email
        FROM yc_tkt_mgmt.users u
        LEFT JOIN yc_tkt_mgmt.staff_positions sp ON sp.user_id = u.id AND sp.is_primary = TRUE
        LEFT JOIN yc_tkt_mgmt.positions p ON p.id = sp.position_id
       WHERE u.is_active = TRUE
         AND u.email IS NOT NULL
         AND (u.is_bootstrap_admin = TRUE
              OR LOWER(COALESCE(p.position_type,'')) = 'director'
              OR u.role IN ('super_admin', 'admin', 'hr'))
    `);
    const alertEmails: string[] = adminRows.map((r: { email: string }) => r.email).filter(Boolean);

    if (alertEmails.length) {
      const tickets: SlaBreachTicket[] = breached.map((r: Record<string, unknown>) => ({
        id:          r.id as number,
        title:       String(r.title || `Ticket #${r.id}`),
        assigneeName:String(r.assignee_name || 'Unassigned'),
        daysOverdue: Number(r.days_overdue) || 1,
        priority:    String(r.priority_id || 'Normal'),
        category:    String(r.category_name || r.category_id || 'General'),
      }));

      const html = buildSlaBreachHtml(tickets);
      await sendEmail(
        alertEmails,
        `⚠️ SLA Breach Alert — ${tickets.length} ticket${tickets.length !== 1 ? 's' : ''} overdue`,
        html,
      );
    }

    // Mark tickets as alerted (add column if it doesn't exist)
    await pool.query(`
      ALTER TABLE yc_tkt_mgmt.tickets
        ADD COLUMN IF NOT EXISTS sla_breach_alerted_at TIMESTAMPTZ
    `).catch(() => {}); // ignore if already exists

    const breachedIds = breached.map((r: Record<string, unknown>) => r.id);
    await pool.query(
      `UPDATE yc_tkt_mgmt.tickets SET sla_breach_alerted_at = NOW() WHERE id = ANY($1)`,
      [breachedIds]
    );

    res.json({ ok: true, alerted: breached.length, emailsSent: alertEmails.length });
  } catch (err) {
    console.error('[cron/sla-check]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Email queue retry cron — every 5 minutes ──────────────
app.post('/cron/email-retry', async (req, res) => {
  const secret   = env.CRON_SECRET;
  const provided = req.headers['x-cron-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  if (secret && provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  try {
    const result = await processQueue();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/email-retry]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Due-tomorrow reminders — daily 7am ────────────────────
app.post('/cron/due-tomorrow', async (req, res) => {
  const secret   = env.CRON_SECRET;
  const provided = req.headers['x-cron-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  if (secret && provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  try {
    await sendDueTomorrowReminders();
    res.json({ ok: true });
  } catch (err) {
    console.error('[cron/due-tomorrow]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Enhanced SLA overdue cron (replaces old standalone send) ──
// The existing /cron/sla-check still runs the admin digest;
// this new endpoint sends per-assignee overdue reminders via queue.
app.post('/cron/overdue-reminders', async (req, res) => {
  const secret   = env.CRON_SECRET;
  const provided = req.headers['x-cron-secret'] || req.headers['authorization']?.replace('Bearer ', '');
  if (secret && provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  try {
    await sendOverdueReminders();
    res.json({ ok: true });
  } catch (err) {
    console.error('[cron/overdue-reminders]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.use(notFound);
app.use(errorHandler);

// Vercel serverless handler — adapts Express to Vercel's request/response interface
export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as unknown as express.Request, res as unknown as express.Response);
}
