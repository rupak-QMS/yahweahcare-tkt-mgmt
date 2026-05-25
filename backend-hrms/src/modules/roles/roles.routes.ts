// ============================================================
// Role & permission management routes
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission, requireSuperAdmin } from '../../middleware/rbac.middleware';
import { logAudit } from '../audit/audit.service';

const router = Router();
router.use(requireAuth);

// GET /roles — list all roles (with permission counts)
router.get('/', requirePermission('role.read'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.display_name, r.description, r.rank, r.is_system,
            COUNT(rp.permission_id)::int AS permission_count,
            COUNT(u.id)::int AS user_count
       FROM yc_tkt_mgmt.roles r
       LEFT JOIN yc_tkt_mgmt.role_permissions rp ON rp.role_id = r.id
       LEFT JOIN yc_tkt_mgmt.users u ON u.role_id = r.id
       GROUP BY r.id
       ORDER BY r.rank`
  );
  res.json({ roles: rows });
});

// GET /roles/:id — single role with its permissions
router.get('/:id', requirePermission('role.read'), async (req, res) => {
  const id = Number(req.params.id);
  const [{ rows: [role] }, { rows: perms }] = await Promise.all([
    pool.query(`SELECT * FROM yc_tkt_mgmt.roles WHERE id = $1`, [id]),
    pool.query(
      `SELECT p.* FROM yc_tkt_mgmt.permissions p
       JOIN yc_tkt_mgmt.role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = $1 ORDER BY p.module, p.name`, [id]
    ),
  ]);
  if (!role) return res.status(404).json({ error: 'not_found' });
  res.json({ role, permissions: perms });
});

// POST /roles — create custom role (Super Admin only)
router.post('/', requireSuperAdmin, async (req, res) => {
  const { name, display_name, description, rank, permissionIds } = req.body || {};
  if (!name || !display_name || !rank) return res.status(400).json({ error: 'missing_fields' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.roles (name, display_name, description, rank, is_system)
       VALUES ($1, $2, $3, $4, FALSE) RETURNING *`,
      [name, display_name, description || null, rank]
    );
    const role = rows[0];
    if (Array.isArray(permissionIds) && permissionIds.length) {
      const values = permissionIds.map((_: number, i: number) => `($1, $${i + 2}, $${permissionIds.length + 2})`).join(',');
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.role_permissions (role_id, permission_id, granted_by) VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [role.id, ...permissionIds, req.auth!.userId]
      );
    }
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'role.create', module: 'roles', targetType: 'role', targetId: role.id, metadata: { name, display_name }, req });
    res.status(201).json({ role });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') return res.status(409).json({ error: 'duplicate_name' });
    throw err;
  }
});

// PATCH /roles/:id — update role + reset permissions (Super Admin only)
router.patch('/:id', requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { display_name, description, rank, permissionIds } = req.body || {};
  const { rows: tRows } = await pool.query(`SELECT * FROM yc_tkt_mgmt.roles WHERE id = $1`, [id]);
  const role = tRows[0];
  if (!role) return res.status(404).json({ error: 'not_found' });
  // System roles can have description/permissions edited but name/rank are locked
  if (role.is_system && req.body.name && req.body.name !== role.name) {
    return res.status(403).json({ error: 'system_role_rename_blocked' });
  }
  await pool.query(
    `UPDATE yc_tkt_mgmt.roles SET
       display_name = COALESCE($1, display_name),
       description  = COALESCE($2, description),
       rank         = COALESCE($3, rank),
       updated_at   = NOW()
     WHERE id = $4`,
    [display_name, description, rank, id]
  );
  if (Array.isArray(permissionIds)) {
    await pool.query(`DELETE FROM yc_tkt_mgmt.role_permissions WHERE role_id = $1`, [id]);
    if (permissionIds.length) {
      const ph = permissionIds.map((_: number, i: number) => `($1, $${i + 2}, $${permissionIds.length + 2})`).join(',');
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.role_permissions (role_id, permission_id, granted_by) VALUES ${ph}`,
        [id, ...permissionIds, req.auth!.userId]
      );
    }
  }
  await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'role.update', module: 'roles', targetType: 'role', targetId: id, metadata: req.body, req });
  res.json({ ok: true });
});

// GET /permissions — list available permissions (for picker UIs)
router.get('/permissions/all', requirePermission('role.read'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, module, description FROM yc_tkt_mgmt.permissions ORDER BY module, name`
  );
  res.json({ permissions: rows });
});

export default router;
