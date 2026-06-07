// ============================================================
// Notifications Service — in-app + web push
// Role-based routing:
//   • Bootstrap admin + Director → ALL events
//   • Dept manager → all events in their department
//   • Regular staff → only events directly involving them
// ============================================================

import webpush from 'web-push';
import { pool } from '../../db/pool';

// ── VAPID setup (keys set in Vercel env vars) ─────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:admin@yahwehcare.com.au';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ── DB migration: ensure push_subscriptions table exists ──
let migrationDone = false;
export async function ensurePushTable() {
  if (migrationDone) return;
  try {
    // push_subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.push_subscriptions (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        endpoint   TEXT    NOT NULL,
        p256dh     TEXT    NOT NULL,
        auth       TEXT    NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, endpoint)
      )
    `);
    // in-app notifications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.notifications (
        id             SERIAL PRIMARY KEY,
        recipient_id   INTEGER,
        recipient_email TEXT,
        ticket_id      INTEGER,
        channel        TEXT    NOT NULL DEFAULT 'push',
        subject        TEXT    NOT NULL,
        body           TEXT    NOT NULL,
        status         TEXT    NOT NULL DEFAULT 'pending',
        read_at        TIMESTAMPTZ,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Add ndis_related column if missing (safe ALTER TABLE)
    await pool.query(`
      ALTER TABLE yc_tkt_mgmt.tickets
        ADD COLUMN IF NOT EXISTS ndis_related BOOLEAN NOT NULL DEFAULT FALSE
    `);
    migrationDone = true;
  } catch (err) {
    console.error('[push] migration error', err);
  }
}

// ── Event types ───────────────────────────────────────────
export interface TicketEvent {
  type:
    | 'ticket.created'
    | 'ticket.status_changed'
    | 'ticket.escalated'
    | 'ticket.completed'
    | 'ticket.approved'
    | 'ticket.rejected';
  ticketId:   number;
  ticketTitle: string;
  actorId:    number;
  actorName?: string;
  creatorId?: number;
  assigneeId?: number;
  deptId?:    number;
  extra?:     string; // e.g. new status value
}

export interface UserEvent {
  type:
    | 'user.created'
    | 'user.position_changed'
    | 'user.deleted';
  targetUserId:   number;
  targetUserName: string;
  actorId:        number;
  actorName?:     string;
  deptId?:        number;
  extra?:         string; // e.g. new position title
}

export type NotifyEvent = TicketEvent | UserEvent;

// ── Resolve recipient user IDs based on event + role ──────
async function resolveRecipients(ev: NotifyEvent): Promise<number[]> {
  const set = new Set<number>();

  // Always: bootstrap admins
  const { rows: admins } = await pool.query(
    `SELECT id FROM yc_tkt_mgmt.users WHERE is_bootstrap_admin = TRUE AND is_active = TRUE`
  );
  admins.forEach(r => set.add(r.id));

  // Always: Directors (position_type = 'director')
  const { rows: directors } = await pool.query(
    `SELECT DISTINCT u.id
       FROM yc_tkt_mgmt.users u
       JOIN yc_tkt_mgmt.staff_positions sp ON sp.user_id = u.id AND sp.is_primary = TRUE
       JOIN yc_tkt_mgmt.positions p ON p.id = sp.position_id
      WHERE LOWER(COALESCE(p.position_type,'')) = 'director' AND u.is_active = TRUE`
  );
  directors.forEach(r => set.add(r.id));

  // Dept managers: get all events in their department
  const deptId = 'deptId' in ev ? ev.deptId : undefined;
  if (deptId) {
    const { rows: mgrs } = await pool.query(
      `SELECT DISTINCT u.id
         FROM yc_tkt_mgmt.users u
         JOIN yc_tkt_mgmt.staff_positions sp ON sp.user_id = u.id AND sp.is_primary = TRUE
         JOIN yc_tkt_mgmt.positions p ON p.id = sp.position_id
        WHERE LOWER(COALESCE(p.position_type,'')) = 'manager'
          AND u.department_id = $1
          AND u.is_active = TRUE`,
      [deptId]
    );
    mgrs.forEach(r => set.add(r.id));
  }

  // Direct participants
  if ('creatorId' in ev && ev.creatorId)   set.add(ev.creatorId);
  if ('assigneeId' in ev && ev.assigneeId) set.add(ev.assigneeId);
  if ('targetUserId' in ev && ev.targetUserId) set.add(ev.targetUserId);
  // actor who triggered the event also gets the notification (as issuer)
  if (ev.actorId) set.add(ev.actorId);

  return Array.from(set);
}

// ── Build human-readable subject + body ───────────────────
function buildMessage(ev: NotifyEvent): { subject: string; body: string } {
  const actor = ev.actorName || `User #${ev.actorId}`;
  switch (ev.type) {
    case 'ticket.created':
      return {
        subject: `New ticket: ${(ev as TicketEvent).ticketTitle}`,
        body:    `${actor} created ticket #${(ev as TicketEvent).ticketId} — "${(ev as TicketEvent).ticketTitle}"`,
      };
    case 'ticket.status_changed':
      return {
        subject: `Ticket #${(ev as TicketEvent).ticketId} status updated`,
        body:    `${actor} changed status to "${(ev as TicketEvent).extra || 'unknown'}" on "${(ev as TicketEvent).ticketTitle}"`,
      };
    case 'ticket.escalated':
      return {
        subject: `Ticket #${(ev as TicketEvent).ticketId} escalated`,
        body:    `${actor} escalated "${(ev as TicketEvent).ticketTitle}"`,
      };
    case 'ticket.completed':
      return {
        subject: `Ticket #${(ev as TicketEvent).ticketId} completed`,
        body:    `${actor} marked "${(ev as TicketEvent).ticketTitle}" as complete`,
      };
    case 'ticket.approved':
      return {
        subject: `Ticket #${(ev as TicketEvent).ticketId} approved`,
        body:    `${actor} approved "${(ev as TicketEvent).ticketTitle}"`,
      };
    case 'ticket.rejected':
      return {
        subject: `Ticket #${(ev as TicketEvent).ticketId} rejected`,
        body:    `${actor} rejected "${(ev as TicketEvent).ticketTitle}"`,
      };
    case 'user.created':
      return {
        subject: `New member added: ${(ev as UserEvent).targetUserName}`,
        body:    `${actor} added ${(ev as UserEvent).targetUserName} to the team`,
      };
    case 'user.position_changed':
      return {
        subject: `Position changed: ${(ev as UserEvent).targetUserName}`,
        body:    `${actor} changed ${(ev as UserEvent).targetUserName}'s position to "${(ev as UserEvent).extra || 'new role'}"`,
      };
    case 'user.deleted':
      return {
        subject: `Member removed: ${(ev as UserEvent).targetUserName}`,
        body:    `${actor} removed ${(ev as UserEvent).targetUserName} from the team`,
      };
    default:
      return { subject: 'Yahwehcare notification', body: 'You have a new notification.' };
  }
}

// ── Send web push to one subscription ─────────────────────
async function sendPush(userId: number, payload: object): Promise<void> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return; // push not configured

  const { rows: subs } = await pool.query(
    `SELECT endpoint, p256dh, auth FROM yc_tkt_mgmt.push_subscriptions WHERE user_id = $1`,
    [userId]
  );
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 } // 1 hour TTL
      );
    } catch (err: unknown) {
      const e = err as { statusCode?: number };
      // 410 Gone = subscription expired; clean it up
      if (e.statusCode === 410) {
        await pool.query(
          `DELETE FROM yc_tkt_mgmt.push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
          [userId, sub.endpoint]
        );
      } else {
        console.warn(`[push] sendNotification failed for user ${userId}:`, e.statusCode || err);
      }
    }
  }
}

// ── Main entry point ──────────────────────────────────────
export async function notify(ev: NotifyEvent): Promise<void> {
  try {
    await ensurePushTable();
    const { subject, body } = buildMessage(ev);
    const recipients = await resolveRecipients(ev);
    if (!recipients.length) return;

    // Build push payload (shown in browser notification)
    const ticketId = 'ticketId' in ev ? (ev as TicketEvent).ticketId : undefined;
    const pushPayload = {
      title: subject,
      body,
      icon:  '/favicon.ico',
      badge: '/favicon.ico',
      data:  { ticketId, type: ev.type, url: '/' },
    };

    await Promise.all(
      recipients.map(async (recipientId) => {
        // Insert in-app notification
        try {
          await pool.query(
            `INSERT INTO yc_tkt_mgmt.notifications
               (recipient_id, ticket_id, channel, subject, body, status)
             VALUES ($1, $2, 'push', $3, $4, 'pending')`,
            [recipientId, ticketId ?? null, subject, body]
          );
        } catch (dbErr) {
          console.warn('[notify] db insert error', dbErr);
        }
        // Send web push (fire-and-forget errors handled inside)
        await sendPush(recipientId, pushPayload);
      })
    );
  } catch (err) {
    console.error('[notify] unhandled error', err);
  }
}
