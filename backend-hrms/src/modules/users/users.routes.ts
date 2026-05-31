// ============================================================
// User management routes (admin / HR)
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateEmail } from '../../utils/emailDomain';
import { logAudit } from '../audit/audit.service';

const router = Router();
router.use(requireAuth);

// ── Inline role helpers (no dependency on role_permissions table) ──
const isSuperAdmin = (role: string) => role === 'super_admin';
const isAdminOrAbove = (role: string) => ['super_admin', 'admin'].includes(role);
const isManagerOrAbove = (role: string) => ['super_admin', 'admin', 'manager', 'hr'].includes(role);

// GET /users — list (managers and above can read)
router.get('/', async (req, res, next) => {
  try {
    if (!isManagerOrAbove(req.auth!.role)) return res.status(403).json({ error: 'forbidden', message: 'Insufficient role' });

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
              u.department, u.designation, u.site, u.employee_id,
              u.profile_photo_url, u.bootstrap_admin, u.system_created,
              u.assignable, u.active, u.last_login_at, u.created_at,
              u.position_id, u.manager_id,
              COALESCE(u.is_bootstrap_admin, u.bootstrap_admin, FALSE) AS is_bootstrap_admin,
              COUNT(*) OVER() AS total
       FROM yc_tkt_mgmt.users u
       LEFT JOIN yc_tkt_mgmt.roles r ON r.id = u.role_id
       WHERE ${where.join(' AND ')}
       ORDER BY u.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    res.json({ users: rows.map(({ total: _, ...r }) => r), total });
  } catch (err) { next(err); }
});

// POST /users — create (Super Admin only)
router.post('/', async (req, res, next) => {
  try {
    if (!isSuperAdmin(req.auth!.role)) return res.status(403).json({ error: 'forbidden', message: 'Only Super Admins can create users' });

    const { email, name, roleId, department, designation } = req.body || {};
    const check = validateEmail(email);
    if (!check.valid) return res.status(400).json(check);
    if (!name || !roleId) return res.status(400).json({ error: 'missing_fields', message: 'name and roleId are required' });

    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.users
         (email, name, role_id, department, designation, auth_provider, active,
          role, avatar_initials, system_created)
       SELECT $1, $2, $3, $4, $5, 'microsoft', TRUE, r.name, $6, FALSE
         FROM yc_tkt_mgmt.roles r WHERE r.id = $3
       RETURNING id, email, name, role, department, designation, active`,
      [email.toLowerCase().trim(), name.trim(), Number(roleId), department || null, designation || null,
       (name.trim().split(/\s+/).map((s: string) => s[0]).slice(0, 2).join('') || '?').toUpperCase()]
    );
    if (!rows[0]) return res.status(400).json({ error: 'invalid_role', message: 'Role ID not found' });

    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'user.create', module: 'users', targetType: 'user', targetId: rows[0].id, metadata: { email: rows[0].email }, req });
    res.status(201).json({ user: rows[0] });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') return res.status(409).json({ error: 'duplicate_email', message: 'A user with this email already exists' });
    next(err);
  }
});

// PATCH /users/:id — update (admins and above; managers can edit non-admins)
router.patch('/:id', async (req, res, next) => {
  try {
    if (!isManagerOrAbove(req.auth!.role)) return res.status(403).json({ error: 'forbidden', message: 'Insufficient role' });

    const id = Number(req.params.id);
    const { rows: tRows } = await pool.query(
      `SELECT u.*, r.name AS role_name FROM yc_tkt_mgmt.users u LEFT JOIN yc_tkt_mgmt.roles r ON r.id = u.role_id WHERE u.id = $1`,
      [id]
    );
    const target = tRows[0];
    if (!target) return res.status(404).json({ error: 'not_found' });

    // Only super admins can modify super admins
    if ((target.bootstrap_admin || target.role_name === 'super_admin') && !isSuperAdmin(req.auth!.role)) {
      return res.status(403).json({ error: 'super_admin_modify_blocked', message: 'Only a Super Admin can modify another Super Admin' });
    }

    const allowed = ['name', 'department', 'designation', 'role_id', 'active', 'assignable', 'site', 'employee_id', 'position_id', 'manager_id'];
    const updates: string[] = []; const values: unknown[] = []; let i = 1;
    for (const k of allowed) {
      if (k in req.body) { updates.push(`${k} = $${i++}`); values.push(req.body[k]); }
    }
    if (!updates.length) return res.json({ user: target });

    // Bootstrap admins (Alex & Ron) cannot be demoted or deactivated — ever
    if (target.bootstrap_admin || target.is_bootstrap_admin) {
      if ('role_id' in req.body) {
        return res.status(403).json({ error: 'bootstrap_admin_demote_blocked', message: 'Bootstrap Super Admins cannot be demoted' });
      }
      if ('active' in req.body && req.body.active === false) {
        return res.status(403).json({ error: 'bootstrap_admin_deactivate_blocked', message: 'Bootstrap Super Admins cannot be deactivated' });
      }
    }

    values.push(id);
    const { rows: updRows } = await pool.query(
      `UPDATE yc_tkt_mgmt.users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING id, email, name, role, department, designation, active, role_id, assignable, position_id, manager_id`,
      values
    );

    // ── Keep positions.is_active / is_vacant in sync ──────────────────────
    // When position_id changes, vacate old position, activate new one
    if ('position_id' in req.body) {
      const oldPositionId = target.position_id;
      const newPositionId = req.body.position_id ?? null;
      // Vacate old position only if no other active user still holds it
      if (oldPositionId && oldPositionId !== newPositionId) {
        await pool.query(
          `UPDATE yc_tkt_mgmt.positions
           SET is_active = (EXISTS (
                 SELECT 1 FROM yc_tkt_mgmt.users
                 WHERE position_id = $1 AND active = TRUE AND id != $2
               )),
               is_vacant = NOT (EXISTS (
                 SELECT 1 FROM yc_tkt_mgmt.users
                 WHERE position_id = $1 AND active = TRUE AND id != $2
               )),
               updated_at = NOW()
           WHERE id = $1`,
          [oldPositionId, id]
        );
      }
      // Activate new position
      if (newPositionId) {
        await pool.query(
          `UPDATE yc_tkt_mgmt.positions
           SET is_active = TRUE, is_vacant = FALSE, updated_at = NOW()
           WHERE id = $1`,
          [newPositionId]
        );
      }
    }
    // When user is deactivated, vacate their current position
    if ('active' in req.body && req.body.active === false && target.position_id) {
      await pool.query(
        `UPDATE yc_tkt_mgmt.positions
         SET is_active = (EXISTS (
               SELECT 1 FROM yc_tkt_mgmt.users
               WHERE position_id = $1 AND active = TRUE AND id != $2
             )),
             is_vacant = NOT (EXISTS (
               SELECT 1 FROM yc_tkt_mgmt.users
               WHERE position_id = $1 AND active = TRUE AND id != $2
             )),
             updated_at = NOW()
         WHERE id = $1`,
        [target.position_id, id]
      );
    }
    // ─────────────────────────────────────────────────────────────────────

    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'user.update', module: 'users', targetType: 'user', targetId: id, metadata: { changes: req.body }, req });
    res.json({ user: updRows[0] });
  } catch (err) { next(err); }
});

// DELETE /users/:id — super admin only
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isSuperAdmin(req.auth!.role)) return res.status(403).json({ error: 'forbidden', message: 'Only Super Admins can delete users' });

    const id = Number(req.params.id);
    if (id === req.auth!.userId) return res.status(403).json({ error: 'cannot_delete_self', message: 'You cannot delete your own account' });

    const { rows } = await pool.query(`SELECT bootstrap_admin FROM yc_tkt_mgmt.users WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    if (rows[0].bootstrap_admin) return res.status(403).json({ error: 'bootstrap_admin_delete_blocked', message: 'Bootstrap admin accounts cannot be deleted' });

    await pool.query(`DELETE FROM yc_tkt_mgmt.users WHERE id = $1`, [id]);
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'user.delete', module: 'users', targetType: 'user', targetId: id, req });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
