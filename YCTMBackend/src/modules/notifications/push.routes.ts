// ============================================================
// Push subscription routes
//   GET  /push/vapid-public-key  — returns the public VAPID key
//   POST /push/subscribe         — save a push subscription
//   POST /push/unsubscribe       — remove a push subscription
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { ensurePushTable } from './notifications.service';
import { notify } from './notifications.service';

const router = Router();

// Public key endpoint (unauthenticated — needed before login cookie exists)
router.get('/vapid-public-key', (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY || '';
  if (!key) return res.status(503).json({ error: 'push_not_configured' });
  res.json({ publicKey: key });
});

// All subscription routes require auth
router.use(requireAuth);

// POST /push/subscribe
router.post('/subscribe', async (req, res, next) => {
  try {
    await ensurePushTable();
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'invalid_subscription' });
    }
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = $3, auth = $4`,
      [req.auth!.userId, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /push/test — send a demo push + in-app notification to the current user
router.post('/test', async (req, res, next) => {
  try {
    await ensurePushTable();
    const userId = req.auth!.userId;
    const email  = req.auth!.email;

    // Pick a random demo scenario
    const demos = [
      { subject: 'New Ticket Created', body: 'A new support ticket has been submitted for IT Support.' },
      { subject: 'Ticket Escalated ⬆️', body: 'Ticket #999 has been escalated and requires urgent attention.' },
      { subject: 'Ticket Resolved ✅', body: 'Ticket #998 — "Network Issue" has been marked as resolved.' },
      { subject: 'Status Updated', body: 'Ticket #997 status changed to In Progress.' },
      { subject: 'New Team Member 👤', body: 'A new staff member has been added to the Operations team.' },
    ];
    const demo = demos[Math.floor(Math.random() * demos.length)];

    // Insert in-app notification
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.notifications (recipient_id, recipient_email, channel, subject, body, status)
       VALUES ($1, $2, 'push', $3, $4, 'pending')`,
      [userId, email, demo.subject, demo.body]
    );

    // Send web push if subscribed
    const { rows: subs } = await pool.query(
      `SELECT endpoint, p256dh, auth FROM yc_tkt_mgmt.push_subscriptions WHERE user_id = $1`,
      [userId]
    );

    let pushSent = 0;
    if (subs.length > 0) {
      const webpush = await import('web-push');
      const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
      const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
      const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:admin@yahwehcare.com.au';
      if (VAPID_PUBLIC && VAPID_PRIVATE) {
        webpush.default.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
        for (const sub of subs) {
          try {
            await webpush.default.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({ title: `Yahwehcare: ${demo.subject}`, body: demo.body, icon: '/favicon.svg', badge: '/favicon.svg' }),
              { TTL: 3600 }
            );
            pushSent++;
          } catch { /* ignore expired/invalid subs */ }
        }
      }
    }

    res.json({ ok: true, subject: demo.subject, body: demo.body, pushSent, inAppInserted: true });
  } catch (err) { next(err); }
});

// POST /push/unsubscribe
router.post('/unsubscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'missing_endpoint' });
    await pool.query(
      `DELETE FROM yc_tkt_mgmt.push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
      [req.auth!.userId, endpoint]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
