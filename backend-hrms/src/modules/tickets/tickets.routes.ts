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
    expectedCompletion: row.expected_completion || null,
    pendingApprovalAt: row.pending_approval_at || null,
    resolvedAt: row.resolved_at || null,
    closedAt: row.closed_at || null,
    slaBreached: !!row.sla_breached,
    isClosed: !!row.is_closed,
    isEscalated: !!row.is_escalated,
    escalatedTo: row.escalated_to || null,
    escalatedBy: row.escalated_by || null,
    escalatedAt: row.escalated_at || null,
    escalationReason: row.escalation_reason || null,
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
    // activity + comments + approvers fetched separately
    activity: row.activity || [],
    comments: row.comments || [],
    approvers: row.approvers || [],
  };
}

function dbApprover(row: Record<string, unknown>) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    userId: row.approver_user_id,
    userName: row.user_name || null,
    userEmail: row.user_email || null,
    status: row.approval_status,
    justification: row.comments || null,
    respondedAt: row.approval_date || null,
    createdAt: row.created_date,
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

// ── GET /tickets/:id — single ticket with comments+activity+approvers ─
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [{ rows: tRows }, { rows: cRows }, { rows: aRows }, { rows: apRows }] = await Promise.all([
      pool.query(`SELECT * FROM yc_tkt_mgmt.tickets WHERE id = $1`, [id]),
      pool.query(`SELECT * FROM yc_tkt_mgmt.comments WHERE ticket_id = $1 ORDER BY created_at ASC`, [id]),
      pool.query(`SELECT * FROM yc_tkt_mgmt.activity WHERE ticket_id = $1 ORDER BY created_at ASC`, [id]),
      pool.query(
        `SELECT ta.*, u.name AS user_name, u.email AS user_email
         FROM yc_tkt_mgmt.ticket_approvers ta
         JOIN yc_tkt_mgmt.users u ON u.id = ta.approver_user_id
         WHERE ta.ticket_id = $1 ORDER BY ta.created_date ASC`,
        [id]
      ),
    ]);
    if (!tRows[0]) return res.status(404).json({ error: 'not_found' });
    const t = dbTicket(tRows[0]);
    t.comments  = cRows.map(dbComment);
    t.activity  = aRows.map(dbActivity);
    t.approvers = apRows.map(dbApprover);
    res.json({ ticket: t });
  } catch (err) { next(err); }
});

// ── POST /tickets — create ──────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const {
      title, description, category, priority, status, site, assigneeId,
      approverIds, expectedCompletion,
      // frontend field aliases
      title_type, subtitle, category_id, priority_id, initial_status, assign_to, approver_ids, expected_completion
    } = req.body || {};

    // Normalise field names (frontend may use snake_case or camelCase)
    const resolvedTitle    = title    || [title_type, subtitle].filter(Boolean).join(' — ') || null;
    const resolvedCategory = category || category_id || null;
    const resolvedPriority = priority || priority_id || null;
    const resolvedStatus   = (status  || initial_status || 'open').toLowerCase();
    const resolvedAssignee = assigneeId || (assign_to && assign_to !== 'Unassigned' ? assign_to : null);
    const resolvedApprovers: number[] = Array.isArray(approverIds)
      ? approverIds
      : Array.isArray(approver_ids) ? approver_ids : [];
    const resolvedDueDate  = expectedCompletion || expected_completion || null;

    if (!resolvedTitle || !resolvedCategory || !resolvedPriority) {
      return res.status(400).json({ error: 'missing_fields', message: 'title, category, priority and expected_completion are required' });
    }
    if (!resolvedDueDate) {
      return res.status(400).json({ error: 'missing_fields', message: 'expected_completion is required' });
    }
    if (!resolvedApprovers.length) {
      return res.status(400).json({ error: 'missing_fields', message: 'At least one approver is required' });
    }

    // Generate ticket number
    const { rows: seqRow } = await pool.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM 'YAH-0*([0-9]+)') AS INTEGER)), 1000) + 1 AS next FROM yc_tkt_mgmt.tickets`
    );
    const ticketNumber = `YAH-${String(seqRow[0].next).padStart(6, '0')}`;

    // SLA-based due date (fallback)
    const { rows: priRows } = await pool.query(`SELECT sla_hours FROM yc_tkt_mgmt.priorities WHERE id = $1`, [resolvedPriority]);
    const slaHours = priRows[0]?.sla_hours || 24;
    const dueAt = new Date(Date.now() + slaHours * 3600000);

    // Resolve status
    const { rows: statRows } = await pool.query(`SELECT id FROM yc_tkt_mgmt.statuses WHERE id = $1`, [resolvedStatus]);
    const finalStatus = statRows[0]?.id || 'open';

    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.tickets
         (ticket_number, title, description, category_id, priority_id, status_id,
          requester_id, assignee_id, site, source, due_at, expected_completion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'web',$10,$11)
       RETURNING *`,
      [ticketNumber, resolvedTitle, description || req.body.issue_details || '', resolvedCategory, resolvedPriority,
       finalStatus, req.auth!.userId, resolvedAssignee || null, site || null, dueAt, resolvedDueDate]
    );
    const ticketId = rows[0].id;

    // Insert approvers
    for (const uid of resolvedApprovers) {
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.ticket_approvers (ticket_id, approver_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [ticketId, uid]
      );
    }

    // Activity log
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type) VALUES ($1,$2,'created')`,
      [ticketId, req.auth!.userId]
    );
    if (resolvedAssignee) {
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, to_value) VALUES ($1,$2,'assigned',$3)`,
        [ticketId, req.auth!.userId, String(resolvedAssignee)]
      );
    }

    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'ticket.create', module: 'tickets', targetType: 'ticket', targetId: ticketId, metadata: { ticketNumber, title: resolvedTitle }, req });

    // Return ticket with approvers
    const { rows: apRows } = await pool.query(
      `SELECT ta.*, u.name AS user_name, u.email AS user_email
       FROM yc_tkt_mgmt.ticket_approvers ta
       JOIN yc_tkt_mgmt.users u ON u.id = ta.approver_user_id
       WHERE ta.ticket_id = $1`, [ticketId]
    );
    const t = dbTicket(rows[0]);
    t.approvers = apRows.map(dbApprover);
    res.status(201).json({ ticket: t });
  } catch (err) { next(err); }
});

// ── POST /tickets/:id/complete — assignee marks work done ───
// Moves status to pending_approval; all approvers notified
router.post('/:id/complete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows: tRows } = await pool.query(`SELECT * FROM yc_tkt_mgmt.tickets WHERE id = $1`, [id]);
    if (!tRows[0]) return res.status(404).json({ error: 'not_found' });

    const { rows: apRows } = await pool.query(
      `SELECT count(*) FROM yc_tkt_mgmt.ticket_approvers WHERE ticket_id = $1`, [id]
    );
    if (Number(apRows[0].count) === 0) {
      return res.status(400).json({ error: 'no_approvers', message: 'Ticket has no approvers assigned' });
    }

    // Reset any previous approver decisions back to Pending
    await pool.query(
      `UPDATE yc_tkt_mgmt.ticket_approvers SET approval_status='Pending', comments=NULL, approval_date=NULL WHERE ticket_id=$1`,
      [id]
    );

    const { rows } = await pool.query(
      `UPDATE yc_tkt_mgmt.tickets
       SET status_id='pending_approval', pending_approval_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id]
    );

    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, to_value)
       VALUES ($1,$2,'status_changed','pending_approval')`,
      [id, req.auth!.userId]
    );

    await logAudit({ userId: req.auth!.userId, actorEmail: req.auth!.email, action: 'ticket.complete', module: 'tickets', targetType: 'ticket', targetId: id, metadata: {}, req });
    res.json({ ticket: dbTicket(rows[0]) });
  } catch (err) { next(err); }
});

// ── POST /tickets/:id/approve — approver approves ──────────
// If ALL approvers have approved → ticket becomes resolved
router.post('/:id/approve', async (req, res, next) => {
  try {
    const id     = Number(req.params.id);
    const userId = req.auth!.userId;

    const { rows: apRow } = await pool.query(
      `SELECT * FROM yc_tkt_mgmt.ticket_approvers WHERE ticket_id=$1 AND approver_user_id=$2`, [id, userId]
    );
    if (!apRow[0]) return res.status(403).json({ error: 'not_approver', message: 'You are not an approver for this ticket' });

    await pool.query(
      `UPDATE yc_tkt_mgmt.ticket_approvers
       SET approval_status='Approved', approval_date=NOW(), comments=NULL
       WHERE ticket_id=$1 AND approver_user_id=$2`,
      [id, userId]
    );

    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, to_value)
       VALUES ($1,$2,'approved', $3)`,
      [id, userId, req.auth!.email]
    );

    // Check if ALL approvers have now approved
    const { rows: pendingRows } = await pool.query(
      `SELECT count(*) FROM yc_tkt_mgmt.ticket_approvers WHERE ticket_id=$1 AND approval_status != 'Approved'`, [id]
    );

    let ticket;
    if (Number(pendingRows[0].count) === 0) {
      // All approved → resolve
      const { rows } = await pool.query(
        `UPDATE yc_tkt_mgmt.tickets
         SET status_id='resolved', resolved_at=NOW(), updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id]
      );
      ticket = rows[0];
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, to_value)
         VALUES ($1,$2,'status_changed','resolved')`,
        [id, userId]
      );
    } else {
      const { rows } = await pool.query(`SELECT * FROM yc_tkt_mgmt.tickets WHERE id=$1`, [id]);
      ticket = rows[0];
    }

    const { rows: allAp } = await pool.query(
      `SELECT ta.*, u.name AS user_name, u.email AS user_email
       FROM yc_tkt_mgmt.ticket_approvers ta
       JOIN yc_tkt_mgmt.users u ON u.id = ta.approver_user_id
       WHERE ta.ticket_id=$1`, [id]
    );
    const t = dbTicket(ticket);
    t.approvers = allAp.map(dbApprover);
    await logAudit({ userId, actorEmail: req.auth!.email, action: 'ticket.approve', module: 'tickets', targetType: 'ticket', targetId: id, metadata: {}, req });
    res.json({ ticket: t });
  } catch (err) { next(err); }
});

// ── POST /tickets/:id/reject — approver rejects (reopens) ──
// Sets status back to in_progress, records justification
router.post('/:id/reject', async (req, res, next) => {
  try {
    const id     = Number(req.params.id);
    const userId = req.auth!.userId;
    const { justification } = req.body || {};

    if (!justification?.trim()) {
      return res.status(400).json({ error: 'justification_required', message: 'A justification is required to reject the resolution' });
    }

    const { rows: apRow } = await pool.query(
      `SELECT * FROM yc_tkt_mgmt.ticket_approvers WHERE ticket_id=$1 AND approver_user_id=$2`, [id, userId]
    );
    if (!apRow[0]) return res.status(403).json({ error: 'not_approver', message: 'You are not an approver for this ticket' });

    await pool.query(
      `UPDATE yc_tkt_mgmt.ticket_approvers
       SET approval_status='Rejected', approval_date=NOW(), comments=$3
       WHERE ticket_id=$1 AND approver_user_id=$2`,
      [id, userId, justification.trim()]
    );

    // Reopen ticket — back to in_progress
    const { rows } = await pool.query(
      `UPDATE yc_tkt_mgmt.tickets
       SET status_id='in_progress', pending_approval_at=NULL, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id]
    );

    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, from_value, to_value, metadata)
       VALUES ($1,$2,'rejected','pending_approval','in_progress',$3)`,
      [id, userId, JSON.stringify({ justification: justification.trim(), rejectedBy: req.auth!.email })]
    );

    const { rows: allAp } = await pool.query(
      `SELECT ta.*, u.name AS user_name, u.email AS user_email
       FROM yc_tkt_mgmt.ticket_approvers ta
       JOIN yc_tkt_mgmt.users u ON u.id = ta.approver_user_id
       WHERE ta.ticket_id=$1`, [id]
    );
    const t = dbTicket(rows[0]);
    t.approvers = allAp.map(dbApprover);
    await logAudit({ userId, actorEmail: req.auth!.email, action: 'ticket.reject', module: 'tickets', targetType: 'ticket', targetId: id, metadata: { justification }, req });
    res.json({ ticket: t });
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

// ── POST /tickets/:id/escalate — manager escalates to any user ─
// Reassigns ticket + logs full escalation trail
router.post('/:id/escalate', async (req, res, next) => {
  try {
    const id     = Number(req.params.id);
    const userId = req.auth!.userId;
    const { escalateToUserId, reason } = req.body || {};

    if (!escalateToUserId) {
      return res.status(400).json({ error: 'missing_fields', message: 'escalateToUserId is required' });
    }
    if (!reason?.trim()) {
      return res.status(400).json({ error: 'missing_fields', message: 'Escalation reason is required' });
    }

    // Verify target user exists
    const { rows: targetRows } = await pool.query(
      `SELECT id, name, email FROM yc_tkt_mgmt.users WHERE id = $1`, [escalateToUserId]
    );
    if (!targetRows[0]) return res.status(404).json({ error: 'user_not_found', message: 'Escalation target user not found' });

    // Get current ticket
    const { rows: tRows } = await pool.query(`SELECT * FROM yc_tkt_mgmt.tickets WHERE id = $1`, [id]);
    if (!tRows[0]) return res.status(404).json({ error: 'not_found' });
    const previousAssignee = tRows[0].assignee_id;

    // Log escalation history
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.ticket_escalations (ticket_id, escalated_by, escalated_to, reason, previous_assignee)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, userId, escalateToUserId, reason.trim(), previousAssignee || null]
    );

    // Reassign + mark escalated
    const { rows } = await pool.query(
      `UPDATE yc_tkt_mgmt.tickets
       SET assignee_id=$1, is_escalated=TRUE, escalated_to=$1,
           escalated_by=$2, escalated_at=NOW(), escalation_reason=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [escalateToUserId, userId, reason.trim(), id]
    );

    // Activity log
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, from_value, to_value, metadata)
       VALUES ($1,$2,'escalated',$3,$4,$5)`,
      [id, userId,
       previousAssignee ? String(previousAssignee) : null,
       String(escalateToUserId),
       JSON.stringify({ reason: reason.trim(), escalatedTo: targetRows[0].name, escalatedToEmail: targetRows[0].email })]
    );

    await logAudit({ userId, actorEmail: req.auth!.email, action: 'ticket.escalate', module: 'tickets', targetType: 'ticket', targetId: id, metadata: { escalateToUserId, reason: reason.trim() }, req });

    // Fetch approvers for response
    const { rows: apRows } = await pool.query(
      `SELECT ta.*, u.name AS user_name, u.email AS user_email
       FROM yc_tkt_mgmt.ticket_approvers ta
       JOIN yc_tkt_mgmt.users u ON u.id = ta.approver_user_id
       WHERE ta.ticket_id=$1`, [id]
    );

    // Fetch escalation trail
    const { rows: escRows } = await pool.query(
      `SELECT te.*,
              ub.name AS escalated_by_name,
              ut.name AS escalated_to_name
       FROM yc_tkt_mgmt.ticket_escalations te
       JOIN yc_tkt_mgmt.users ub ON ub.id = te.escalated_by
       JOIN yc_tkt_mgmt.users ut ON ut.id = te.escalated_to
       WHERE te.ticket_id=$1 ORDER BY te.created_at ASC`, [id]
    );

    const t = dbTicket(rows[0]);
    t.approvers = apRows.map(dbApprover);
    t.escalations = escRows;
    res.json({ ticket: t });
  } catch (err) { next(err); }
});

// ── GET /tickets/:id/escalations — escalation trail ─────────
router.get('/:id/escalations', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT te.*,
              ub.name AS escalated_by_name, ub.email AS escalated_by_email,
              ut.name AS escalated_to_name, ut.email AS escalated_to_email
       FROM yc_tkt_mgmt.ticket_escalations te
       JOIN yc_tkt_mgmt.users ub ON ub.id = te.escalated_by
       JOIN yc_tkt_mgmt.users ut ON ut.id = te.escalated_to
       WHERE te.ticket_id=$1 ORDER BY te.created_at ASC`, [id]
    );
    res.json({ escalations: rows });
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
