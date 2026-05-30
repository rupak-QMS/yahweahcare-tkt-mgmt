// ============================================================
// Scheduled Reports routes (admin + manager)
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { logAudit } from '../audit/audit.service';

const router = Router();
router.use(requireAuth);

const isManagerOrAdmin = (role: string) => ['super_admin', 'manager'].includes(role);

// ── Ensure table exists on first request (idempotent) ──────
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.scheduled_reports (
      id              SERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT,
      frequency       TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
      day_of_week     TEXT,
      day_of_month    INTEGER,
      time            TEXT NOT NULL,
      report_types    TEXT[] NOT NULL DEFAULT '{}',
      recipient_ids   INTEGER[] NOT NULL DEFAULT '{}',
      active          BOOLEAN NOT NULL DEFAULT TRUE,
      sent_count      INTEGER NOT NULL DEFAULT 0,
      last_sent_at    TIMESTAMPTZ,
      created_by      INTEGER REFERENCES yc_tkt_mgmt.users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sr_created_by ON yc_tkt_mgmt.scheduled_reports(created_by)`);
  tableReady = true;
}

// GET /schedules — list (admins see all; managers see own)
router.get('/', async (req, res, next) => {
  try {
    await ensureTable();
    const role = req.auth!.role;
    if (!isManagerOrAdmin(role)) return res.status(403).json({ error: 'forbidden' });

    const { rows } = role === 'super_admin'
      ? await pool.query(`SELECT * FROM yc_tkt_mgmt.scheduled_reports ORDER BY created_at DESC`)
      : await pool.query(`SELECT * FROM yc_tkt_mgmt.scheduled_reports WHERE created_by = $1 ORDER BY created_at DESC`, [req.auth!.userId]);

    res.json({ schedules: rows.map(dbToFrontend) });
  } catch (err) { next(err); }
});

// POST /schedules — create
router.post('/', async (req, res, next) => {
  try {
    await ensureTable();
    const role = req.auth!.role;
    if (!isManagerOrAdmin(role)) return res.status(403).json({ error: 'forbidden' });

    const { name, description, frequency, day_of_week, day_of_month, time, report_types, recipient_ids } = req.body || {};
    if (!name || !frequency || !time) return res.status(400).json({ error: 'missing_fields', message: 'name, frequency and time are required' });
    if (!['daily','weekly','monthly'].includes(frequency)) return res.status(400).json({ error: 'invalid_frequency' });

    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.scheduled_reports
         (name, description, frequency, day_of_week, day_of_month, time, report_types, recipient_ids, active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9)
       RETURNING *`,
      [name, description || null, frequency, day_of_week || null, day_of_month || null, time,
       report_types || [], recipient_ids || [], req.auth!.userId]
    );
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'schedule.create', module: 'schedules', targetType: 'schedule', targetId: rows[0].id, metadata: { name }, req });
    res.status(201).json({ schedule: dbToFrontend(rows[0]) });
  } catch (err) { next(err); }
});

// PATCH /schedules/:id — update
router.patch('/:id', async (req, res, next) => {
  try {
    await ensureTable();
    const id = Number(req.params.id);
    const role = req.auth!.role;
    if (!isManagerOrAdmin(role)) return res.status(403).json({ error: 'forbidden' });

    const { rows: existing } = await pool.query(`SELECT * FROM yc_tkt_mgmt.scheduled_reports WHERE id = $1`, [id]);
    if (!existing[0]) return res.status(404).json({ error: 'not_found' });
    // Managers can only edit their own
    if (role !== 'super_admin' && existing[0].created_by !== req.auth!.userId) {
      return res.status(403).json({ error: 'not_owner', message: 'You can only edit schedules you created.' });
    }

    const allowed = ['name','description','frequency','day_of_week','day_of_month','time','report_types','recipient_ids','active'];
    const updates: string[] = []; const values: unknown[] = []; let i = 1;
    for (const k of allowed) {
      if (k in req.body) { updates.push(`${k} = $${i++}`); values.push(req.body[k]); }
    }
    if (!updates.length) return res.json({ schedule: dbToFrontend(existing[0]) });

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE yc_tkt_mgmt.scheduled_reports SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      values
    );
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'schedule.update', module: 'schedules', targetType: 'schedule', targetId: id, metadata: req.body, req });
    res.json({ schedule: dbToFrontend(rows[0]) });
  } catch (err) { next(err); }
});

// DELETE /schedules/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await ensureTable();
    const id = Number(req.params.id);
    const role = req.auth!.role;
    if (!isManagerOrAdmin(role)) return res.status(403).json({ error: 'forbidden' });

    const { rows } = await pool.query(`SELECT * FROM yc_tkt_mgmt.scheduled_reports WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    if (role !== 'super_admin' && rows[0].created_by !== req.auth!.userId) {
      return res.status(403).json({ error: 'not_owner', message: 'You can only delete schedules you created.' });
    }

    await pool.query(`DELETE FROM yc_tkt_mgmt.scheduled_reports WHERE id = $1`, [id]);
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'schedule.delete', module: 'schedules', targetType: 'schedule', targetId: id, req });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /schedules/:id/send — record a manual send
router.post('/:id/send', async (req, res, next) => {
  try {
    await ensureTable();
    const id = Number(req.params.id);
    const role = req.auth!.role;
    if (!isManagerOrAdmin(role)) return res.status(403).json({ error: 'forbidden' });

    const { rows } = await pool.query(
      `UPDATE yc_tkt_mgmt.scheduled_reports SET last_sent_at = NOW(), sent_count = sent_count + 1, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'schedule.send_now', module: 'schedules', targetType: 'schedule', targetId: id, req });
    res.json({ schedule: dbToFrontend(rows[0]) });
  } catch (err) { next(err); }
});

// ── DB row → frontend shape ─────────────────────────────────
function dbToFrontend(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description || '',
    frequency: row.frequency,
    dayOfWeek: row.day_of_week || 'Monday',
    dayOfMonth: row.day_of_month || 1,
    time: row.time,
    reportTypes: row.report_types || [],
    recipientIds: (row.recipient_ids as number[] || []).map(String),
    active: row.active,
    sentCount: row.sent_count || 0,
    lastSentAt: row.last_sent_at || null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
