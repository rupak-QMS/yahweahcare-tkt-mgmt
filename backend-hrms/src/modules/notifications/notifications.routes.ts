// ============================================================
// Notifications routes
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();
router.use(requireAuth);

// GET /notifications — current user's notifications
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM yc_tkt_mgmt.notifications
       WHERE recipient_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.auth!.userId]
    );
    res.json({ notifications: rows });
  } catch (err) { next(err); }
});

// PATCH /notifications/:id/read — mark one read
router.patch('/:id/read', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE yc_tkt_mgmt.notifications SET read_at = NOW(), status = 'read' WHERE id = $1 AND recipient_id = $2`,
      [Number(req.params.id), req.auth!.userId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /notifications/read-all — mark all read
router.post('/read-all', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE yc_tkt_mgmt.notifications SET read_at = NOW(), status = 'read' WHERE recipient_id = $1 AND read_at IS NULL`,
      [req.auth!.userId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /notifications — create (internal use: from ticket events)
router.post('/', async (req, res, next) => {
  try {
    const { recipientId, recipientEmail, ticketId, channel, subject, body } = req.body || {};
    if (!subject || !body || !channel) return res.status(400).json({ error: 'missing_fields' });
    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.notifications (recipient_id, recipient_email, ticket_id, channel, subject, body, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
      [recipientId || null, recipientEmail || null, ticketId || null, channel, subject, body]
    );
    res.status(201).json({ notification: rows[0] });
  } catch (err) { next(err); }
});

export default router;
