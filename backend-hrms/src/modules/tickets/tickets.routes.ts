// ============================================================
// Tickets routes — full CRUD + comments + activity
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { logAudit } from '../audit/audit.service';

const router = Router();
router.use(requireAuth);

// ── Mapper: DB row → frontend shape ────────────────────────
function dbTicket(row: Record<string, unknown>) {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    title: row.title,
    description: row.description || '',
    category: row.category_id,
    priority: row.priority_id,
    status: row.status_id,
    requesterId: row.requester_id,
    assigneeId: row.assignee_id || null,
    site: row.site || '',
    source: row.source || 'web',
    dueAt: row.due_at,
    resolvedAt: row.resolved_at || null,
    closedAt: row.closed_at || null,
    slaBreached: !!row.sla_breached,
    isClosed: !!row.is_closed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // enriched label fields (present when queried via v_open_tickets)
    categoryLabel:  row.category_label  || null,
    categoryIcon:   row.category_icon   || null,
    priorityLabel:  row.priority_label  || null,
    slaHours:       row.sla_hours       || null,
    statusLabel:    row.status_label    || null,
    requesterName:  row.requester_name  || null,
    requesterEmail: row.requester_email || null,
    assigneeName:   row.assignee_name   || null,
    assigneeEmail:  row.assignee_email  || null,
    // activity + comments fetched separately
    activity: row.activity || [],
    comments: row.comments || [],
  };
}

function dbComment(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    ticketId: row.ticket_id,
    userId: row.author_id,
    text: row.body,
    isInternal: !!row.is_internal,
    at: row.created_at,
  };
}

function dbActivity(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    ticketId: row.ticket_id,
    userId: row.actor_id,
    action: row.action_type,
    fromValue: row.from_value || null,
    toValue: row.to_value || null,
    metadata: row.metadata || {},
    at: row.created_at,
  };
}

// ── GET /tickets — list (uses v_open_tickets for enriched labels) ───────────
router.get('/', async (req, res, next) => {
  try {
    const limit    = Math.min(Number(req.query.limit) || 200, 500);
    const offset   = Number(req.query.offset) || 0;
    const status   = (req.query.status   as string || '').trim();
    const priority = (req.query.priority as string || '').trim();
    const category = (req.query.category as string || '').trim();
    const all      = (req.query.all      as string || '').trim(); // ?all=1 → include closed tickets

    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (status)   { where.push(`v.status_id   = $${i++}`); params.push(status); }
    if (priority) { where.push(`v.priority_id = $${i++}`); params.push(priority); }
    if (category) { where.push(`v.category_id = $${i++}`); params.push(category); }

    // v_open_tickets excludes closed rows; ?all=1 reads the base tickets table instead
    const source = all === '1'
      ? 'yc_tkt_mgmt.tickets'
      : 'yc_tkt_mgmt.v_open_tickets';

    const { rows } = await pool.query(
      `SELECT v.*, COUNT(*) OVER() AS total
       FROM ${source} v
       WHERE ${where.join(' AND ')}
       ORDER BY v.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );

    const ticketIds = rows.map(r => r.id);
    let commentRows: Record<string, unknown>[] = [];
    let activityRows: Record<string, unknown>[] = [];

    if (ticketIds.length > 0) {
      const [cRes, aRes] = await Promise.all([
        pool.query(`SELECT * FROM yc_tkt_mgmt.comments WHERE ticket_id = ANY($1) ORDER BY created_at ASC`, [ticketIds]),
        pool.query(`SELECT * FROM yc_tkt_mgmt.activity WHERE ticket_id = ANY($1) ORDER BY created_at ASC`, [ticketIds]),
      ]);
      commentRows  = cRes.rows;
      activityRows = aRes.rows;
    }

    const total = rows.length ? Number(rows[0].total) : 0;
    const tickets = rows.map(r => {
      const t = dbTicket(r);
      t.comments = commentRows.filter(c => c.ticket_id === r.id).map(dbComment);
      t.activity  = activityRows.filter(a => a.ticket_id === r.id).map(dbActivity);
      return t;
    });

    res.json({ tickets, total });
  } catch (err) { next(err); }
});

// ── GET /tickets/:id — single ticket with comments+activity ─
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [{ rows: tRows }, { rows: cRows }, { rows: aRows }] = await Promise.all([
      pool.query(`SELECT * FROM yc_tkt_mgmt.tickets WHERE id = $1`, [id]),
      pool.query(`SELECT * FROM yc_tkt_mgmt.comments WHERE ticket_id = $1 ORDER BY created_at ASC`, [id]),
      pool.query(`SELECT * FROM yc_tkt_mgmt.activity WHERE ticket_id = $1 ORDER BY created_at ASC`, [id]),
    ]);
    if (!tRows[0]) return res.status(404).json({ error: 'not_found' });
    const t = dbTicket(tRows[0]);
    t.comments = cRows.map(dbComment);
    t.activity = aRows.map(dbActivity);
    res.json({ ticket: t });
  } catch (err) { next(err); }
});

// ── POST /tickets — create ──────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { title, description, category, priority, status, site, assigneeId } = req.body || {};
    if (!title || !category || !priority) {
      return res.status(400).json({ error: 'missing_fields', message: 'title, category and priority are required' });
    }

    // Generate ticket number
    const { rows: seqRow } = await pool.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM 'YAH-0*([0-9]+)') AS INTEGER)), 1000) + 1 AS next FROM yc_tkt_mgmt.tickets`
    );
    const ticketNumber = `YAH-${String(seqRow[0].next).padStart(6, '0')}`;

    // Calculate due date from priority SLA — fallback to 24h if priority not in DB
    const { rows: priRows } = await pool.query(`SELECT sla_hours FROM yc_tkt_mgmt.priorities WHERE id = $1`, [priority]);
    const slaHours = priRows[0]?.sla_hours || 24;
    const dueAt = new Date(Date.now() + slaHours * 3600000);

    // Resolve status: use passed value if it exists in DB, otherwise use first available status
    const passedStatus = (status || 'open').toLowerCase();
    const { rows: statRows } = await pool.query(
      `SELECT id FROM yc_tkt_mgmt.statuses WHERE id = $1`, [passedStatus]
    );
    const resolvedStatus = statRows[0]?.id || 'open';

    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.tickets
         (ticket_number, title, description, category_id, priority_id, status_id, requester_id, assignee_id, site, source, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'web',$10)
       RETURNING *`,
      [ticketNumber, title, description || '', category, priority, resolvedStatus, req.auth!.userId, assigneeId || null, site || null, dueAt]
    );

    // Log creation activity
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type) VALUES ($1,$2,'created')`,
      [rows[0].id, req.auth!.userId]
    );

    if (assigneeId) {
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, to_value) VALUES ($1,$2,'assigned',$3)`,
        [rows[0].id, req.auth!.userId, String(assigneeId)]
      );
    }

    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'ticket.create', module: 'tickets', targetType: 'ticket', targetId: rows[0].id, metadata: { ticketNumber, title }, req });
    res.status(201).json({ ticket: dbTicket(rows[0]) });
  } catch (err) { next(err); }
});

// ── PATCH /tickets/:id — update ─────────────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: existing } = await pool.query(`SELECT * FROM yc_tkt_mgmt.tickets WHERE id = $1`, [id]);
    if (!existing[0]) return res.status(404).json({ error: 'not_found' });
    const old = existing[0];

    const colMap: Record<string, string> = {
      title: 'title', description: 'description', category: 'category_id',
      priority: 'priority_id', status: 'status_id', assigneeId: 'assignee_id',
      site: 'site', resolvedAt: 'resolved_at', closedAt: 'closed_at', slaBreached: 'sla_breached',
    };
    const updates: string[] = []; const values: unknown[] = []; let i = 1;
    for (const [fKey, dbCol] of Object.entries(colMap)) {
      if (fKey in req.body) { updates.push(`${dbCol} = $${i++}`); values.push(req.body[fKey]); }
    }
    if (!updates.length) return res.json({ ticket: dbTicket(old) });
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE yc_tkt_mgmt.tickets SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      values
    );

    // Record activity for key field changes
    const activityInserts: Promise<unknown>[] = [];
    if ('status' in req.body && req.body.status !== old.status_id) {
      activityInserts.push(pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, from_value, to_value) VALUES ($1,$2,'status_changed',$3,$4)`,
        [id, req.auth!.userId, old.status_id, req.body.status]
      ));
    }
    if ('assigneeId' in req.body && req.body.assigneeId !== old.assignee_id) {
      activityInserts.push(pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, from_value, to_value) VALUES ($1,$2,'assigned',$3,$4)`,
        [id, req.auth!.userId, old.assignee_id ? String(old.assignee_id) : null, req.body.assigneeId ? String(req.body.assigneeId) : null]
      ));
    }
    if ('priority' in req.body && req.body.priority !== old.priority_id) {
      activityInserts.push(pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, from_value, to_value) VALUES ($1,$2,'priority_changed',$3,$4)`,
        [id, req.auth!.userId, old.priority_id, req.body.priority]
      ));
    }
    await Promise.all(activityInserts);

    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'ticket.update', module: 'tickets', targetType: 'ticket', targetId: id, metadata: req.body, req });
    res.json({ ticket: dbTicket(rows[0]) });
  } catch (err) { next(err); }
});

// ── DELETE /tickets/:id ─────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`SELECT id, ticket_number FROM yc_tkt_mgmt.tickets WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    await pool.query(`DELETE FROM yc_tkt_mgmt.tickets WHERE id = $1`, [id]);
    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'ticket.delete', module: 'tickets', targetType: 'ticket', targetId: id, metadata: { ticketNumber: rows[0].ticket_number }, req });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /tickets/:id/comments ───────────────────────────────
router.get('/:id/comments', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM yc_tkt_mgmt.comments WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [Number(req.params.id)]
    );
    res.json({ comments: rows.map(dbComment) });
  } catch (err) { next(err); }
});

// ── POST /tickets/:id/comments ──────────────────────────────
router.post('/:id/comments', async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const { body, isInternal } = req.body || {};
    if (!body?.trim()) return res.status(400).json({ error: 'missing_body' });

    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.comments (ticket_id, author_id, body, is_internal) VALUES ($1,$2,$3,$4) RETURNING *`,
      [ticketId, req.auth!.userId, body.trim(), !!isInternal]
    );
    // Activity log
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type) VALUES ($1,$2,'commented')`,
      [ticketId, req.auth!.userId]
    );
    res.status(201).json({ comment: dbComment(rows[0]) });
  } catch (err) { next(err); }
});

// ── GET /tickets/:id/activity ───────────────────────────────
router.get('/:id/activity', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM yc_tkt_mgmt.activity WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [Number(req.params.id)]
    );
    res.json({ activity: rows.map(dbActivity) });
  } catch (err) { next(err); }
});

export default router;
