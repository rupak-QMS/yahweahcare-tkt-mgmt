// ============================================================
// Lookup routes — categories, priorities, statuses
// These are reference/seed tables; read-only from the API.
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();
router.use(requireAuth);

// GET /lookup/categories
router.get('/categories', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, label, icon, sort_order FROM yc_tkt_mgmt.categories ORDER BY sort_order`
    );
    res.json({ categories: rows });
  } catch (err) { next(err); }
});

// GET /lookup/priorities
router.get('/priorities', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, label, sla_hours, sort_order FROM yc_tkt_mgmt.priorities ORDER BY sort_order`
    );
    res.json({ priorities: rows });
  } catch (err) { next(err); }
});

// GET /lookup/statuses
router.get('/statuses', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, label, sort_order, is_closed FROM yc_tkt_mgmt.statuses ORDER BY sort_order`
    );
    res.json({ statuses: rows });
  } catch (err) { next(err); }
});

export default router;
