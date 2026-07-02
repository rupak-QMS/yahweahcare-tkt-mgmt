// ticket-routes.js — extracted ticket CRUD routes for testability
// Usage: require('./ticket-routes')(pool, auth, { nextTicketNumber, slaHoursFor, queueEmail, sendPushToUser })

const express = require('express');

module.exports = function ticketRoutes(pool, auth, helpers = {}) {
  const router = express.Router();

  const nextTicketNumber = helpers.nextTicketNumber || async function () {
    const r = await pool.query(
      "SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM 5) AS INTEGER)), 0) AS n FROM yc_tkt_mgmt.tickets"
    );
    return 'YAH-' + String(r.rows[0].n + 1).padStart(6, '0');
  };

  const slaHoursFor = helpers.slaHoursFor || async function (priorityId) {
    const r = await pool.query('SELECT sla_hours FROM yc_tkt_mgmt.priorities WHERE id = $1', [priorityId]);
    return r.rows[0]?.sla_hours || 24;
  };

  const queueEmail      = helpers.queueEmail      || (() => Promise.resolve());
  const sendPushToUser  = helpers.sendPushToUser   || (() => Promise.resolve());

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
      next();
    };
  }

  // ──────────────────────────────────────────────────────────
  // GET /api/tickets
  // ──────────────────────────────────────────────────────────
  router.get('/tickets', auth, async (req, res) => {
    try {
      const { status, priority, category, assignee, q, limit = 100 } = req.query;
      const where = ['1=1'];
      const params = [];
      let i = 1;

      if (req.user.role === 'staff') {
        where.push(`t.requester_id = $${i++}`);
        params.push(req.user.id);
      }
      if (status)   { where.push(`t.status_id   = $${i++}`); params.push(status); }
      if (priority) { where.push(`t.priority_id = $${i++}`); params.push(priority); }
      if (category) { where.push(`t.category_id = $${i++}`); params.push(category); }
      if (assignee === 'me')         { where.push(`t.assignee_id = $${i++}`); params.push(req.user.id); }
      else if (assignee === 'unassigned') { where.push('t.assignee_id IS NULL'); }
      else if (assignee)             { where.push(`t.assignee_id = $${i++}`); params.push(assignee); }
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
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────
  // GET /api/tickets/:id
  // ──────────────────────────────────────────────────────────
  router.get('/tickets/:id', auth, async (req, res) => {
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
      if (req.user.role === 'staff' && ticket.requester_id !== req.user.id)
        return res.status(403).json({ error: 'Forbidden' });

      const [comments, activity] = await Promise.all([
        pool.query(
          `SELECT c.*, u.name AS author_name, u.avatar_initials AS author_initials
           FROM yc_tkt_mgmt.comments c
           JOIN yc_tkt_mgmt.users u ON u.id = c.author_id
           WHERE c.ticket_id = $1 ORDER BY c.created_at`,
          [ticket.id]
        ),
        pool.query(
          `SELECT a.*, u.name AS actor_name
           FROM yc_tkt_mgmt.activity a
           LEFT JOIN yc_tkt_mgmt.users u ON u.id = a.actor_id
           WHERE a.ticket_id = $1 ORDER BY a.created_at`,
          [ticket.id]
        ),
      ]);

      res.json({ ticket: { ...ticket, comments: comments.rows, activity: activity.rows } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────
  // POST /api/tickets
  // ──────────────────────────────────────────────────────────
  router.post('/tickets', auth, async (req, res) => {
    const { title, description, category_id, priority_id, site, assignee_id } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
    try {
      const sla = await slaHoursFor(priority_id || 'medium');
      const tn  = await nextTicketNumber();
      const r   = await pool.query(`
        INSERT INTO yc_tkt_mgmt.tickets
          (ticket_number, title, description, category_id, priority_id, status_id,
           requester_id, assignee_id, site, due_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 'new', $6, $7, $8, NOW() + ($9 || ' hours')::interval, NOW(), NOW())
        RETURNING id
      `, [tn, title.trim(), description || '', category_id || 'general', priority_id || 'medium',
          req.user.id, assignee_id || null, site || req.user.site, String(sla)]);

      await pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, to_value) VALUES ($1, $2, 'created', 'new')`,
        [r.rows[0].id, req.user.id]
      );

      const ticketId = r.rows[0].id;

      // Notify requester
      await queueEmail(pool, {
        to: req.user.email,
        subject: `[Yahweahcare] Ticket ${tn} received: ${title}`,
        bodyText: `Hi ${req.user.name.split(' ')[0]},\n\nWe've received your ticket "${title}". SLA target: ${sla}h.\n\n— Yahweahcare Service Desk`,
        ticketId, ticketRef: tn, eventName: 'TicketCreated',
      });
      sendPushToUser(pool, req.user.id, {
        title: `Ticket ${tn} received`,
        body:  `"${title}" has been logged. SLA: ${sla}h.`,
        data:  { url: '/#tickets' },
      }).catch(() => {});

      // Notify assignee (if provided and different from requester)
      if (assignee_id && assignee_id !== req.user.id) {
        const au = await pool.query('SELECT name, email FROM yc_tkt_mgmt.users WHERE id = $1', [assignee_id]);
        if (au.rows[0]) {
          const a = au.rows[0];
          await queueEmail(pool, {
            to: a.email,
            subject: `[Yahweahcare] Ticket ${tn} assigned to you: ${title}`,
            bodyText: `Hi ${a.name.split(' ')[0]},\n\nTicket ${tn} has been assigned to you.\n\nTitle: ${title}\nPriority: ${priority_id || 'medium'}\nSLA: ${sla}h\n\n— Yahweahcare Service Desk`,
            ticketId, ticketRef: tn, eventName: 'TicketAssigned',
          });
          sendPushToUser(pool, assignee_id, {
            title: `Ticket ${tn} assigned to you`,
            body:  `"${title}" — SLA: ${sla}h`,
            data:  { url: `/#tickets/${ticketId}` },
          }).catch(() => {});
        }
      }

      res.status(201).json({ id: ticketId, ticket_number: tn });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────
  // PATCH /api/tickets/:id
  // ──────────────────────────────────────────────────────────
  router.patch('/tickets/:id', auth, async (req, res) => {
    try {
      const current = await pool.query('SELECT * FROM yc_tkt_mgmt.tickets WHERE id = $1', [req.params.id]);
      if (!current.rows.length) return res.status(404).json({ error: 'Not found' });
      const t = current.rows[0];
      if (req.user.role === 'staff' && t.requester_id !== req.user.id)
        return res.status(403).json({ error: 'Forbidden' });

      const allowed = req.user.role === 'staff'
        ? ['title', 'description']
        : ['title', 'description', 'category_id', 'priority_id', 'status_id', 'assignee_id', 'site'];

      const updates = [];
      const params  = [];
      let i = 1;
      for (const k of allowed) {
        if (k in req.body && req.body[k] !== t[k]) {
          updates.push(`${k} = $${i++}`);
          params.push(req.body[k]);
        }
      }
      // Only set resolved_at/closed_at when status_id is actually being updated
      // (i.e. it's in the allowed list and the value changed)
      const statusIsChanging = allowed.includes('status_id') &&
        'status_id' in req.body && req.body.status_id !== t.status_id;
      if (statusIsChanging && (req.body.status_id === 'resolved' || req.body.status_id === 'closed')) {
        updates.push(`resolved_at = COALESCE(resolved_at, NOW())`);
      }
      if (statusIsChanging && req.body.status_id === 'closed') updates.push(`closed_at = NOW()`);
      if (updates.length === 0) return res.json({ ok: true });
      updates.push('updated_at = NOW()');
      params.push(req.params.id);

      await pool.query(
        `UPDATE yc_tkt_mgmt.tickets SET ${updates.join(', ')} WHERE id = $${i}`,
        params
      );

      for (const k of allowed) {
        if (k in req.body && req.body[k] !== t[k]) {
          const at = k === 'status_id'   ? 'status_change'
                   : k === 'assignee_id' ? 'assigned'
                   : k === 'priority_id' ? 'priority_change'
                   : 'edit';
          await pool.query(
            `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, from_value, to_value)
             VALUES ($1, $2, $3, $4, $5)`,
            [t.id, req.user.id, at, String(t[k] || ''), String(req.body[k] || '')]
          );
        }
      }

      // Notify new assignee when assignment changes
      if ('assignee_id' in req.body && req.body.assignee_id && req.body.assignee_id !== t.assignee_id) {
        const au = await pool.query('SELECT name, email FROM yc_tkt_mgmt.users WHERE id = $1', [req.body.assignee_id]);
        if (au.rows[0]) {
          const a = au.rows[0];
          await queueEmail(pool, {
            to: a.email,
            subject: `[Yahweahcare] Ticket ${t.ticket_number} assigned to you: ${t.title}`,
            bodyText: `Hi ${a.name.split(' ')[0]},\n\nTicket ${t.ticket_number} has been assigned to you.\n\nTitle: ${t.title}\n\n— Yahweahcare Service Desk`,
            ticketId: t.id, ticketRef: t.ticket_number, eventName: 'TicketAssigned',
          });
          sendPushToUser(pool, req.body.assignee_id, {
            title: `Ticket ${t.ticket_number} assigned to you`,
            body:  `"${t.title}"`,
            data:  { url: `/#tickets/${t.id}` },
          }).catch(() => {});
        }
      }

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────
  // POST /api/tickets/:id/comments
  // ──────────────────────────────────────────────────────────
  router.post('/tickets/:id/comments', auth, async (req, res) => {
    const { body, is_internal } = req.body || {};
    if (!body?.trim()) return res.status(400).json({ error: 'Body required' });
    try {
      const t = await pool.query('SELECT * FROM yc_tkt_mgmt.tickets WHERE id = $1', [req.params.id]);
      if (!t.rows.length) return res.status(404).json({ error: 'Not found' });
      if (req.user.role === 'staff' && t.rows[0].requester_id !== req.user.id)
        return res.status(403).json({ error: 'Forbidden' });

      const r = await pool.query(
        `INSERT INTO yc_tkt_mgmt.comments (ticket_id, author_id, body, is_internal) VALUES ($1, $2, $3, $4) RETURNING *`,
        [t.rows[0].id, req.user.id, body.trim(), !!is_internal]
      );
      await pool.query(
        `UPDATE yc_tkt_mgmt.tickets SET updated_at = NOW() WHERE id = $1`,
        [t.rows[0].id]
      );
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type) VALUES ($1, $2, 'comment')`,
        [t.rows[0].id, req.user.id]
      );
      res.status(201).json({ comment: r.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
