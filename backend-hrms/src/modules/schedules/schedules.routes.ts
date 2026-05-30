// ============================================================
// Scheduled Reports routes (admin + manager)
// DB column: time_of_day  (matches existing Neon DB table)
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { logAudit } from '../audit/audit.service';

const router = Router();
router.use(requireAuth);

const isManagerOrAdmin = (role: string) => ['super_admin', 'manager'].includes(role);

// GET /schedules
router.get('/', async (req, res, next) => {
  try {
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
    const role = req.auth!.role;
    if (!isManagerOrAdmin(role)) return res.status(403).json({ error: 'forbidden' });
    const { name, description, frequency, day_of_week, day_of_month, time, report_types, recipient_ids } = req.body || {};
    if (!name || !frequency || !time) return res.status(400).json({ error: 'missing_fields', message: 'name, frequency and time are required' });
    if (!['daily','weekly','monthly'].includes(frequency)) return res.status(400).json({ error: 'invalid_frequency' });

    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.scheduled_reports
         (name, description, frequency, day_of_week, day_of_month, time_of_day, report_types, recipient_ids, active, created_by)
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
    const id = Number(req.params.id);
    const role = req.auth!.role;
    if (!isManagerOrAdmin(role)) return res.status(403).json({ error: 'forbidden' });
    const { rows: existing } = await pool.query(`SELECT * FROM yc_tkt_mgmt.scheduled_reports WHERE id = $1`, [id]);
    if (!existing[0]) return res.status(404).json({ error: 'not_found' });
    if (role !== 'super_admin' && existing[0].created_by !== req.auth!.userId) {
      return res.status(403).json({ error: 'not_owner', message: 'You can only edit schedules you created.' });
    }

    // Map frontend field names → DB column names
    const fieldMap: Record<string, string> = {
      name: 'name', description: 'description', frequency: 'frequency',
      day_of_week: 'day_of_week', day_of_month: 'day_of_month',
      time: 'time_of_day',   // frontend sends 'time', DB column is 'time_of_day'
      report_types: 'report_types', recipient_ids: 'recipient_ids', active: 'active',
    };
    const updates: string[] = []; const values: unknown[] = []; let i = 1;
    for (const [k, dbCol] of Object.entries(fieldMap)) {
      if (k in req.body) { updates.push(`${dbCol} = $${i++}`); values.push(req.body[k]); }
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
    const id = Number(req.params.id);
    const role = req.auth!.role;
    if (!isManagerOrAdmin(role)) return res.status(403).json({ error: 'forbidden' });
    const { rows } = await pool.query(`SELECT * FROM yc_tkt_mgmt.scheduled_reports WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    if (role !== 'super_admin' && rows[0].created_by !== req.auth!.userId) {
      return res.status(403).json({ error: 'not_owner' });
    }
    await pool.query(`DELETE FROM yc_tkt_mgmt.scheduled_reports WHERE id = $1`, [id]);
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'schedule.delete', module: 'schedules', targetType: 'schedule', targetId: id, req });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /schedules/:id/send
router.post('/:id/send', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!isManagerOrAdmin(req.auth!.role)) return res.status(403).json({ error: 'forbidden' });
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
    time: row.time_of_day || row.time,   // support both column names
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
