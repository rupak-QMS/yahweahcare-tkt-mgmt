// ============================================================
// Tickets routes — full CRUD + comments + activity
// ============================================================

import { Router } from 'express';
import { pool } from '../../db/pool';
import { requireAuth, optionalAuth } from '../../middleware/auth.middleware';
import { logAudit } from '../audit/audit.service';
import { notify } from '../notifications/notifications.service';

// Helper: get actor name + ticket dept from DB
async function getActorName(userId: number | null): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const { rows } = await pool.query(`SELECT name FROM yc_tkt_mgmt.users WHERE id=$1`, [userId]);
    return rows[0]?.name;
  } catch { return undefined; }
}
async function getTicketDept(creatorId: number | null, assigneeId: number | null): Promise<number | undefined> {
  const id = creatorId || assigneeId;
  if (!id) return undefined;
  try {
    const { rows } = await pool.query(`SELECT department_id FROM yc_tkt_mgmt.users WHERE id=$1`, [id]);
    return rows[0]?.department_id ?? undefined;
  } catch { return undefined; }
}

const router = Router();

// ── Mapper: DB row → frontend shape ────────────────────────
// Actual table columns (schema yc_tkt_mgmt.tickets):
//   status (not status_id), assigned_to (not assignee_id),
//   created_by (not requester_id), due_date (not due_at),
//   closed_date (not resolved_at/closed_at), no ticket_number/site/source/sla_breached/is_closed
function dbTicket(row: Record<string, unknown>) {
  const dueDate    = row.due_date    ? new Date(row.due_date    as string) : null;
  const closedDate = row.closed_date ? new Date(row.closed_date as string) : null;
  const status     = (row.status || '') as string;
  const isClosed   = status === 'resolved' || status === 'closed' || !!closedDate;
  const slaBreached = !!(closedDate && dueDate && closedDate > dueDate);
  return {
    id: row.id,
    ticketNumber: `TKT-${String(row.id).padStart(6, '0')}`,
    title: row.title,
    description: row.description || '',
    category: row.category_id,
    priority: row.priority_id,
    status,
    requesterId: row.created_by,
    assigneeId: row.assigned_to || null,
    site: '',
    source: 'web',
    dueAt: row.due_date,
    expectedCompletion: row.expected_completion || null,
    pendingApprovalAt: row.pending_approval_at || null,
    resolvedAt: row.closed_date || null,
    closedAt: row.closed_date || null,
    slaBreached,
    isClosed,
    ndisRelated: !!row.ndis_related,
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
  const details = row.details
    ? (typeof row.details === 'string' ? JSON.parse(row.details) : row.details) as Record<string, unknown>
    : {};
  return {
    id: String(row.id),
    ticketId: row.ticket_id,
    userId: row.user_id,
    action: row.action,
    fromValue: details.from ?? null,
    toValue: details.to ?? null,
    metadata: details,
    at: row.created_at,
  };
}

// ── GET /tickets ─────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const limit    = Math.min(Number(req.query.limit) || 200, 500);
    const offset   = Number(req.query.offset) || 0;
    const status   = (req.query.status   as string || '').trim();
    const priority = (req.query.priority as string || '').trim();
    const category = (req.query.category as string || '').trim();
    const all      = (req.query.all      as string || '').trim(); // ?all=1 → include closed tickets

    // Role-based scope:
    //   scope=all              → Bootstrap Admin / Director   — no extra filter
    //   scope=dept&deptId=N    → Manager                     — tickets in that department
    //   scope=mine&userId=N    → Everyone else               — own + pending-approval tickets
    const scope  = (req.query.scope  as string || '').trim();
    const userId = req.query.userId  ? Number(req.query.userId)  : null;
    const deptId = req.query.deptId  ? Number(req.query.deptId)  : null;

    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (status)   { where.push(`v.status = $${i++}`); params.push(status); }
    if (priority) { where.push(`v.priority_id = $${i++}`); params.push(priority); }
    if (category) { where.push(`v.category_id = $${i++}`); params.push(category); }

    // Apply role scope
    if (scope === 'dept' && deptId) {
      where.push(
        `(v.assigned_to IN (SELECT id FROM yc_tkt_mgmt.users WHERE department_id = $${i++})` +
        ` OR v.created_by IN (SELECT id FROM yc_tkt_mgmt.users WHERE department_id = $${i++}))`
      );
      params.push(deptId, deptId);
    } else if (scope === 'mine' && userId) {
      // Own tickets + any tickets pending this user's approval
      where.push(
        `(v.created_by = $${i} OR v.assigned_to = $${i}` +
        ` OR EXISTS (SELECT 1 FROM yc_tkt_mgmt.ticket_approvers ta` +
        `  WHERE ta.ticket_id = v.id AND ta.approver_user_id = $${i} AND ta.approval_status = 'Pending'))`
      );
      params.push(userId); i++;
    }
    // scope=all or no scope → no additional filter

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

// ── GET /tickets/stats — server-side aggregation for Analytics page ──────────
// Returns pre-aggregated counts so the frontend never needs to pull 500 raw rows.
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const days   = Math.min(Math.max(Number(req.query.days) || 90, 1), 365);
    const scope  = (req.query.scope  as string || '').trim();
    const userId = req.query.userId ? Number(req.query.userId) : null;
    const deptId = req.query.deptId ? Number(req.query.deptId) : null;
    const now    = new Date();
    const cutoff = new Date(now); cutoff.setDate(now.getDate() - days);

    // Build scope WHERE clause
    const scopeParams: unknown[] = [cutoff];
    let scopeWhere = 't.created_at >= $1';
    let pi = 2;
    if (scope === 'dept' && deptId) {
      scopeWhere += ` AND (t.assigned_to IN (SELECT id FROM yc_tkt_mgmt.users WHERE department_id=$${pi}) OR t.created_by IN (SELECT id FROM yc_tkt_mgmt.users WHERE department_id=$${pi+1}))`;
      scopeParams.push(deptId, deptId); pi += 2;
    } else if (scope === 'mine' && userId) {
      scopeWhere += ` AND (t.created_by=$${pi} OR t.assigned_to=$${pi})`;
      scopeParams.push(userId); pi++;
    }

    const [statusRes, categoryRes, priorityRes, staffRes, ndisRes, slaRes, monthlyRes] = await Promise.all([
      // Status counts
      pool.query(`SELECT t.status, COUNT(*) AS cnt FROM yc_tkt_mgmt.tickets t WHERE ${scopeWhere} GROUP BY t.status`, scopeParams),
      // Category counts (with label)
      pool.query(`SELECT c.label AS category, COUNT(*) AS cnt FROM yc_tkt_mgmt.tickets t LEFT JOIN yc_tkt_mgmt.categories c ON c.id=t.category_id WHERE ${scopeWhere} GROUP BY c.label ORDER BY cnt DESC LIMIT 10`, scopeParams),
      // Priority counts (with label)
      pool.query(`SELECT p.label AS priority, COUNT(*) AS cnt FROM yc_tkt_mgmt.tickets t LEFT JOIN yc_tkt_mgmt.priorities p ON p.id=t.priority_id WHERE ${scopeWhere} GROUP BY p.label ORDER BY cnt DESC`, scopeParams),
      // Staff workload (assigned to)
      pool.query(`SELECT u.name AS assignee, COUNT(*) AS cnt FROM yc_tkt_mgmt.tickets t LEFT JOIN yc_tkt_mgmt.users u ON u.id=t.assigned_to WHERE ${scopeWhere} GROUP BY u.name ORDER BY cnt DESC LIMIT 20`, scopeParams),
      // NDIS count
      pool.query(`SELECT COUNT(*) FILTER (WHERE t.ndis_related) AS ndis_count, COUNT(*) AS total FROM yc_tkt_mgmt.tickets t WHERE ${scopeWhere}`, scopeParams),
      // SLA: resolved on time vs late + active overdue count
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE t.status IN ('resolved','closed') AND (t.due_date IS NULL OR t.closed_date IS NULL OR t.closed_date <= t.due_date)) AS sla_ok,
          COUNT(*) FILTER (WHERE t.status IN ('resolved','closed') AND t.due_date IS NOT NULL AND t.closed_date IS NOT NULL AND t.closed_date > t.due_date) AS sla_breached,
          COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed') AND t.due_date IS NOT NULL AND t.due_date < NOW()) AS active_overdue,
          COUNT(*) FILTER (WHERE t.status IN ('resolved','closed')) AS resolved_total,
          COUNT(*) FILTER (WHERE t.is_escalated) AS escalated,
          COUNT(*) AS total
        FROM yc_tkt_mgmt.tickets t WHERE ${scopeWhere}`, scopeParams),
      // Monthly trend — last 6 months regardless of period filter
      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', t.created_at), 'YYYY-MM') AS month, COUNT(*) AS cnt
        FROM yc_tkt_mgmt.tickets t
        WHERE t.created_at >= NOW() - INTERVAL '6 months'
        GROUP BY month ORDER BY month ASC`)
    ]);

    const sla = slaRes.rows[0];
    const slaEval = Number(sla.resolved_total) + Number(sla.active_overdue);

    res.json({
      period: { days, from: cutoff.toISOString(), to: now.toISOString() },
      total:      Number(sla.total),
      resolved:   Number(sla.resolved_total),
      escalated:  Number(sla.escalated),
      ndis:       Number(ndisRes.rows[0].ndis_count),
      sla: {
        ok:            Number(sla.sla_ok),
        breached:      Number(sla.sla_breached),
        activeOverdue: Number(sla.active_overdue),
        rate:          slaEval > 0 ? Math.round((Number(sla.sla_ok) / slaEval) * 100) : 100,
      },
      byStatus:   statusRes.rows.map(r => ({ status: r.status, count: Number(r.cnt) })),
      byCategory: categoryRes.rows.map(r => ({ category: r.category || 'Uncategorised', count: Number(r.cnt) })),
      byPriority: priorityRes.rows.map(r => ({ priority: r.priority || 'Unknown', count: Number(r.cnt) })),
      byStaff:    staffRes.rows.map(r => ({ name: r.assignee || 'Unassigned', count: Number(r.cnt) })),
      monthly:    monthlyRes.rows.map(r => ({ month: r.month, count: Number(r.cnt) })),
    });
  } catch (err) { next(err); }
});

// ── GET /tickets/activity — global activity feed ─────────────────────────────
router.get('/activity', requireAuth, async (req, res, next) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const search = ((req.query.search as string) || '').trim();
    const action = ((req.query.action as string) || '').trim();
    // Role-based scope (same as /tickets)
    const scope  = ((req.query.scope  as string) || '').trim();
    const userId = req.query.userId ? Number(req.query.userId) : null;
    const deptId = req.query.deptId ? Number(req.query.deptId) : null;

    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let i = 1;
    if (search) { where.push(`(t.title ILIKE $${i} OR u.name ILIKE $${i})`); params.push(`%${search}%`); i++; }
    if (action) { where.push(`a.action = $${i++}`); params.push(action); }
    if (scope === 'dept' && deptId) {
      where.push(
        `(t.assigned_to IN (SELECT id FROM yc_tkt_mgmt.users WHERE department_id = $${i++})` +
        ` OR t.created_by IN (SELECT id FROM yc_tkt_mgmt.users WHERE department_id = $${i++}))`
      );
      params.push(deptId, deptId);
    } else if (scope === 'mine' && userId) {
      where.push(`(t.created_by = $${i} OR t.assigned_to = $${i})`);
      params.push(userId); i++;
    }

    const { rows } = await pool.query(
      `SELECT
         a.id, a.ticket_id, a.user_id, a.action, a.details, a.created_at,
         t.title   AS ticket_title,
         t.status  AS ticket_status,
         p.label   AS priority_label,
         u.name    AS actor_name,
         COUNT(*) OVER() AS total
       FROM yc_tkt_mgmt.activity a
       JOIN yc_tkt_mgmt.tickets t ON t.id = a.ticket_id
       LEFT JOIN yc_tkt_mgmt.priorities p ON p.id = t.priority_id
       LEFT JOIN yc_tkt_mgmt.users u ON u.id = a.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );

    const total = rows.length ? Number(rows[0].total) : 0;
    const activity = rows.map(r => {
      const details = r.details
        ? (typeof r.details === 'string' ? JSON.parse(r.details) : r.details)
        : {};
      return {
        id: r.id,
        ticketId: r.ticket_id,
        ticketNumber: `TKT-${String(r.ticket_id).padStart(6, '0')}`,
        ticketTitle: r.ticket_title,
        ticketStatus: r.ticket_status,
        action: r.action,
        details,
        actorName: r.actor_name || 'System',
        priorityLabel: r.priority_label || '—',
        at: r.created_at,
      };
    });

    res.json({ total, activity });
  } catch (err) { next(err); }
});

// ── GET /tickets/:id ──────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res, next) => {
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
router.post('/', requireAuth, async (req, res, next) => {
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

    // SLA-based due date (fallback if expected_completion not provided)
    const { rows: priRows } = await pool.query(`SELECT sla_hours FROM yc_tkt_mgmt.priorities WHERE id = $1`, [resolvedPriority]);
    const slaHours = priRows[0]?.sla_hours || 24;
    const dueDate = resolvedDueDate || new Date(Date.now() + slaHours * 3600000).toISOString().split('T')[0];

    // Validate status exists
    const { rows: statRows } = await pool.query(`SELECT id FROM yc_tkt_mgmt.statuses WHERE id = $1`, [resolvedStatus]);
    const finalStatus = statRows[0]?.id || 'new';

    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.tickets
         (title, description, category_id, priority_id, status,
          created_by, assigned_to, due_date, expected_completion, ndis_related)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [resolvedTitle, description || req.body.issue_details || '', resolvedCategory, resolvedPriority,
       finalStatus, req.auth?.userId || req.body.created_by || null, resolvedAssignee || null, dueDate, resolvedDueDate,
       !!(req.body.ndis_related || req.body.ndisRelated)]
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
    const actorId = req.auth?.userId || req.body.created_by || null;
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, user_id, action) VALUES ($1,$2,'created')`,
      [ticketId, actorId]
    );
    if (resolvedAssignee) {
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, user_id, action, details) VALUES ($1,$2,'assigned',$3)`,
        [ticketId, actorId, JSON.stringify({ to: String(resolvedAssignee) })]
      );
    }

    if (req.auth) await logAudit({ userId: req.auth.userId, actorEmail: req.auth.email, action: 'ticket.create', module: 'tickets', targetType: 'ticket', targetId: ticketId, metadata: { title: resolvedTitle }, req });

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

    // Fire notifications (after response sent)
    const actorName = await getActorName(actorId);
    const deptId    = await getTicketDept(actorId, resolvedAssignee ? Number(resolvedAssignee) : null);
    notify({
      type: 'ticket.created', ticketId, ticketTitle: resolvedTitle,
      actorId: actorId!, actorName, creatorId: actorId ?? undefined,
      assigneeId: resolvedAssignee ? Number(resolvedAssignee) : undefined, deptId,
    }).catch(() => {});
  } catch (err) { next(err); }
});

// ── POST /tickets/:id/complete — assignee marks work done ───
// Moves status to pending_approval; all approvers notified
// Uses optionalAuth: falls back to actorId in request body when no session cookie
router.post('/:id/complete', optionalAuth, async (req, res, next) => {
  try {
    const id      = Number(req.params.id);
    const actorId = req.auth?.userId ?? (req.body.actorId ? Number(req.body.actorId) : null);
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
       SET status='pending_approval', pending_approval_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id]
    );

    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, user_id, action, details)
       VALUES ($1,$2,'status_changed',$3)`,
      [id, actorId, JSON.stringify({ to: 'pending_approval' })]
    );

    await logAudit({ userId: actorId ?? undefined, actorEmail: req.auth?.email, action: 'ticket.complete', module: 'tickets', targetType: 'ticket', targetId: id, metadata: {}, req });
    res.json({ ticket: dbTicket(rows[0]) });

    // Notify
    const actorName = await getActorName(actorId);
    const deptId    = await getTicketDept(tRows[0].created_by, tRows[0].assigned_to);
    notify({
      type: 'ticket.completed', ticketId: id, ticketTitle: tRows[0].title,
      actorId: actorId!, actorName, creatorId: tRows[0].created_by ?? undefined,
      assigneeId: tRows[0].assigned_to ?? undefined, deptId,
    }).catch(() => {});
  } catch (err) { next(err); }
});

// ── POST /tickets/:id/approve — approver approves ──────────
// If ALL approvers have approved → ticket becomes resolved
router.post('/:id/approve', optionalAuth, async (req, res, next) => {
  try {
    const id     = Number(req.params.id);
    const userId = req.auth?.userId ?? (req.body.actorId ? Number(req.body.actorId) : null);
    if (!userId) return res.status(400).json({ error: 'missing_actor', message: 'actorId is required' });

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

    const actorEmail = req.auth?.email ?? apRow[0].user_email ?? String(userId);
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, user_id, action, details)
       VALUES ($1,$2,'approved',$3)`,
      [id, userId, JSON.stringify({ approvedBy: actorEmail })]
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
         SET status='resolved', closed_date=NOW(), updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id]
      );
      ticket = rows[0];
      await pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, user_id, action, details)
         VALUES ($1,$2,'status_changed',$3)`,
        [id, userId, JSON.stringify({ to: 'resolved' })]
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
    await logAudit({ userId, actorEmail: req.auth?.email, action: 'ticket.approve', module: 'tickets', targetType: 'ticket', targetId: id, metadata: {}, req });
    res.json({ ticket: t });

    // Notify
    const actorName2 = await getActorName(userId);
    const { rows: tInfo2 } = await pool.query(`SELECT title, created_by, assigned_to FROM yc_tkt_mgmt.tickets WHERE id=$1`, [id]);
    const deptId2 = await getTicketDept(tInfo2[0]?.created_by, tInfo2[0]?.assigned_to);
    notify({
      type: 'ticket.approved', ticketId: id, ticketTitle: tInfo2[0]?.title ?? `Ticket #${id}`,
      actorId: userId, actorName: actorName2, creatorId: tInfo2[0]?.created_by ?? undefined,
      assigneeId: tInfo2[0]?.assigned_to ?? undefined, deptId: deptId2,
    }).catch(() => {});
  } catch (err) { next(err); }
});

// ── POST /tickets/:id/reject — approver rejects (reopens) ──
// Sets status back to in_progress, records justification
router.post('/:id/reject', optionalAuth, async (req, res, next) => {
  try {
    const id     = Number(req.params.id);
    const userId = req.auth?.userId ?? (req.body.actorId ? Number(req.body.actorId) : null);
    const { justification } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'missing_actor', message: 'actorId is required' });

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

    const actorEmail = req.auth?.email ?? String(userId);
    // Reopen ticket — back to in_progress
    const { rows } = await pool.query(
      `UPDATE yc_tkt_mgmt.tickets
       SET status='in_progress', pending_approval_at=NULL, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id]
    );

    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, user_id, action, details)
       VALUES ($1,$2,'rejected',$3)`,
      [id, userId, JSON.stringify({ from: 'pending_approval', to: 'in_progress', justification: justification.trim(), rejectedBy: actorEmail })]
    );

    const { rows: allAp } = await pool.query(
      `SELECT ta.*, u.name AS user_name, u.email AS user_email
       FROM yc_tkt_mgmt.ticket_approvers ta
       JOIN yc_tkt_mgmt.users u ON u.id = ta.approver_user_id
       WHERE ta.ticket_id=$1`, [id]
    );
    const t = dbTicket(rows[0]);
    t.approvers = allAp.map(dbApprover);
    await logAudit({ userId, actorEmail: req.auth?.email, action: 'ticket.reject', module: 'tickets', targetType: 'ticket', targetId: id, metadata: { justification }, req });
    res.json({ ticket: t });

    // Notify
    const actorName3 = await getActorName(userId);
    const { rows: tInfo3 } = await pool.query(`SELECT title, created_by, assigned_to FROM yc_tkt_mgmt.tickets WHERE id=$1`, [id]);
    const deptId3 = await getTicketDept(tInfo3[0]?.created_by, tInfo3[0]?.assigned_to);
    notify({
      type: 'ticket.rejected', ticketId: id, ticketTitle: tInfo3[0]?.title ?? `Ticket #${id}`,
      actorId: userId, actorName: actorName3, creatorId: tInfo3[0]?.created_by ?? undefined,
      assigneeId: tInfo3[0]?.assigned_to ?? undefined, deptId: deptId3,
    }).catch(() => {});
  } catch (err) { next(err); }
});

// ── PATCH /tickets/:id — update ─────────────────────────────
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const id      = Number(req.params.id);
    const actorId = req.auth?.userId ?? (req.body.actorId ? Number(req.body.actorId) : null);
    const { rows: existing } = await pool.query(`SELECT * FROM yc_tkt_mgmt.tickets WHERE id = $1`, [id]);
    if (!existing[0]) return res.status(404).json({ error: 'not_found' });
    const old = existing[0];

    const colMap: Record<string, string> = {
      title: 'title', description: 'description', category: 'category_id',
      priority: 'priority_id', status: 'status', assigneeId: 'assigned_to',
      resolvedAt: 'closed_date', closedAt: 'closed_date',
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
    if ('status' in req.body && req.body.status !== old.status) {
      activityInserts.push(pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, user_id, action, details) VALUES ($1,$2,'status_changed',$3)`,
        [id, actorId, JSON.stringify({ from: old.status, to: req.body.status })]
      ));
    }
    if ('assigneeId' in req.body && req.body.assigneeId !== old.assigned_to) {
      activityInserts.push(pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, user_id, action, details) VALUES ($1,$2,'assigned',$3)`,
        [id, actorId, JSON.stringify({ from: old.assigned_to ? String(old.assigned_to) : null, to: req.body.assigneeId ? String(req.body.assigneeId) : null })]
      ));
    }
    if ('priority' in req.body && req.body.priority !== old.priority_id) {
      activityInserts.push(pool.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, user_id, action, details) VALUES ($1,$2,'priority_changed',$3)`,
        [id, actorId, JSON.stringify({ from: old.priority_id, to: req.body.priority })]
      ));
    }
    await Promise.all(activityInserts);

    await logAudit({ userId: actorId ?? undefined, actorEmail: req.auth?.email, action: 'ticket.update', module: 'tickets', targetType: 'ticket', targetId: id, metadata: req.body, req });
    res.json({ ticket: dbTicket(rows[0]) });

    // Notify on status change only
    if ('status' in req.body && req.body.status !== old.status) {
      const actorNameU = await getActorName(actorId);
      const deptIdU    = await getTicketDept(old.created_by, old.assigned_to);
      notify({
        type: 'ticket.status_changed', ticketId: id, ticketTitle: (old.title as string),
        actorId: actorId!, actorName: actorNameU, extra: req.body.status,
        creatorId: old.created_by ?? undefined, assigneeId: old.assigned_to ?? undefined, deptId: deptIdU,
      }).catch(() => {});
    }
  } catch (err) { next(err); }
});

// ── DELETE /tickets/:id ─────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id      = Number(req.params.id);
    const actorId = req.auth?.userId ?? (req.body?.actorId ? Number(req.body.actorId) : null);
    const { rows } = await pool.query(`SELECT id, title FROM yc_tkt_mgmt.tickets WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    await pool.query(`DELETE FROM yc_tkt_mgmt.tickets WHERE id = $1`, [id]);
    await logAudit({ userId: actorId ?? undefined, actorEmail: req.auth?.email, action: 'ticket.delete', module: 'tickets', targetType: 'ticket', targetId: id, metadata: { title: rows[0].title }, req });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /tickets/:id/escalate — manager escalates to any user ─
// Reassigns ticket + logs full escalation trail
router.post('/:id/escalate', requireAuth, async (req, res, next) => {
  try {
    const id     = Number(req.params.id);
    const userId = req.auth?.userId ?? (req.body.actorId ? Number(req.body.actorId) : null);
    if (!userId) return res.status(400).json({ error: 'missing_actor', message: 'actorId is required' });
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
    const previousAssignee = tRows[0].assigned_to;

    // Log escalation history
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.ticket_escalations (ticket_id, escalated_by, escalated_to, reason, previous_assignee)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, userId, escalateToUserId, reason.trim(), previousAssignee || null]
    );

    // Reassign + mark escalated
    const { rows } = await pool.query(
      `UPDATE yc_tkt_mgmt.tickets
       SET assigned_to=$1, is_escalated=TRUE, escalated_to=$1,
           escalated_by=$2, escalated_at=NOW(), escalation_reason=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [escalateToUserId, userId, reason.trim(), id]
    );

    // Activity log
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, user_id, action, details)
       VALUES ($1,$2,'escalated',$3)`,
      [id, userId,
       JSON.stringify({ from: previousAssignee ? String(previousAssignee) : null, to: String(escalateToUserId), reason: reason.trim(), escalatedTo: targetRows[0].name, escalatedToEmail: targetRows[0].email })]
    );

    await logAudit({ userId, actorEmail: req.auth?.email, action: 'ticket.escalate', module: 'tickets', targetType: 'ticket', targetId: id, metadata: { escalateToUserId, reason: reason.trim() }, req });

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

    const t = dbTicket(rows[0]) as ReturnType<typeof dbTicket> & { escalations: unknown[] };
    t.approvers = apRows.map(dbApprover);
    t.escalations = escRows;
    res.json({ ticket: t });

    // Notify
    const actorNameE = await getActorName(userId);
    const deptIdE    = await getTicketDept(tRows[0].created_by, escalateToUserId);
    notify({
      type: 'ticket.escalated', ticketId: id, ticketTitle: tRows[0].title,
      actorId: userId, actorName: actorNameE, creatorId: tRows[0].created_by ?? undefined,
      assigneeId: escalateToUserId, deptId: deptIdE,
    }).catch(() => {});
  } catch (err) { next(err); }
});

// ── GET /tickets/:id/escalations — escalation trail ─────────
router.get('/:id/escalations', requireAuth, async (req, res, next) => {
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
router.get('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM yc_tkt_mgmt.comments WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [Number(req.params.id)]
    );
    res.json({ comments: rows.map(dbComment) });
  } catch (err) { next(err); }
});

// ── POST /tickets/:id/comments ──────────────────────────────
router.post('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const { body, isInternal } = req.body || {};
    if (!body?.trim()) return res.status(400).json({ error: 'missing_body' });
    const actorId = req.auth?.userId ?? (req.body.actorId ? Number(req.body.actorId) : null);

    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.comments (ticket_id, author_id, body, is_internal) VALUES ($1,$2,$3,$4) RETURNING *`,
      [ticketId, actorId, body.trim(), !!isInternal]
    );
    // Activity log
    await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity (ticket_id, user_id, action) VALUES ($1,$2,'commented')`,
      [ticketId, actorId]
    );
    res.status(201).json({ comment: dbComment(rows[0]) });
  } catch (err) { next(err); }
});

// ── GET /tickets/:id/activity ───────────────────────────────
router.get('/:id/activity', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM yc_tkt_mgmt.activity WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [Number(req.params.id)]
    );
    res.json({ activity: rows.map(dbActivity) });
  } catch (err) { next(err); }
});

export default router;
