// ============================================================
// Audit log read routes
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { logAudit } from './audit.service';

const router = Router();
router.use(requireAuth);

// GET /audit-logs — filterable, paginated audit list
router.get('/', requirePermission('audit.read'), async (req, res) => {
  const limit  = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const action = (req.query.action as string) || null;
  const module = (req.query.module as string) || null;
  const since  = (req.query.since  as string) || null;
  const until  = (req.query.until  as string) || null;
  const search = (req.query.search as string) || null;

  const where: string[] = ['1=1']; const params: unknown[] = []; let i = 1;
  if (userId) { where.push(`a.user_id = $${i++}`); params.push(userId); }
  if (action) { where.push(`a.action  = $${i++}`); params.push(action); }
  if (module) { where.push(`a.module  = $${i++}`); params.push(module); }
  if (since)  { where.push(`a.created_at >= $${i++}`); params.push(since); }
  if (until)  { where.push(`a.created_at <= $${i++}`); params.push(until); }
  if (search) {
    // Free-text search across actor email, action, module, target type, and
    // the joined user's name — powers the Activity Log page's search box.
    where.push(`(a.actor_email ILIKE $${i} OR a.action ILIKE $${i} OR a.module ILIKE $${i} OR a.target_type ILIKE $${i} OR u.name ILIKE $${i})`);
    params.push(`%${search}%`);
    i++;
  }

  const { rows } = await pool.query(
    `SELECT a.id, a.user_id, a.actor_email, a.action, a.module, a.target_type, a.target_id,
            a.metadata, a.ip_address, a.user_agent, a.success, a.created_at,
            u.name AS user_name, COUNT(*) OVER() AS total
       FROM yc_tkt_mgmt.audit_logs a
       LEFT JOIN yc_tkt_mgmt.users u ON u.id = a.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  res.json({ entries: rows.map(({ total: _, ...r }) => r), total });
});

// GET /audit-logs/export — CSV (Super Admin gated)
router.get('/export', requirePermission('audit.export'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.user_id, a.actor_email, a.action, a.module, a.target_type, a.target_id,
            a.ip_address, a.user_agent, a.success, a.created_at, a.metadata
     FROM yc_tkt_mgmt.audit_logs a
     ORDER BY a.created_at DESC
     LIMIT 50000`
  );
  await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'audit.export', module: 'audit', metadata: { rows: rows.length }, req });
  const header = ['id','user_id','actor_email','action','module','target_type','target_id','ip','user_agent','success','created_at','metadata'];
  const csv = [header, ...rows.map(r => header.map(h => {
    const val = (r as Record<string, unknown>)[h === 'ip' ? 'ip_address' : h];
    const s = val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
    return `"${s.replace(/"/g, '""')}"`;
  }))].map(r => r.join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

export default router;
