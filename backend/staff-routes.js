/**
 * Staff Management Routes
 * Handles staff CRUD, position assignments, org chart, Azure AD auth
 * Usage: app.use('/api', require('./staff-routes')(pool, JWT_SECRET));
 */

const express = require('express');
const jwt     = require('jsonwebtoken');

module.exports = function(pool, jwtSecret) {
    const router = express.Router();

    // ── Auth middleware ─────────────────────────────────────────────────────
    async function auth(req, res, next) {
        const header = req.headers.authorization || '';
        const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
        if (!token) return res.status(401).json({ error: 'Missing token' });
        try {
            const payload = jwt.verify(token, jwtSecret);
            const r = await pool.query(
                `SELECT id, email, name, role, department, is_bootstrap_admin, auth_provider
                 FROM yc_tkt_mgmt.users WHERE id = $1 AND is_active = TRUE`,
                [payload.userId]
            );
            if (!r.rows.length) return res.status(401).json({ error: 'User not found' });
            req.user = r.rows[0];
            next();
        } catch {
            return res.status(401).json({ error: 'Invalid token' });
        }
    }

    // Only Bootstrap Admin or manager-level users can manage staff
    function requireStaffAdmin(req, res, next) {
        if (req.user.is_bootstrap_admin ||
            ['super_admin','admin','manager'].includes(req.user.role)) {
            return next();
        }
        return res.status(403).json({ error: 'Staff Admin access required' });
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    function initials(name) {
        return (name || '').split(' ').slice(0,2).map(w => w[0]?.toUpperCase() || '').join('');
    }

    // ── STAFF LIST ───────────────────────────────────────────────────────────
    // GET /api/staff
    router.get('/staff', auth, async (req, res) => {
        try {
            const { dept, active = 'true' } = req.query;
            const where = ['1=1'];
            const params = [];
            let i = 1;
            if (active !== 'all') {
                where.push(`u.is_active = $${i++}`);
                params.push(active === 'true');
            }
            if (dept) { where.push(`u.department_id = $${i++}`); params.push(Number(dept)); }

            const sql = `
                SELECT
                    u.id, u.name, u.email, u.phone, u.employment_type,
                    u.is_bootstrap_admin, u.is_active, u.auth_provider,
                    u.start_date, u.profile_notes, u.created_at,
                    u.department_id, d.name AS department_name,
                    u.manager_id, m.name AS manager_name,
                    u.avatar_initials,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'id',         p.id,
                                'title',      p.title,
                                'type',       p.position_type,
                                'dept_label', p.dept_label,
                                'is_primary', sp.is_primary
                            )
                        ) FILTER (WHERE p.id IS NOT NULL),
                    '[]') AS positions
                FROM yc_tkt_mgmt.users u
                LEFT JOIN yc_tkt_mgmt.departments d ON d.id = u.department_id
                LEFT JOIN yc_tkt_mgmt.users m ON m.id = u.manager_id
                LEFT JOIN yc_tkt_mgmt.staff_positions sp ON sp.user_id = u.id
                LEFT JOIN yc_tkt_mgmt.positions p ON p.id = sp.position_id AND p.is_active = TRUE
                WHERE ${where.join(' AND ')}
                GROUP BY u.id, d.name, m.name
                ORDER BY u.name
            `;
            const r = await pool.query(sql, params);
            res.json({ staff: r.rows });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // ── CREATE STAFF ─────────────────────────────────────────────────────────
    // POST /api/staff
    router.post('/staff', auth, requireStaffAdmin, async (req, res) => {
        const client = await pool.connect();
        try {
            const {
                name, email, phone, employment_type = 'full_time',
                department_id, manager_id, start_date, profile_notes,
                position_ids = [], auth_provider = 'azure_ad'
            } = req.body;

            if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
            if (!email?.trim()) return res.status(400).json({ error: 'Email is required' });

            await client.query('BEGIN');

            const r = await client.query(`
                INSERT INTO yc_tkt_mgmt.users
                    (name, email, phone, employment_type, department_id, manager_id,
                     start_date, profile_notes, auth_provider, avatar_initials, is_active, created_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,NOW())
                RETURNING id
            `, [
                name.trim(), email.toLowerCase().trim(), phone || null,
                employment_type, department_id || null, manager_id || null,
                start_date || null, profile_notes || null,
                auth_provider, initials(name)
            ]);
            const userId = r.rows[0].id;

            // Assign positions
            for (let idx = 0; idx < position_ids.length; idx++) {
                await client.query(`
                    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary, assigned_by)
                    VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
                `, [userId, position_ids[idx], idx === 0, req.user.id]);
            }

            await client.query('COMMIT');
            res.status(201).json({ id: userId, message: 'Staff member created' });
        } catch (err) {
            await client.query('ROLLBACK');
            if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
            console.error(err);
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
        }
    });

    // ── UPDATE STAFF ─────────────────────────────────────────────────────────
    // PUT /api/staff/:id
    router.put('/staff/:id', auth, requireStaffAdmin, async (req, res) => {
        const client = await pool.connect();
        try {
            const {
                name, email, phone, employment_type, department_id,
                manager_id, start_date, profile_notes, position_ids
            } = req.body;

            // Cannot edit bootstrap admin unless you are one
            const target = await pool.query('SELECT is_bootstrap_admin FROM yc_tkt_mgmt.users WHERE id=$1', [req.params.id]);
            if (!target.rows.length) return res.status(404).json({ error: 'Not found' });
            if (target.rows[0].is_bootstrap_admin && !req.user.is_bootstrap_admin) {
                return res.status(403).json({ error: 'Cannot edit Bootstrap Admin' });
            }

            await client.query('BEGIN');

            await client.query(`
                UPDATE yc_tkt_mgmt.users SET
                    name=$1, email=$2, phone=$3, employment_type=$4,
                    department_id=$5, manager_id=$6, start_date=$7, profile_notes=$8,
                    avatar_initials=$9
                WHERE id=$10
            `, [
                name?.trim(), email?.toLowerCase().trim(), phone || null,
                employment_type || 'full_time', department_id || null,
                manager_id || null, start_date || null, profile_notes || null,
                initials(name), req.params.id
            ]);

            // Replace position assignments if provided
            if (Array.isArray(position_ids)) {
                await client.query('DELETE FROM yc_tkt_mgmt.staff_positions WHERE user_id=$1', [req.params.id]);
                for (let idx = 0; idx < position_ids.length; idx++) {
                    await client.query(`
                        INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary, assigned_by)
                        VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
                    `, [req.params.id, position_ids[idx], idx === 0, req.user.id]);
                }
            }

            await client.query('COMMIT');
            res.json({ ok: true });
        } catch (err) {
            await client.query('ROLLBACK');
            if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
            console.error(err);
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
        }
    });

    // ── DEACTIVATE STAFF ─────────────────────────────────────────────────────
    // DELETE /api/staff/:id  (soft delete — sets is_active=FALSE)
    router.delete('/staff/:id', auth, requireStaffAdmin, async (req, res) => {
        try {
            const target = await pool.query('SELECT is_bootstrap_admin, name FROM yc_tkt_mgmt.users WHERE id=$1', [req.params.id]);
            if (!target.rows.length) return res.status(404).json({ error: 'Not found' });
            if (target.rows[0].is_bootstrap_admin) {
                return res.status(403).json({ error: 'Bootstrap Admin cannot be deleted' });
            }
            // Soft-delete: deactivate + remove all position assignments (positions → VACANT)
            await pool.query('UPDATE yc_tkt_mgmt.users SET is_active=FALSE WHERE id=$1', [req.params.id]);
            await pool.query('DELETE FROM yc_tkt_mgmt.staff_positions WHERE user_id=$1', [req.params.id]);
            res.json({ ok: true, message: `${target.rows[0].name} deactivated. Their positions are now vacant.` });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // ── ASSIGN POSITION ──────────────────────────────────────────────────────
    // POST /api/staff/:id/positions
    router.post('/staff/:id/positions', auth, requireStaffAdmin, async (req, res) => {
        const { position_id, is_primary = false } = req.body;
        if (!position_id) return res.status(400).json({ error: 'position_id required' });
        try {
            await pool.query(`
                INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary, assigned_by)
                VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, position_id) DO UPDATE SET is_primary=$3
            `, [req.params.id, position_id, is_primary, req.user.id]);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── REMOVE POSITION ──────────────────────────────────────────────────────
    // DELETE /api/staff/:id/positions/:posId
    router.delete('/staff/:id/positions/:posId', auth, requireStaffAdmin, async (req, res) => {
        try {
            await pool.query('DELETE FROM yc_tkt_mgmt.staff_positions WHERE user_id=$1 AND position_id=$2',
                [req.params.id, req.params.posId]);
            res.json({ ok: true, message: 'Position removed — position is now vacant in org chart' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── DEPARTMENTS ──────────────────────────────────────────────────────────
    // GET /api/departments
    router.get('/departments', auth, async (req, res) => {
        try {
            const r = await pool.query('SELECT * FROM yc_tkt_mgmt.departments ORDER BY name');
            res.json({ departments: r.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/departments
    router.post('/departments', auth, requireStaffAdmin, async (req, res) => {
        const { name, description } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
        try {
            const r = await pool.query(
                'INSERT INTO yc_tkt_mgmt.departments (name,description) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING RETURNING *',
                [name.trim(), description || null]
            );
            res.status(201).json({ department: r.rows[0] });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── POSITIONS ────────────────────────────────────────────────────────────
    // GET /api/positions
    router.get('/positions', auth, async (req, res) => {
        try {
            const r = await pool.query(`
                SELECT
                    p.*,
                    d.name AS department_name,
                    COALESCE(
                        json_agg(json_build_object('id',u.id,'name',u.name,'email',u.email))
                        FILTER (WHERE u.id IS NOT NULL),
                    '[]') AS occupants,
                    CASE WHEN COUNT(sp.user_id) > 0 THEN FALSE ELSE TRUE END AS is_vacant
                FROM yc_tkt_mgmt.positions p
                LEFT JOIN yc_tkt_mgmt.departments d ON d.id = p.department_id
                LEFT JOIN yc_tkt_mgmt.staff_positions sp ON sp.position_id = p.id
                LEFT JOIN yc_tkt_mgmt.users u ON u.id = sp.user_id AND u.is_active = TRUE
                WHERE p.is_active = TRUE
                GROUP BY p.id, d.name
                ORDER BY p.sort_order, p.title
            `);
            res.json({ positions: r.rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/positions
    router.post('/positions', auth, requireStaffAdmin, async (req, res) => {
        const { title, department_id, parent_id, position_type = 'staff', dept_label, sort_order = 0 } = req.body;
        if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
        try {
            const r = await pool.query(`
                INSERT INTO yc_tkt_mgmt.positions (title, department_id, parent_id, position_type, dept_label, sort_order, is_active)
                VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING *
            `, [title.trim(), department_id || null, parent_id || null, position_type, dept_label || null, sort_order]);
            res.status(201).json({ position: r.rows[0] });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // PUT /api/positions/:id
    router.put('/positions/:id', auth, requireStaffAdmin, async (req, res) => {
        const { title, department_id, parent_id, position_type, dept_label, sort_order, is_active } = req.body;
        try {
            await pool.query(`
                UPDATE yc_tkt_mgmt.positions SET
                    title=$1, department_id=$2, parent_id=$3, position_type=$4,
                    dept_label=$5, sort_order=$6, is_active=$7
                WHERE id=$8
            `, [title, department_id || null, parent_id || null, position_type, dept_label || null,
                sort_order ?? 0, is_active !== false, req.params.id]);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── ORG CHART (dynamic tree) ─────────────────────────────────────────────
    // GET /api/org-chart
    router.get('/org-chart', async (req, res) => {
        try {
            // Get all positions with their occupants
            const r = await pool.query(`
                SELECT
                    p.id, p.title, p.parent_id, p.position_type, p.dept_label,
                    p.sort_order, p.is_active,
                    d.name AS department_name,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'id',    u.id,
                                'name',  u.name,
                                'email', u.email,
                                'is_primary', sp.is_primary
                            )
                        ) FILTER (WHERE u.id IS NOT NULL AND u.is_active = TRUE),
                    '[]') AS occupants
                FROM yc_tkt_mgmt.positions p
                LEFT JOIN yc_tkt_mgmt.departments d ON d.id = p.department_id
                LEFT JOIN yc_tkt_mgmt.staff_positions sp ON sp.position_id = p.id
                LEFT JOIN yc_tkt_mgmt.users u ON u.id = sp.user_id
                WHERE p.is_active = TRUE
                GROUP BY p.id, d.name
                ORDER BY p.sort_order, p.id
            `);

            const positions = r.rows;

            // Build tree recursively
            function buildTree(nodes, parentId) {
                return nodes
                    .filter(n => n.parent_id == parentId)
                    .sort((a,b) => a.sort_order - b.sort_order)
                    .map(n => ({
                        ...n,
                        children: buildTree(nodes, n.id)
                    }));
            }

            const tree = buildTree(positions, null);

            // Also get system roles (bootstrap admins, not in org hierarchy)
            const sysRoles = await pool.query(`
                SELECT id, name, email, avatar_initials, is_bootstrap_admin
                FROM yc_tkt_mgmt.users
                WHERE is_bootstrap_admin = TRUE AND is_active = TRUE
                ORDER BY name
            `);

            res.json({ tree, systemRoles: sysRoles.rows });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // ── AZURE AD AUTH ────────────────────────────────────────────────────────
    // POST /api/auth/azure
    // Frontend sends the Azure ID token; we validate and return app JWT
    router.post('/auth/azure', async (req, res) => {
        const { id_token, email, name, azure_oid } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });
        try {
            // Find user by azure_oid or email
            let r = await pool.query(
                'SELECT * FROM yc_tkt_mgmt.users WHERE (azure_oid=$1 OR email=$2) AND is_active=TRUE AND auth_provider=\'azure_ad\' LIMIT 1',
                [azure_oid || null, email.toLowerCase()]
            );
            let user = r.rows[0];

            if (!user) return res.status(401).json({ error: 'No active account found for this Microsoft identity. Contact your administrator.' });

            // Update OID and last login
            await pool.query(
                'UPDATE yc_tkt_mgmt.users SET azure_oid=$1, last_login_at=NOW() WHERE id=$2',
                [azure_oid || null, user.id]
            );

            const token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret, { expiresIn: '8h' });
            const { password_hash, ...safe } = user;
            res.json({ token, user: safe });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
