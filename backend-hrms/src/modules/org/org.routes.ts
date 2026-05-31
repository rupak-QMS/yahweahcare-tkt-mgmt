// ============================================================
// Org Hierarchy routes
// GET  /org/chart         — full tree for org chart page
// GET  /org/departments   — list departments
// POST /org/departments   — create department (super admin)
// GET  /org/positions     — list positions (optionally by dept)
// POST /org/positions     — create position (super admin)
// PATCH /org/positions/:id — update position
// PATCH /org/move         — move user to new position (drag-drop)
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { logAudit } from '../audit/audit.service';

const router = Router();
router.use(requireAuth);

const isSuperAdmin = (role: string) => ['super_admin'].includes(role);
const isManagerOrAbove = (role: string) => ['super_admin', 'admin', 'manager', 'hr'].includes(role);

// ── GET /org/chart — recursive tree ─────────────────────────
router.get('/chart', async (req, res, next) => {
  try {
    // Fetch all positions with their holder (if any)
    const { rows: positions } = await pool.query(`
      SELECT
        p.id, p.title, p.parent_position_id, p.is_active, p.is_vacant,
        p.sort_order, p.department_id,
        d.name AS department_name,
        u.id   AS user_id,
        u.name AS user_name,
        u.email AS user_email,
        u.active AS user_active,
        u.profile_photo_url,
        u.avatar_initials,
        u.role,
        u.is_bootstrap_admin,
        u.designation
      FROM yc_tkt_mgmt.positions p
      LEFT JOIN yc_tkt_mgmt.departments d ON d.id = p.department_id
      LEFT JOIN yc_tkt_mgmt.users u ON u.position_id = p.id AND u.active = TRUE
      ORDER BY p.department_id NULLS FIRST, p.sort_order, p.id
    `);

    // Fetch departments
    const { rows: departments } = await pool.query(`
      SELECT id, name, parent_dept_id, sort_order
      FROM yc_tkt_mgmt.departments
      ORDER BY sort_order, id
    `);

    // Build position map
    const posMap: Record<number, Record<string, unknown>> = {};
    for (const p of positions) {
      posMap[p.id] = { ...p, children: [] };
    }

    // Build tree
    const roots: Record<string, unknown>[] = [];
    for (const p of positions) {
      if (p.parent_position_id && posMap[p.parent_position_id]) {
        (posMap[p.parent_position_id].children as unknown[]).push(posMap[p.id]);
      } else {
        roots.push(posMap[p.id]);
      }
    }

    // Bootstrap admins (system roles — not part of hierarchy)
    const { rows: bootstrapAdmins } = await pool.query(`
      SELECT id, name, email, role, is_bootstrap_admin, profile_photo_url, avatar_initials, active
      FROM yc_tkt_mgmt.users
      WHERE is_bootstrap_admin = TRUE
      ORDER BY id
    `);

    res.json({ tree: roots, departments, bootstrapAdmins });
  } catch (err) { next(err); }
});

// ── GET /org/departments ─────────────────────────────────────
router.get('/departments', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, parent_dept_id, sort_order FROM yc_tkt_mgmt.departments ORDER BY sort_order, id`
    );
    res.json({ departments: rows });
  } catch (err) { next(err); }
});

// ── POST /org/departments ────────────────────────────────────
router.post('/departments', async (req, res, next) => {
  try {
    if (!isSuperAdmin(req.auth!.role)) return res.status(403).json({ error: 'forbidden' });
    const { name, parentDeptId, sortOrder } = req.body || {};
    if (!name) return res.status(400).json({ error: 'missing_name' });
    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.departments (name, parent_dept_id, sort_order) VALUES ($1,$2,$3) RETURNING *`,
      [name, parentDeptId || null, sortOrder || 0]
    );
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'dept.create', module: 'org', targetType: 'department', targetId: rows[0].id, metadata: { name }, req });
    res.status(201).json({ department: rows[0] });
  } catch (err) { next(err); }
});

// ── GET /org/positions ───────────────────────────────────────
router.get('/positions', async (req, res, next) => {
  try {
    const deptId = req.query.departmentId ? Number(req.query.departmentId) : null;
    const { rows } = await pool.query(
      `SELECT p.*, d.name AS department_name,
              u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM yc_tkt_mgmt.positions p
       LEFT JOIN yc_tkt_mgmt.departments d ON d.id = p.department_id
       LEFT JOIN yc_tkt_mgmt.users u ON u.position_id = p.id AND u.active = TRUE
       ${deptId ? 'WHERE p.department_id = $1' : ''}
       ORDER BY p.sort_order, p.id`,
      deptId ? [deptId] : []
    );
    res.json({ positions: rows });
  } catch (err) { next(err); }
});

// ── POST /org/positions ──────────────────────────────────────
router.post('/positions', async (req, res, next) => {
  try {
    if (!isSuperAdmin(req.auth!.role)) return res.status(403).json({ error: 'forbidden' });
    const { title, departmentId, parentPositionId, sortOrder } = req.body || {};
    if (!title) return res.status(400).json({ error: 'missing_title' });
    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.positions (title, department_id, parent_position_id, sort_order, is_active, is_vacant)
       VALUES ($1,$2,$3,$4,FALSE,TRUE) RETURNING *`,
      [title, departmentId || null, parentPositionId || null, sortOrder || 0]
    );
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'position.create', module: 'org', targetType: 'position', targetId: rows[0].id, metadata: { title }, req });
    res.status(201).json({ position: rows[0] });
  } catch (err) { next(err); }
});

// ── PATCH /org/positions/:id ─────────────────────────────────
router.patch('/positions/:id', async (req, res, next) => {
  try {
    if (!isSuperAdmin(req.auth!.role)) return res.status(403).json({ error: 'forbidden' });
    const id = Number(req.params.id);
    const allowed = ['title', 'department_id', 'parent_position_id', 'sort_order'];
    const updates: string[] = []; const vals: unknown[] = []; let i = 1;
    for (const k of allowed) {
      const fk = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); // camelCase key
      const bodyKey = req.body[k] !== undefined ? k : fk;
      if (req.body[bodyKey] !== undefined) { updates.push(`${k} = $${i++}`); vals.push(req.body[bodyKey]); }
    }
    if (!updates.length) return res.status(400).json({ error: 'no_fields' });
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE yc_tkt_mgmt.positions SET ${updates.join(', ')}, updated_at=NOW() WHERE id=$${i} RETURNING *`,
      vals
    );
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'position.update', module: 'org', targetType: 'position', targetId: id, metadata: req.body, req });
    res.json({ position: rows[0] });
  } catch (err) { next(err); }
});

// ── PATCH /org/move — assign user to new position (drag-drop) ─
router.patch('/move', async (req, res, next) => {
  try {
    if (!isSuperAdmin(req.auth!.role)) return res.status(403).json({ error: 'forbidden' });
    const { userId, positionId, managerId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'missing_userId' });

    const { rows: userRows } = await pool.query(
      `SELECT * FROM yc_tkt_mgmt.users WHERE id = $1`, [userId]
    );
    if (!userRows[0]) return res.status(404).json({ error: 'user_not_found' });
    if (userRows[0].is_bootstrap_admin) {
      return res.status(403).json({ error: 'cannot_move_bootstrap_admin', message: 'Bootstrap admins cannot be moved in the hierarchy' });
    }

    // Free old position
    if (userRows[0].position_id) {
      await pool.query(
        `UPDATE yc_tkt_mgmt.positions SET is_active=FALSE, is_vacant=TRUE, updated_at=NOW() WHERE id=$1`,
        [userRows[0].position_id]
      );
    }

    // Assign new position
    await pool.query(
      `UPDATE yc_tkt_mgmt.users SET position_id=$1, manager_id=$2, updated_at=NOW() WHERE id=$3`,
      [positionId || null, managerId || null, userId]
    );
    if (positionId) {
      await pool.query(
        `UPDATE yc_tkt_mgmt.positions SET is_active=TRUE, is_vacant=FALSE, updated_at=NOW() WHERE id=$1`,
        [positionId]
      );
    }

    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'org.move', module: 'org', targetType: 'user', targetId: userId, metadata: { positionId, managerId }, req });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
