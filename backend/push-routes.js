// ============================================================
// Push Notification Routes
// GET  /push/vapid-public-key  — returns VAPID public key (no auth)
// POST /push/subscribe          — upsert browser subscription (auth)
// POST /push/test               — send test push to current user (auth)
// ============================================================

const webpush = require('web-push');

module.exports = function pushRoutes(pool, auth) {
  const router = require('express').Router();

  // Configure VAPID keys
  const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT     = process.env.VAPID_SUBJECT || 'mailto:admin@yahweahcare.com';

  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('✓ Web Push VAPID configured');
  } else {
    console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications disabled');
  }

  // Auto-create push_subscriptions table if it doesn't exist
  pool.query(`
    CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.push_subscriptions (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      endpoint    TEXT NOT NULL UNIQUE,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(err => console.error('[push] Failed to create push_subscriptions table:', err.message));

  // ── GET /push/vapid-public-key ──────────────────────────────
  // Unauthenticated — browser needs this before subscribing
  router.get('/push/vapid-public-key', (req, res) => {
    if (!VAPID_PUBLIC_KEY) {
      return res.status(503).json({ error: 'Push notifications not configured on server' });
    }
    res.json({ publicKey: VAPID_PUBLIC_KEY });
  });

  // ── POST /push/subscribe ────────────────────────────────────
  // Saves/updates a browser push subscription for the current user
  router.post('/push/subscribe', auth, async (req, res) => {
    if (!VAPID_PUBLIC_KEY) {
      return res.status(503).json({ error: 'Push notifications not configured' });
    }
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription payload' });
    }
    try {
      // Upsert: update keys if endpoint already exists, insert otherwise
      await pool.query(`
        INSERT INTO yc_tkt_mgmt.push_subscriptions (user_id, endpoint, p256dh, auth, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (endpoint) DO UPDATE
          SET user_id    = EXCLUDED.user_id,
              p256dh     = EXCLUDED.p256dh,
              auth       = EXCLUDED.auth,
              updated_at = NOW()
      `, [req.user.id, endpoint, keys.p256dh, keys.auth]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[push] subscribe error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /push/test ─────────────────────────────────────────
  // Sends a test push notification to all subscriptions for the current user
  router.post('/push/test', auth, async (req, res) => {
    if (!VAPID_PUBLIC_KEY) {
      return res.status(503).json({ error: 'Push notifications not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel env vars.' });
    }
    try {
      const { rows } = await pool.query(
        'SELECT endpoint, p256dh, auth FROM yc_tkt_mgmt.push_subscriptions WHERE user_id = $1',
        [req.user.id]
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'No push subscription found for your account. Please allow notifications first.' });
      }
      const payload = JSON.stringify({
        title: 'Yahweahcare — Test Notification',
        body:  '🔔 Push notifications are working!',
        icon:  '/favicon.svg',
        data:  { url: '/' },
      });
      const results = await Promise.allSettled(
        rows.map(sub =>
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          ).catch(async err => {
            // 410 Gone = subscription expired — remove it
            if (err.statusCode === 410) {
              await pool.query('DELETE FROM yc_tkt_mgmt.push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
            }
            throw err;
          })
        )
      );
      const sent     = results.filter(r => r.status === 'fulfilled').length;
      const failed   = results.filter(r => r.status === 'rejected').length;
      res.json({ ok: true, sent, failed });
    } catch (err) {
      console.error('[push] test error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

// ── Helper exported for use in other route files ─────────────
// Usage: await sendPushToUser(pool, userId, { title, body, data })
async function sendPushToUser(pool, userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    const { rows } = await pool.query(
      'SELECT endpoint, p256dh, auth FROM yc_tkt_mgmt.push_subscriptions WHERE user_id = $1',
      [userId]
    );
    const msg = typeof payload === 'string' ? payload : JSON.stringify({ icon: '/favicon.svg', ...payload });
    await Promise.allSettled(
      rows.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          msg
        ).catch(async err => {
          if (err.statusCode === 410) {
            await pool.query('DELETE FROM yc_tkt_mgmt.push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
          }
        })
      )
    );
  } catch (e) {
    console.error('[push] sendPushToUser error:', e.message);
  }
}

module.exports.sendPushToUser = sendPushToUser;
