// ============================================================
// User management routes (admin / HR)
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { validateEmail } from '../../utils/emailDomain';
import { logAudit } from '../audit/audit.service';

const router = Router();
router.use(requireAuth);

// GET /users — list (with pagination + search)
router.get('/', requirePermission('user.read'), async (req, res) => {
  const limit  = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const q      = (req.query.q as string || '').trim().toLowerCase();
  const dept   = (req.query.department as string || '').trim();
  const role   = (req.query.role as string || '').trim();
  const status = (req.query.status as string || '').trim();

  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  let i = 1;
  if (q)      { where.push(`(LOWER(u.name) LIKE $${i} OR LOWER(u.email) LIKE $${i})`); params.push(`%${q}%`); i++; }
  if (dept)   { where.push(`u.department = $${i++}`); params.push(dept); }
  if (role)   { where.push(`r.name = $${i++}`);       params.push(role); }
  if (status === 'active')   where.push('u.active = TRUE');
  else if (status === 'inactive') where.push('u.active = FALSE');

  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, r.name AS role, r.display_name AS role_label,
            u.department, u.designation, u.profile_photo_url, u.bootstrap_admin, u.bootstrap_admin,
            u.active, u.last_login_at, u.created_at, COUNT(*) OVER() AS total
     FROM yc_tkt_mgmt.users u
     LEFT JOIN yc_tkt_mgmt.roles r ON r.id = u.role_id
     WHERE ${where.join(' AND ')}
     ORDER BY u.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  res.json({ users: rows.map(({ total: _, ...r }) => r), total });
});

// POST /users — create (Super Admin only via permission)
router.post('/', requirePermission('user.create'), async (req, res) => {
  const { email, name, roleId, department, designation } = req.body || {};
  const check = validateEmail(email);
  if (!check.valid) return res.status(400).json(check);
  if (!name || !roleId) return res.status(400).json({ error: 'missing_fields', message: 'name and roleId are required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.users
         (email, name, role_id, department, designation, auth_provider, active,
          role, avatar_initials, system_created)
       SELECT $1, $2, $3, $4, $5, 'microsoft', TRUE, r.name, $6, FALSE
         FROM yc_tkt_mgmt.roles r WHERE r.id = $3
       RETURNING id, email, name, role, department, designation, active`,
      [email.toLowerCase().trim(), name.trim(), roleId, department || null, designation || null,
       (name.trim().split(/\s+/).map((s: string) => s[0]).slice(0, 2).join('') || '?').toUpperCase()]
    );
    if (!rows[0]) return res.status(400).json({ error: 'invalid_role' });
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'user.create', module: 'users', targetType: 'user', targetId: rows[0].id, metadata: { email: rows[0].email }, req });
    res.status(201).json({ user: rows[0] });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') return res.status(409).json({ error: 'duplicate_email' });
    throw err;
  }
});

// PATCH /users/:id — update (role changes audited; Super Admin protection)
router.patch('/:id', requirePermission('user.update'), async (req, res) => {
  const id = Number(req.params.id);
  const { rows: tRows } = await pool.query(
    `SELECT u.*, r.name AS role_name FROM yc_tkt_mgmt.users u LEFT JOIN yc_tkt_mgmt.roles r ON r.id = u.role_id WHERE u.id = $1`,
    [id]
  );
  const target = tRows[0];
  if (!target) return res.status(404).json({ error: 'not_found' });

  // Only another super admin can modify a super admin
  if (target.bootstrap_admin && req.auth!.role !== 'super_admin') {
    return res.status(403).json({ error: 'super_admin_modify_blocked' });
  }
  if (target.role_name === 'super_admin' && req.auth!.role !== 'super_admin') {
    return res.status(403).json({ error: 'super_admin_modify_blocked' });
  }

  const allowed = ['name', 'department', 'designation', 'role_id', 'active'];
  const updates: string[] = []; const values: unknown[] = []; let i = 1;
  for (const k of allowed) {
    if (k in req.body) { updates.push(`${k} = $${i++}`); values.push(req.body[k]); }
  }
  if (!updates.length) return res.json({ user: target });

  // Prevent downgrading the LAST active super admin
  if ('role_id' in req.body && target.bootstrap_admin) {
    return res.status(403).json({ error: 'bootstrap_admin_demote_blocked', message: 'Bootstrap super admins cannot be demoted.' });
  }
  if ('role_id' in req.body && target.role_name === 'super_admin') {
    const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM yc_tkt_mgmt.users WHERE role_id IN (SELECT id FROM yc_tkt_mgmt.roles WHERE name='super_admin') AND active = TRUE`);
    if (cnt[0].n <= 1) return res.status(403).json({ error: 'last_super_admin', message: 'Cannot demote the last active Super Admin.' });
  }

  values.push(id);
  const { rows: updRows } = await pool.query(
    `UPDATE yc_tkt_mgmt.users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING id, email, name, role, department, designation, active, role_id`,
    values
  );
  await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'user.update', module: 'users', targetType: 'user', targetId: id, metadata: { changes: req.body }, req });
  res.json({ user: updRows[0] });
});

// DELETE /users/:id — admin only; bootstrap admins protected
router.delete('/:id', requirePermission('user.delete'), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.auth!.userId) return res.status(403).json({ error: 'cannot_delete_self' });
  const { rows } = await pool.query(`SELECT bootstrap_admin, is_admin FROM yc_tkt_mgmt.users WHERE id = $1`, [id]);
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  if (rows[0].bootstrap_admin) return res.status(403).json({ error: 'bootstrap_admin_delete_blocked' });
  await pool.query(`DELETE FROM yc_tkt_mgmt.users WHERE id = $1`, [id]);
  await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'user.delete', module: 'users', targetType: 'user', targetId: id, req });
  res.json({ ok: true });
});

export default router;
