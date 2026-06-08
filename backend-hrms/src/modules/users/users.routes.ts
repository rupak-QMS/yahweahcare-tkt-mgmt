// ============================================================
// User management routes (admin / HR)
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth, optionalAuth } from '../../middleware/auth.middleware';
import { validateEmail } from '../../utils/emailDomain';
import { logAudit } from '../audit/audit.service';
import { notify } from '../notifications/notifications.service';

const router = Router();

const isSuperAdmin = (role: string) => role === 'super_admin';
const isAdminOrAbove = (role: string) => ['super_admin', 'admin'].includes(role);
const isManagerOrAbove = (role: string) => ['super_admin', 'admin', 'manager', 'hr'].includes(role);

// GET /users — returns all users with their department and position via correlated subquery
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const limit  = Math.min(Number(req.query.limit) || 100, 200);
    const offset = Number(req.query.offset) || 0;
    const q      = (req.query.q as string || '').trim().toLowerCase();
    const status = (req.query.status as string || '').trim();
    const deptId = req.query.dept_id ? Number(req.query.dept_id) : null;
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let pi = 1;
    if (q) {
      where.push('(LOWER(u.name) LIKE $' + pi + ' OR LOWER(u.email) LIKE $' + pi + ')');
      params.push('%' + q + '%');
      pi++;
    }
    if (status === 'active')   where.push('u.is_active = TRUE');
    else if (status === 'inactive') where.push('u.is_active = FALSE');
    if (deptId) { where.push('u.department_id = $' + pi); params.push(deptId); pi++; }

    const { rows } = await pool.query(
      // Only select columns that exist in the live DB schema (legacy 000_reset_schema).
      // is_bootstrap_admin is added by migration 008. Non-existent columns like auth_provider,
      // employment_type, phone, manager_id, start_date, profile_notes are intentionally excluded.
      'SELECT u.id, u.email, u.name, u.is_active, u.department_id, u.position_id, u.created_at,' +
      ' COALESCE(u.is_bootstrap_admin, FALSE) AS is_bootstrap_admin,' +
      ' d.name AS department_name,' +
      ' (SELECT COALESCE(json_agg(' +
      "   json_build_object('id',p2.id,'title',p2.title,'type',COALESCE(p2.position_type,'ops'),'is_primary',sp2.is_primary)" +
      '   ORDER BY sp2.is_primary DESC NULLS LAST, p2.title' +
      ' ),' +
      " '[]'::json)" +
      '  FROM yc_tkt_mgmt.staff_positions sp2' +
      '  JOIN yc_tkt_mgmt.positions p2 ON p2.id = sp2.position_id' +
      '  WHERE sp2.user_id = u.id' +
      ' ) AS positions' +
      ' FROM yc_tkt_mgmt.users u' +
      ' LEFT JOIN yc_tkt_mgmt.departments d ON d.id = u.department_id' +
      ' WHERE ' + where.join(' AND ') +
      ' ORDER BY u.name' +
      ' LIMIT $' + pi + ' OFFSET $' + (pi + 1),
      [...params, limit, offset]
    );
    const users = rows.map(r => ({ ...r, active: r.is_active, positions: Array.isArray(r.positions) ? r.positions : [] }));
    res.json({ users, total: users.length });
  } catch (err) { next(err); }
});

// POST /users — create staff
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { email, name, phone, employment_type, department_id, manager_id,
      start_date, profile_notes, position_id, auth_provider, is_active, designation } = req.body || {};
    if (!email?.trim()) return res.status(400).json({ error: 'missing_fields', message: 'Email is required' });
    if (!name?.trim())  return res.status(400).json({ error: 'missing_fields', message: 'Name is required' });
    // Enforce org-domain policy — staff must have an allowed email to be able to sign in via Microsoft Entra
    const domainCheck = validateEmail(email.trim());
    if (!domainCheck.valid) return res.status(400).json({ error: 'invalid_email_domain', message: domainCheck.reason });
    const initials = (name.trim().split(/\s+/).map((s: string) => s[0] || '').slice(0, 2).join('') || '?').toUpperCase();
    const active = is_active !== false;
    const posId  = position_id ? Number(position_id) : null;
    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.users
         (email, name, phone, employment_type, department_id, manager_id,
          start_date, profile_notes, position_id, auth_provider, is_active,
          avatar_initials, designation, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
       RETURNING id, email, name, is_active, position_id, department_id, manager_id, employment_type, auth_provider, avatar_initials`,
      [email.toLowerCase().trim(), name.trim(), phone || null, employment_type || 'full_time',
       department_id ? Number(department_id) : null, manager_id ? Number(manager_id) : null,
       start_date || null, profile_notes || null, posId, auth_provider || 'azure_ad',
       active, initials, designation || null]
    );
    if (posId) {
      await pool.query(`UPDATE yc_tkt_mgmt.positions SET is_active=TRUE, is_vacant=FALSE, updated_at=NOW() WHERE id=$1`, [posId]);
      await pool.query(`INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES ($1,$2,TRUE) ON CONFLICT DO NOTHING`, [rows[0].id, posId]);
    }
    if (req.auth) await logAudit({ userId: req.auth.userId, actorEmail: req.auth.email, action: 'user.create', module: 'users', targetType: 'user', targetId: rows[0].id, metadata: { email: rows[0].email }, req });
    res.status(201).json({ user: rows[0] });

    // Notify
    notify({
      type: 'user.created', targetUserId: rows[0].id, targetUserName: rows[0].name,
      actorId: req.auth?.userId ?? rows[0].id, actorName: req.auth?.email,
      deptId: rows[0].department_id ?? undefined,
    }).catch(() => {});
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') return res.status(409).json({ error: 'duplicate_email', message: 'A user with this email already exists' });
    next(err);
  }
});

// PATCH /users/:id — update
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: tRows } = await pool.query(`SELECT * FROM yc_tkt_mgmt.users WHERE id = $1`, [id]);
    const target = tRows[0];
    if (!target) return res.status(404).json({ error: 'not_found' });
    if (target.is_bootstrap_admin && 'is_active' in req.body && req.body.is_active === false)
      return res.status(403).json({ error: 'bootstrap_admin_deactivate_blocked', message: 'Bootstrap admins cannot be deactivated' });
    // If email is being changed, enforce org-domain policy
    if ('email' in req.body && req.body.email) {
      const domainCheck = validateEmail(req.body.email.toString().trim());
      if (!domainCheck.valid) return res.status(400).json({ error: 'invalid_email_domain', message: domainCheck.reason });
    }

    // Only include columns that exist in the live DB schema
    const fieldMap: Record<string, string> = {
      name: 'name', email: 'email',
      department_id: 'department_id', position_id: 'position_id',
      is_active: 'is_active',
    };
    const updates: string[] = []; const values: unknown[] = []; let i = 1;
    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in req.body) {
        updates.push(`${col} = $${i++}`);
        const val = req.body[key];
        values.push((col === 'department_id' || col === 'manager_id' || col === 'position_id') && val !== null && val !== '' ? Number(val) : (val === '' ? null : val));
      }
    }
    if (updates.length) {
      values.push(id);
      await pool.query(`UPDATE yc_tkt_mgmt.users SET ${updates.join(', ')}, updated_at=NOW() WHERE id=$${i}`, values);
    }

    // ── Sync staff_positions (multi-position) ────────────────────────────────
    if ('position_ids' in req.body && Array.isArray(req.body.position_ids)) {
      const newIds: number[] = req.body.position_ids.map(Number).filter(Boolean);
      const { rows: oldSp } = await pool.query(`SELECT position_id FROM yc_tkt_mgmt.staff_positions WHERE user_id=$1`, [id]);
      const oldIds: number[] = oldSp.map((r: { position_id: number }) => r.position_id);
      await pool.query(`DELETE FROM yc_tkt_mgmt.staff_positions WHERE user_id=$1`, [id]);
      for (let idx = 0; idx < newIds.length; idx++) {
        await pool.query(
          `INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES ($1,$2,$3) ON CONFLICT (user_id, position_id) DO UPDATE SET is_primary=$3`,
          [id, newIds[idx], idx === 0]
        );
        await pool.query(`UPDATE yc_tkt_mgmt.positions SET is_active=TRUE, is_vacant=FALSE, updated_at=NOW() WHERE id=$1`, [newIds[idx]]);
      }
      for (const oldId of oldIds) {
        if (!newIds.includes(oldId)) {
          await pool.query(
            `UPDATE yc_tkt_mgmt.positions
             SET is_active=EXISTS(SELECT 1 FROM yc_tkt_mgmt.staff_positions sp2 JOIN yc_tkt_mgmt.users u2 ON u2.id=sp2.user_id AND u2.is_active=TRUE WHERE sp2.position_id=$1),
                 is_vacant=NOT EXISTS(SELECT 1 FROM yc_tkt_mgmt.staff_positions sp2 JOIN yc_tkt_mgmt.users u2 ON u2.id=sp2.user_id AND u2.is_active=TRUE WHERE sp2.position_id=$1),
                 updated_at=NOW() WHERE id=$1`, [oldId]
          );
        }
      }
    }

    const { rows: updRows } = await pool.query(
      `SELECT id, email, name, is_active, position_id, department_id, COALESCE(is_bootstrap_admin, FALSE) AS is_bootstrap_admin FROM yc_tkt_mgmt.users WHERE id=$1`, [id]
    );
    if (req.auth) await logAudit({ userId: req.auth.userId, actorEmail: req.auth.email, action: 'user.update', module: 'users', targetType: 'user', targetId: id, metadata: { changes: req.body }, req });
    res.json({ user: updRows[0] });

    // Notify if position changed
    const positionChanged = 'position_id' in req.body || 'position_ids' in req.body;
    if (positionChanged) {
      // Get new position title
      let posTitle = 'new role';
      try {
        const { rows: pRows } = await pool.query(
          `SELECT p.title FROM yc_tkt_mgmt.staff_positions sp JOIN yc_tkt_mgmt.positions p ON p.id=sp.position_id WHERE sp.user_id=$1 AND sp.is_primary=TRUE LIMIT 1`, [id]
        );
        posTitle = pRows[0]?.title || posTitle;
      } catch { /* ignore */ }
      notify({
        type: 'user.position_changed', targetUserId: id, targetUserName: target.name,
        actorId: req.auth?.userId ?? id, actorName: req.auth?.email,
        deptId: updRows[0]?.department_id ?? undefined, extra: posTitle,
      }).catch(() => {});
    }
  } catch (err) { next(err); }
});

// DELETE /users/:id — soft delete
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`SELECT * FROM yc_tkt_mgmt.users WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    if (rows[0].is_bootstrap_admin) return res.status(403).json({ error: 'bootstrap_admin_delete_blocked', message: 'Bootstrap admin accounts cannot be deleted' });
    await pool.query(`UPDATE yc_tkt_mgmt.users SET is_active=FALSE, updated_at=NOW() WHERE id=$1`, [id]);
    const { rows: spRows } = await pool.query(`SELECT position_id FROM yc_tkt_mgmt.staff_positions WHERE user_id=$1`, [id]);
    await pool.query(`DELETE FROM yc_tkt_mgmt.staff_positions WHERE user_id=$1`, [id]);
    for (const sp of spRows) {
      await pool.query(
        `UPDATE yc_tkt_mgmt.positions
         SET is_active=EXISTS(SELECT 1 FROM yc_tkt_mgmt.staff_positions sp2 JOIN yc_tkt_mgmt.users u2 ON u2.id=sp2.user_id AND u2.is_active=TRUE WHERE sp2.position_id=$1),
             is_vacant=NOT EXISTS(SELECT 1 FROM yc_tkt_mgmt.staff_positions sp2 JOIN yc_tkt_mgmt.users u2 ON u2.id=sp2.user_id AND u2.is_active=TRUE WHERE sp2.position_id=$1),
             updated_at=NOW() WHERE id=$1`, [sp.position_id]
      );
    }
    if (req.auth) await logAudit({ userId: req.auth.userId, actorEmail: req.auth.email, action: 'user.delete', module: 'users', targetType: 'user', targetId: id, req });
    res.json({ ok: true, message: rows[0].name + ' has been deactivated. Their positions are now vacant.' });

    // Notify
    notify({
      type: 'user.deleted', targetUserId: id, targetUserName: rows[0].name,
      actorId: req.auth?.userId ?? id, actorName: req.auth?.email,
      deptId: rows[0].department_id ?? undefined,
    }).catch(() => {});
  } catch (err) { next(err); }
});

export default router;
