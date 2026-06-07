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
