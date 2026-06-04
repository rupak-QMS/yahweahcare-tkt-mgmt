// ============================================================
// Yahweahcare — REST API server (PostgreSQL)
// Express + pg + JWT auth
// Usage: npm start
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// Set search_path so every new connection in the pool uses the yc_tkt_mgmt schema first
pool.on('connect', (client) => { client.query('SET search_path TO yc_tkt_mgmt, public'); });

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

// ------------------------------------------------------------
// Auth middleware
// ------------------------------------------------------------
async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const r = await pool.query('SELECT id, email, name, role, department, site, avatar_initials FROM yc_tkt_mgmt.users WHERE id = $1 AND active = TRUE', [payload.userId]);
    if (!r.rows.length) return res.status(401).json({ error: 'User not found' });
    req.user = r.rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
async function nextTicketNumber() {
  const r = await pool.query("SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM 5) AS INTEGER)), 0) AS n FROM yc_tkt_mgmt.tickets");
  return 'YAH-' + String(r.rows[0].n + 1).padStart(6, '0');
}

async function slaHoursFor(priorityId) {
  const r = await pool.query('SELECT sla_hours FROM yc_tkt_mgmt.priorities WHERE id = $1', [priorityId]);
  return r.rows[0]?.sla_hours || 24;
}

// ------------------------------------------------------------
// Health
// ------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW() AS time');
    res.json({ ok: true, time: r.rows[0].time });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ------------------------------------------------------------
// Auth
// ------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const r = await pool.query('SELECT * FROM yc_tkt_mgmt.users WHERE email = $1 AND active = TRUE', [email.toLowerCase().trim()]);
    const user = r.rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
    if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
    await pool.query('UPDATE yc_tkt_mgmt.users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    const { password_hash, ...safe } = user;
    res.json({ token, user: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

// ------------------------------------------------------------
// Lookups
// ------------------------------------------------------------
app.get('/api/lookups', auth, async (req, res) => {
  const [cats, pris, stats] = await Promise.all([
    pool.query('SELECT * FROM yc_tkt_mgmt.categories ORDER BY sort_order'),
    pool.query('SELECT * FROM yc_tkt_mgmt.priorities ORDER BY sort_order'),
    pool.query('SELECT * FROM yc_tkt_mgmt.statuses ORDER BY sort_order'),
  ]);
  res.json({ categories: cats.rows, priorities: pris.rows, statuses: stats.rows });
});

app.get('/api/users', auth, async (req, res) => {
  const r = await pool.query("SELECT id, email, name, role, department, site, avatar_initials FROM yc_tkt_mgmt.users WHERE active = TRUE ORDER BY name");
  res.json({ users: r.rows });
});

// ------------------------------------------------------------
// Tickets — list
// ------------------------------------------------------------
app.get('/api/tickets', auth, async (req, res) => {
  const { status, priority, category, assignee, q, limit = 100 } = req.query;
  const where = ['1=1'];
  const params = [];
  let i = 1;

  if (req.user.role === 'staff') {
    where.push(`t.requester_id = $${i++}`);
    params.push(req.user.id);
  }
  if (status) { where.push(`t.status_id = $${i++}`); params.push(status); }
  if (priority) { where.push(`t.priority_id = $${i++}`); params.push(priority); }
  if (category) { where.push(`t.category_id = $${i++}`); params.push(category); }
  if (assignee === 'me') { where.push(`t.assignee_id = $${i++}`); params.push(req.user.id); }
  else if (assignee === 'unassigned') { where.push('t.assignee_id IS NULL'); }
  else if (assignee) { where.push(`t.assignee_id = $${i++}`); params.push(assignee); }
  if (q) {
    where.push(`(t.title ILIKE $${i} OR t.description ILIKE $${i} OR t.ticket_number ILIKE $${i})`);
    params.push(`%${q}%`); i++;
  }

  const sql = `
    SELECT t.*,
      c.label AS category_label, c.icon AS category_icon,
      p.label AS priority_label, p.sla_hours,
      s.label AS status_label, s.is_closed,
      u_req.name AS requester_name, u_req.email AS requester_email,
      u_asn.name AS assignee_name, u_asn.email AS assignee_email,
      (t.due_at < NOW() AND s.is_closed = FALSE) AS sla_breached_now
    FROM yc_tkt_mgmt.tickets t
    JOIN yc_tkt_mgmt.categories c ON c.id = t.category_id
    JOIN yc_tkt_mgmt.priorities p ON p.id = t.priority_id
    JOIN yc_tkt_mgmt.statuses   s ON s.id = t.status_id
    JOIN yc_tkt_mgmt.users   u_req ON u_req.id = t.requester_id
    LEFT JOIN yc_tkt_mgmt.users u_asn ON u_asn.id = t.assignee_id
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE t.priority_id WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      t.created_at DESC
    LIMIT $${i}
  `;
  params.push(Number(limit));
  const r = await pool.query(sql, params);
  res.json({ tickets: r.rows, total: r.rows.length });
});

// ------------------------------------------------------------
// Ticket detail
// ------------------------------------------------------------
app.get('/api/tickets/:id', auth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT t.*,
        c.label AS category_label, c.icon AS category_icon,
        p.label AS priority_label, p.sla_hours,
        s.label AS status_label, s.is_closed,
        u_req.name AS requester_name, u_req.email AS requester_email,
        u_asn.name AS assignee_name, u_asn.email AS assignee_email
      FROM yc_tkt_mgmt.tickets t
      JOIN yc_tkt_mgmt.categories c ON c.id = t.category_id
      JOIN yc_tkt_mgmt.priorities p ON p.id = t.priority_id
      JOIN yc_tkt_mgmt.statuses   s ON s.id = t.status_id
      JOIN yc_tkt_mgmt.users   u_req ON u_req.id = t.requester_id
      LEFT JOIN yc_tkt_mgmt.users u_asn ON u_asn.id = t.assignee_id
      WHERE t.id = $1
    `, [req.params.id]);
    const ticket = r.rows[0];
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && ticket.requester_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const [comments, activity] = await Promise.all([
      pool.query(`SELECT c.*, u.name AS author_name, u.avatar_initials AS author_initials FROM yc_tkt_mgmt.comments c JOIN yc_tkt_mgmt.users u ON u.id = c.author_id WHERE c.ticket_id = $1 ORDER BY c.created_at`, [ticket.id]),
      pool.query(`SELECT a.*, u.name AS actor_name FROM yc_tkt_mgmt.activity a LEFT JOIN yc_tkt_mgmt.users u ON u.id = a.actor_id WHERE a.ticket_id = $1 ORDER BY a.created_at`, [ticket.id]),
    ]);

    res.json({ ticket: { ...ticket, comments: comments.rows, activity: activity.rows } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Create ticket
// ------------------------------------------------------------
app.post('/api/tickets', auth, async (req, res) => {
  const { title, description, category_id, priority_id, site } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  try {
    const sla = await slaHoursFor(priority_id || 'medium');
    const tn = await nextTicketNumber();
    const r = await pool.query(`
      INSERT INTO yc_tkt_mgmt.tickets (ticket_number, title, description, category_id, priority_id, status_id,
                           requester_id, site, due_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'new', $6, $7, NOW() + ($8 || ' hours')::interval, NOW(), NOW())
      RETURNING id
    `, [tn, title.trim(), description || '', category_id || 'general', priority_id || 'medium', req.user.id, site || req.user.site, String(sla)]);
    await pool.query(`INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, to_value) VALUES ($1, $2, 'created', 'new')`, [r.rows[0].id, req.user.id]);

    // Queue email notification to requester
    await pool.query(`
      INSERT INTO yc_tkt_mgmt.notifications (recipient_id, recipient_email, ticket_id, channel, subject, body)
      VALUES ($1, $2, $3, 'email', $4, $5)
    `, [req.user.id, req.user.email, r.rows[0].id,
        `[Yahweahcare] Ticket ${tn} received: ${title}`,
        `Hi ${req.user.name.split(' ')[0]},\n\nWe've received your ticket "${title}". SLA target: ${sla}h.\n\n— Yahweahcare Service Desk`]);

    res.status(201).json({ id: r.rows[0].id, ticket_number: tn });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Update ticket
// ------------------------------------------------------------
app.patch('/api/tickets/:id', auth, async (req, res) => {
  try {
    const current = await pool.query('SELECT * FROM yc_tkt_mgmt.tickets WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Not found' });
    const t = current.rows[0];
    if (req.user.role === 'staff' && t.requester_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const allowed = req.user.role === 'staff'
      ? ['title', 'description']
      : ['title', 'description', 'category_id', 'priority_id', 'status_id', 'assignee_id', 'site'];

    const updates = [];
    const params = [];
    let i = 1;
    for (const k of allowed) {
      if (k in req.body && req.body[k] !== t[k]) {
        updates.push(`${k} = $${i++}`);
        params.push(req.body[k]);
      }
    }
    if (req.body.status_id === 'resolved' || req.body.status_id === 'closed') {
      updates.push(`resolved_at = COALESCE(resolved_at, NOW())`);
    }
    if (req.body.status_id === 'closed') updates.push(`closed_at = NOW()`);
    if (updates.length === 0) return res.json({ ok: true });
    updates.push('updated_at = NOW()');
    params.push(req.params.id);

    await pool.query(`UPDATE yc_tkt_mgmt.tickets SET ${updates.join(', ')} WHERE id = $${i}`, params);

    // Log activity
    for (const k of allowed) {
      if (k in req.body && req.body[k] !== t[k]) {
        const at = k === 'status_id' ? 'status_change' : (k === 'assignee_id' ? 'assigned' : (k === 'priority_id' ? 'priority_change' : 'edit'));
        await pool.query(`INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, from_value, to_value) VALUES ($1, $2, $3, $4, $5)`,
          [t.id, req.user.id, at, String(t[k] || ''), String(req.body[k] || '')]);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Comments
// ------------------------------------------------------------
app.post('/api/tickets/:id/comments', auth, async (req, res) => {
  const { body, is_internal } = req.body || {};
  if (!body?.trim()) return res.status(400).json({ error: 'Body required' });
  try {
    const t = await pool.query('SELECT * FROM yc_tkt_mgmt.tickets WHERE id = $1', [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && t.rows[0].requester_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const r = await pool.query(`INSERT INTO yc_tkt_mgmt.comments (ticket_id, author_id, body, is_internal) VALUES ($1, $2, $3, $4) RETURNING *`,
      [t.rows[0].id, req.user.id, body.trim(), !!is_internal]);
    await pool.query(`UPDATE yc_tkt_mgmt.tickets SET updated_at = NOW() WHERE id = $1`, [t.rows[0].id]);
    await pool.query(`INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type) VALUES ($1, $2, 'comment')`, [t.rows[0].id, req.user.id]);
    res.status(201).json({ comment: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------
app.get('/api/dashboard', auth, requireRole('agent', 'manager', 'admin'), async (req, res) => {
  try {
    const summary = await pool.query(`
      SELECT
        SUM(CASE WHEN s.is_closed = FALSE THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN s.is_closed = TRUE THEN 1 ELSE 0 END) AS closed_count,
        SUM(CASE WHEN s.is_closed = FALSE AND t.due_at < NOW() THEN 1 ELSE 0 END) AS breached_open,
        SUM(CASE WHEN t.resolved_at >= NOW() - INTERVAL '1 day' THEN 1 ELSE 0 END) AS resolved_24h,
        COUNT(*) AS total
      FROM yc_tkt_mgmt.tickets t JOIN yc_tkt_mgmt.statuses s ON s.id = t.status_id
    `);
    const slaRow = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS total_closed,
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at <= due_at) AS met
      FROM yc_tkt_mgmt.tickets
    `);
    const tc = Number(slaRow.rows[0].total_closed) || 0;
    const met = Number(slaRow.rows[0].met) || 0;
    const slaPct = tc ? Math.round((met / tc) * 100) : 100;

    const byPriority = await pool.query(`
      SELECT p.id, p.label,
        COUNT(*) FILTER (WHERE s.is_closed = FALSE) AS open_count,
        COUNT(*) FILTER (WHERE s.is_closed = TRUE) AS closed_count
      FROM yc_tkt_mgmt.priorities p
      LEFT JOIN yc_tkt_mgmt.tickets t ON t.priority_id = p.id
      LEFT JOIN yc_tkt_mgmt.statuses s ON s.id = t.status_id
      GROUP BY p.id, p.label, p.sort_order ORDER BY p.sort_order
    `);
    const byCategory = await pool.query(`
      SELECT c.id, c.label, c.icon,
        COUNT(*) FILTER (WHERE s.is_closed = FALSE) AS open_count,
        COUNT(*) FILTER (WHERE s.is_closed = TRUE) AS closed_count
      FROM yc_tkt_mgmt.categories c
      LEFT JOIN yc_tkt_mgmt.tickets t ON t.category_id = c.id
      LEFT JOIN yc_tkt_mgmt.statuses s ON s.id = t.status_id
      GROUP BY c.id, c.label, c.icon, c.sort_order ORDER BY c.sort_order
    `);
    const agentLoad = await pool.query(`
      SELECT u.id, u.name, u.avatar_initials,
        COUNT(*) FILTER (WHERE s.is_closed = FALSE) AS open_count,
        COUNT(*) FILTER (WHERE s.is_closed = TRUE) AS resolved_count
      FROM yc_tkt_mgmt.users u
      LEFT JOIN yc_tkt_mgmt.tickets t ON t.assignee_id = u.id
      LEFT JOIN yc_tkt_mgmt.statuses s ON s.id = t.status_id
      WHERE u.role IN ('agent','manager')
      GROUP BY u.id, u.name, u.avatar_initials ORDER BY open_count DESC
    `);

    res.json({
      summary: { ...summary.rows[0], sla_pct: slaPct },
      byPriority: byPriority.rows,
      byCategory: byCategory.rows,
      agentLoad: agentLoad.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ENTERPRISE APPROVAL WORKFLOW ROUTES
// ============================================================
const enterpriseRoutes = require('./enterprise-routes.js')(pool);
app.use('/api', enterpriseRoutes);

// ============================================================
// STAFF MANAGEMENT ROUTES
// ============================================================
const staffRoutes = require('./staff-routes.js')(pool, JWT_SECRET);
app.use('/api', staffRoutes);

// ============================================================
// Serve Frontend
// ============================================================
const path = require('path');

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// SPA fallback: serve index.html for all routes not caught by API endpoints
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ============================================================
// Boot
// ============================================================
app.listen(PORT, () => {
  console.log(`✓ Yahweahcare API running on http://localhost:${PORT}`);
  console.log(`  Frontend:    http://localhost:${PORT}`);
  console.log(`  API Health:  curl http://localhost:${PORT}/api/health`);
});

// SLA breach checker (every 5 min)
setInterval(async () => {
  try {
    const r = await pool.query(`
      UPDATE yc_tkt_mgmt.tickets SET sla_breached = TRUE
      WHERE sla_breached = FALSE AND due_at < NOW()
      AND status_id IN (SELECT id FROM yc_tkt_mgmt.statuses WHERE is_closed = FALSE)
      RETURNING id
    `);
    if (r.rows.length) console.log(`[sla-checker] flagged ${r.rows.length} ticket(s)`);
  } catch (e) { /* ignore */ }
}, 5 * 60 * 1000);
