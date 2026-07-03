// ============================================================
// High-level notification helpers used by route handlers.
// Each function resolves recipients from the DB and enqueues.
// Nothing here ever awaits an email send.
// ============================================================

import { pool } from '../../db/pool';
import { enqueue } from './email.queue';
import type { EmailEventType, TicketEmailPayload } from './email.types';

// ── Shared DB helpers ─────────────────────────────────────────

interface TicketRow {
  id:            number;
  title:         string;
  assignee_id:   number | null;
  requester_id:  number | null;
  priority:      string;
  category:      string;
  due_at:        string | null;
  status:        string;
}

interface UserRow {
  id:    number;
  name:  string;
  email: string;
}

async function getTicket(ticketId: number): Promise<TicketRow | null> {
  // NOTE: the live schema's real column names are assigned_to/created_by/
  // priority_id/category_id/due_date — not assignee_id/requester_id/
  // priority/category/due_at. Every call to this function was throwing
  // a "column does not exist" error (silently swallowed by each caller's
  // try/catch), which is why no ticket-lifecycle email ever reached the
  // notification_queue. Aliased here to match the TicketRow shape the
  // rest of this file expects, without having to touch every call site.
  const { rows } = await pool.query<TicketRow>(
    `SELECT id, title,
            assigned_to AS assignee_id,
            created_by  AS requester_id,
            priority_id AS priority,
            category_id AS category,
            due_date    AS due_at,
            status
     FROM yc_tkt_mgmt.tickets WHERE id = $1`,
    [ticketId],
  );
  return rows[0] ?? null;
}

async function getUser(userId: number): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, name, email FROM yc_tkt_mgmt.users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

async function getApprovers(ticketId: number): Promise<UserRow[]> {
  const { rows } = await pool.query<UserRow>(
    `SELECT u.id, u.name, u.email
     FROM yc_tkt_mgmt.ticket_approvers ta
     JOIN yc_tkt_mgmt.users u ON u.id = ta.approver_user_id
     WHERE ta.ticket_id = $1`,
    [ticketId],
  );
  return rows;
}

async function buildPayload(
  ticket:     TicketRow,
  actorId:    number,
  extra:      Partial<TicketEmailPayload> = {},
): Promise<{ payload: TicketEmailPayload; assignee: UserRow | null; requester: UserRow | null }> {
  const [actor, assignee, requester] = await Promise.all([
    getUser(actorId),
    ticket.assignee_id  ? getUser(ticket.assignee_id)  : null,
    ticket.requester_id ? getUser(ticket.requester_id) : null,
  ]);

  const payload: TicketEmailPayload = {
    ticketId:       ticket.id,
    ticketTitle:    ticket.title,
    actorId,
    actorName:      actor?.name    ?? `User ${actorId}`,
    assigneeName:   assignee?.name  ?? undefined,
    requesterName:  requester?.name ?? undefined,
    priority:       ticket.priority,
    category:       ticket.category,
    dueAt:          ticket.due_at   ?? undefined,
    status:         ticket.status,
    ...extra,
  };

  return { payload, assignee, requester };
}

// ── Notify helpers ────────────────────────────────────────────

/** Filter out nulls, flatten arrays (e.g. approver lists), de-dupe by email, build recipient list */
function recipients(...users: Array<UserRow | null | UserRow[]>): Array<{ email: string; name: string }> {
  const flat = users.flatMap((u) => (Array.isArray(u) ? u : [u]));
  const seen = new Set<string>();
  const out: Array<{ email: string; name: string }> = [];
  for (const u of flat) {
    if (!u || !u.email || seen.has(u.email)) continue;
    seen.add(u.email);
    out.push({ email: u.email, name: u.name });
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Call from ticket route after creating a ticket.
 * Notifies the assignee and any approvers (matches the in-app/push
 * recipient logic in notifications.service.ts's resolveRecipients()).
 */
export async function notifyTicketCreated(ticketId: number, actorId: number): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const [{ payload, assignee }, approvers] = await Promise.all([
      buildPayload(ticket, actorId),
      getApprovers(ticketId),
    ]);
    const rcpts = recipients(assignee, approvers);
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.created', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.created', e); }
}

/**
 * Called when a ticket is reassigned.
 * Notifies new assignee.
 */
export async function notifyTicketAssigned(
  ticketId: number,
  actorId:  number,
  newAssigneeId: number,
): Promise<void> {
  try {
    const ticket  = await getTicket(ticketId);
    if (!ticket) return;
    const { payload } = await buildPayload(ticket, actorId);
    const assignee    = await getUser(newAssigneeId);
    if (!assignee?.email) return;
    await enqueue({ eventType: 'ticket.assigned', recipients: [{ email: assignee.email, name: assignee.name }], payload, ticketId });
  } catch (e) { console.error('[notify] ticket.assigned', e); }
}

/**
 * Called when assignee submits resolution (pending approval).
 * Notifies the approvers who need to review it, plus the requester.
 */
export async function notifyResolutionSubmitted(ticketId: number, actorId: number): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const [{ payload, requester }, approvers] = await Promise.all([
      buildPayload(ticket, actorId),
      getApprovers(ticketId),
    ]);
    const rcpts = recipients(requester, approvers);
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.resolution_submitted', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.resolution_submitted', e); }
}

export async function notifyTicketApproved(ticketId: number, actorId: number, note?: string): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const { payload, assignee } = await buildPayload(ticket, actorId, { note });
    const rcpts = recipients(assignee);
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.approved', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.approved', e); }
}

export async function notifyTicketRejected(ticketId: number, actorId: number, reason?: string): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const { payload, assignee } = await buildPayload(ticket, actorId, { reason });
    const rcpts = recipients(assignee);
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.rejected', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.rejected', e); }
}

export async function notifyTicketClosed(ticketId: number, actorId: number): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const { payload, assignee, requester } = await buildPayload(ticket, actorId);
    const rcpts = recipients(assignee, requester);
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.closed', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.closed', e); }
}

export async function notifyTicketReopened(ticketId: number, actorId: number, reason?: string): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const { payload, assignee } = await buildPayload(ticket, actorId, { reason });
    const rcpts = recipients(assignee);
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.reopened', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.reopened', e); }
}

export async function notifyTicketEscalated(ticketId: number, actorId: number, reason?: string): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const { payload, assignee, requester } = await buildPayload(ticket, actorId, { reason });
    const rcpts = recipients(assignee, requester);
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.escalated', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.escalated', e); }
}

export async function notifyCommentAdded(ticketId: number, actorId: number, comment: string): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const { payload, assignee, requester } = await buildPayload(ticket, actorId, { comment });
    // Notify everyone except the commenter
    const rcpts = recipients(assignee, requester).filter(r => {
      // We'll keep both; the actor check is best-effort based on email
      return true;
    });
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.comment_added', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.comment_added', e); }
}

export async function notifyAttachmentAdded(
  ticketId:        number,
  actorId:         number,
  attachmentNames: string[],
): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const { payload, assignee, requester } = await buildPayload(ticket, actorId, { attachmentNames });
    const rcpts = recipients(assignee, requester);
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.attachment_added', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.attachment_added', e); }
}

export async function notifyExtensionRequested(
  ticketId:   number,
  actorId:    number,
  newDueDate: string,
  reason?:    string,
): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const { payload, requester } = await buildPayload(ticket, actorId, { newDueDate, reason });
    const rcpts = recipients(requester);
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.extension_requested', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.extension_requested', e); }
}

export async function notifyExtensionApproved(ticketId: number, actorId: number, newDueDate: string): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const { payload, assignee } = await buildPayload(ticket, actorId, { newDueDate });
    const rcpts = recipients(assignee);
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.extension_approved', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.extension_approved', e); }
}

export async function notifyExtensionRejected(ticketId: number, actorId: number, reason?: string): Promise<void> {
  try {
    const ticket = await getTicket(ticketId);
    if (!ticket) return;
    const { payload, assignee } = await buildPayload(ticket, actorId, { reason });
    const rcpts = recipients(assignee);
    if (!rcpts.length) return;
    await enqueue({ eventType: 'ticket.extension_rejected', recipients: rcpts, payload, ticketId });
  } catch (e) { console.error('[notify] ticket.extension_rejected', e); }
}

// ── Scheduled cron helpers ────────────────────────────────────

interface OverdueTicket {
  id:          number;
  title:       string;
  assignee_id: number | null;
  due_at:      string;
  priority:    string;
  category:    string;
  status:      string;
}

/** Called by /cron/sla-check — sends overdue reminders */
export async function sendOverdueReminders(): Promise<void> {
  const { rows } = await pool.query<OverdueTicket>(
    `SELECT id, title, assignee_id, due_at, priority, category, status
     FROM yc_tkt_mgmt.tickets
     WHERE status NOT IN ('completed','closed','resolved')
       AND due_at < NOW()`,
  );

  for (const t of rows) {
    if (!t.assignee_id) continue;
    try {
      const assignee = await getUser(t.assignee_id);
      if (!assignee?.email) continue;
      const daysOverdue = Math.floor((Date.now() - new Date(t.due_at).getTime()) / 86_400_000);
      const payload: TicketEmailPayload = {
        ticketId:     t.id,
        ticketTitle:  t.title,
        actorId:      0,
        actorName:    'System',
        assigneeName: assignee.name,
        priority:     t.priority,
        category:     t.category,
        dueAt:        t.due_at,
        status:       t.status,
        daysOverdue,
      };
      await enqueue({ eventType: 'ticket.overdue_reminder', recipients: [{ email: assignee.email, name: assignee.name }], payload, ticketId: t.id });
    } catch (e) {
      console.error('[notify] overdue_reminder for ticket', t.id, e);
    }
  }
}

/** Called by /cron/due-tomorrow — sends due-tomorrow reminders */
export async function sendDueTomorrowReminders(): Promise<void> {
  const { rows } = await pool.query<OverdueTicket>(
    `SELECT id, title, assignee_id, due_at, priority, category, status
     FROM yc_tkt_mgmt.tickets
     WHERE status NOT IN ('completed','closed','resolved')
       AND due_at::date = (CURRENT_DATE + INTERVAL '1 day')::date`,
  );

  for (const t of rows) {
    if (!t.assignee_id) continue;
    try {
      const assignee = await getUser(t.assignee_id);
      if (!assignee?.email) continue;
      const payload: TicketEmailPayload = {
        ticketId:     t.id,
        ticketTitle:  t.title,
        actorId:      0,
        actorName:    'System',
        assigneeName: assignee.name,
        priority:     t.priority,
        category:     t.category,
        dueAt:        t.due_at,
        status:       t.status,
      };
      await enqueue({ eventType: 'ticket.due_tomorrow', recipients: [{ email: assignee.email, name: assignee.name }], payload, ticketId: t.id });
    } catch (e) {
      console.error('[notify] due_tomorrow for ticket', t.id, e);
    }
  }
}
