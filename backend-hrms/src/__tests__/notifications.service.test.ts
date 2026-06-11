// ============================================================
// Tests for notifications.service.ts
// Covers:
//   ensurePushTable()   — 3 DDL queries, SQL content, idempotency, error retry
//   buildMessage()      — all 12 event types (via notify())
//   resolveRecipients() — admins, directors, dept managers, dedup, participants
//   notify()            — in-app inserts, email dispatch, graceful error handling
//   sendPush()          — skips when VAPID absent, sends push, cleans up 410 subs
// ============================================================

import { pool } from '../db/pool';

const mockPool = pool as any;

// ── Mock web-push ─────────────────────────────────────────────────────────────
// Supports both static import (webpush.sendNotification) used in notifications.service.ts
// and dynamic import (webpush.default.sendNotification) used in push.routes.ts.
const mockSendNotification = jest.fn();
const mockSetVapidDetails  = jest.fn();
jest.mock('web-push', () => {
  const m = {
    setVapidDetails:  mockSetVapidDetails,
    sendNotification: mockSendNotification,
  };
  return { ...m, default: m };
});

// ── Mock email service ─────────────────────────────────────────────────────────
const mockSendTicketEmail = jest.fn();
const mockSendUserEmail   = jest.fn();
jest.mock('../modules/notifications/email.service', () => ({
  sendTicketEventEmail:     mockSendTicketEmail,
  sendUserEventEmail:       mockSendUserEmail,
  buildTicketEventHtml:     jest.fn().mockReturnValue('<html>'),
  buildScheduledReportHtml: jest.fn().mockReturnValue('<html>'),
  buildSlaBreachHtml:       jest.fn().mockReturnValue('<html>'),
  sendEmail:                jest.fn().mockResolvedValue(undefined),
}));

import { ensurePushTable, notify } from '../modules/notifications/notifications.service';
import type { TicketEvent, UserEvent } from '../modules/notifications/notifications.service';

const OK = { rows: [], rowCount: 0 };

// ── Helper: set up the 2 standard resolveRecipients queries ──────────────────
// resolveRecipients always queries: bootstrap admins, directors, then dept managers
// only when deptId is provided. Use actorId that matches an adminId to keep the
// recipient set small (deduped to 1) and avoid needing extra INSERT mocks.
function mockResolveRecipients(opts: {
  adminIds?: number[];
  directorIds?: number[];
  managerIds?: number[];
  hasDept?: boolean;
}) {
  mockPool.query
    .mockResolvedValueOnce({ rows: (opts.adminIds    ?? []).map(id => ({ id })) })
    .mockResolvedValueOnce({ rows: (opts.directorIds ?? []).map(id => ({ id })) });
  if (opts.hasDept) {
    mockPool.query.mockResolvedValueOnce({ rows: (opts.managerIds ?? []).map(id => ({ id })) });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ensurePushTable()
// These tests run FIRST so migrationDone starts as false.
// ────────────────────────────────────────────────────────────────────────────

describe('ensurePushTable()', () => {
  it('runs 3 DDL queries with correct SQL on first call', async () => {
    for (let i = 0; i < 3; i++) mockPool.query.mockResolvedValueOnce(OK);
    await ensurePushTable();

    expect(mockPool.query).toHaveBeenCalledTimes(3);

    const sql0 = mockPool.query.mock.calls[0][0] as string;
    expect(sql0).toContain('CREATE TABLE IF NOT EXISTS');
    expect(sql0).toContain('push_subscriptions');

    const sql1 = mockPool.query.mock.calls[1][0] as string;
    expect(sql1).toContain('CREATE TABLE IF NOT EXISTS');
    expect(sql1).toContain('notifications');

    const sql2 = mockPool.query.mock.calls[2][0] as string;
    expect(sql2).toContain('ALTER TABLE');
    expect(sql2).toContain('ndis_related');
  });

  it('is idempotent — second call makes zero DB queries', async () => {
    // migrationDone=true from previous test; resetMocks clears call counts but not module state
    await ensurePushTable();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('does not set migrationDone when first query throws, allowing a later retry', async () => {
    // Use isolateModules to get a fresh module with migrationDone=false.
    // Must require pool from inside the isolated scope — each isolateModules call
    // creates a fresh pool instance that differs from the outer mockPool.
    await jest.isolateModulesAsync(async () => {
      const { pool: isoPool } = require('../db/pool');
      const isoMock = isoPool as any;

      // First attempt: first query throws
      isoMock.query.mockRejectedValueOnce(new Error('DB unavailable'));
      const { ensurePushTable: fresh } = require('../modules/notifications/notifications.service');
      await fresh(); // should not re-throw — error is caught internally

      // migrationDone was NOT set, so a retry should attempt the 3 queries again
      for (let i = 0; i < 3; i++) isoMock.query.mockResolvedValueOnce(OK);
      await fresh();

      // 1 (failed first attempt) + 3 (successful retry) = 4 total calls
      expect(isoMock.query).toHaveBeenCalledTimes(4);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildMessage() — all 12 event types, tested via notify()
//
// Key setup rule: use actorId that equals one of the adminIds so the set
// deduplicates to exactly 1 recipient → 1 INSERT mock + 1 email-fetch mock.
// This prevents Promise.all from consuming the email-fetch mock as an INSERT.
// ────────────────────────────────────────────────────────────────────────────

describe('buildMessage() via notify()', () => {
  // 1 admin recipient, actorId=99 (same as admin → deduped to 1 recipient)
  function setupOne() {
    mockResolveRecipients({ adminIds: [99] });
    mockPool.query
      .mockResolvedValueOnce(OK)                                        // INSERT notification
      .mockResolvedValueOnce({ rows: [{ email: 'admin@test.com' }] });  // email fetch
  }

  function insertSubject(): string {
    // query calls: [0]=admins, [1]=directors, [2]=INSERT
    return mockPool.query.mock.calls[2][1][2]; // INSERT params[2] = subject
  }

  function insertBody(): string {
    return mockPool.query.mock.calls[2][1][3]; // INSERT params[3] = body
  }

  it('ticket.created — subject contains ticket title', async () => {
    setupOne();
    await notify({ type: 'ticket.created', ticketId: 10, ticketTitle: 'Fix Login Bug', actorId: 99, actorName: 'Alice' });
    expect(insertSubject()).toContain('Fix Login Bug');
    expect(insertBody()).toContain('Alice');
  });

  it('ticket.status_changed — subject contains ticket id and body contains new status', async () => {
    setupOne();
    await notify({ type: 'ticket.status_changed', ticketId: 11, ticketTitle: 'Slow PC', actorId: 99, extra: 'In Progress' });
    expect(insertSubject()).toContain('11');
    expect(insertBody()).toContain('In Progress');
  });

  it('ticket.escalated — subject contains "escalated"', async () => {
    setupOne();
    await notify({ type: 'ticket.escalated', ticketId: 12, ticketTitle: 'Server Down', actorId: 99 });
    expect(insertSubject().toLowerCase()).toContain('escalat');
  });

  it('ticket.completed — subject contains "completed"', async () => {
    setupOne();
    await notify({ type: 'ticket.completed', ticketId: 13, ticketTitle: 'Deploy Fix', actorId: 99 });
    expect(insertSubject().toLowerCase()).toContain('complet');
  });

  it('ticket.approved — subject contains "approved"', async () => {
    setupOne();
    await notify({ type: 'ticket.approved', ticketId: 14, ticketTitle: 'Budget', actorId: 99 });
    expect(insertSubject().toLowerCase()).toContain('approv');
  });

  it('ticket.rejected — subject contains "rejected"', async () => {
    setupOne();
    await notify({ type: 'ticket.rejected', ticketId: 15, ticketTitle: 'Office Move', actorId: 99 });
    expect(insertSubject().toLowerCase()).toContain('reject');
  });

  it('ticket.extension_requested — subject contains ticket id and "extension"', async () => {
    setupOne();
    await notify({ type: 'ticket.extension_requested', ticketId: 16, ticketTitle: 'Migration', actorId: 99, extra: '2026-07-01' });
    const subj = insertSubject();
    expect(subj).toContain('16');
    expect(subj.toLowerCase()).toContain('extension');
    expect(insertBody()).toContain('2026-07-01');
  });

  it('ticket.extension_approved — subject contains "approved"', async () => {
    setupOne();
    await notify({ type: 'ticket.extension_approved', ticketId: 17, ticketTitle: 'DR Plan', actorId: 99 });
    expect(insertSubject().toLowerCase()).toContain('approv');
  });

  it('ticket.extension_denied — subject contains "denied"', async () => {
    setupOne();
    await notify({ type: 'ticket.extension_denied', ticketId: 18, ticketTitle: 'Cloud', actorId: 99 });
    expect(insertSubject().toLowerCase()).toContain('deni');
  });

  it('user.created — subject contains target user name', async () => {
    setupOne();
    const ev: UserEvent = { type: 'user.created', targetUserId: 99, targetUserName: 'Jane Smith', actorId: 99 };
    await notify(ev);
    expect(insertSubject()).toContain('Jane Smith');
  });

  it('user.position_changed — subject contains target user name and body contains new position', async () => {
    setupOne();
    const ev: UserEvent = { type: 'user.position_changed', targetUserId: 99, targetUserName: 'Bob Jones', actorId: 99, extra: 'Senior Developer' };
    await notify(ev);
    expect(insertSubject()).toContain('Bob Jones');
    expect(insertBody()).toContain('Senior Developer');
  });

  it('user.deleted — subject contains target user name', async () => {
    setupOne();
    const ev: UserEvent = { type: 'user.deleted', targetUserId: 99, targetUserName: 'Charlie', actorId: 99 };
    await notify(ev);
    expect(insertSubject()).toContain('Charlie');
  });

  it('uses "User #<id>" in body when actorName is undefined', async () => {
    setupOne();
    const ev: TicketEvent = { type: 'ticket.created', ticketId: 20, ticketTitle: 'Test', actorId: 99 };
    await notify(ev);
    expect(insertBody()).toContain('User #99');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveRecipients() — recipient set building
// ────────────────────────────────────────────────────────────────────────────

describe('resolveRecipients() via notify()', () => {
  function insertCount(): number {
    return mockPool.query.mock.calls.filter(([sql]: [string]) =>
      sql.includes('INSERT INTO') && sql.includes('notifications'),
    ).length;
  }

  it('notifies bootstrap admin as sole recipient', async () => {
    mockResolveRecipients({ adminIds: [99] });
    mockPool.query.mockResolvedValueOnce(OK).mockResolvedValueOnce({ rows: [] });
    await notify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 99 });
    expect(insertCount()).toBe(1);
  });

  it('notifies director as recipient', async () => {
    mockResolveRecipients({ adminIds: [], directorIds: [88] });
    mockPool.query.mockResolvedValueOnce(OK).mockResolvedValueOnce({ rows: [] });
    await notify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 88 });
    expect(insertCount()).toBe(1);
  });

  it('notifies dept manager when deptId is provided', async () => {
    mockResolveRecipients({ adminIds: [], directorIds: [], managerIds: [77], hasDept: true });
    mockPool.query.mockResolvedValueOnce(OK).mockResolvedValueOnce({ rows: [] });
    const ev: TicketEvent = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 77, deptId: 10 };
    await notify(ev);
    expect(insertCount()).toBe(1);
  });

  it('does NOT query dept managers when deptId is absent', async () => {
    mockResolveRecipients({ adminIds: [99] }); // hasDept not set → no 3rd query
    mockPool.query.mockResolvedValueOnce(OK).mockResolvedValueOnce({ rows: [] });
    await notify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 99 });
    // Only 2 recipient queries (admins + directors) — dept managers query would be [2]
    const deptMgrSql = mockPool.query.mock.calls[2]?.[0] as string | undefined;
    // The third call (index 2) is the INSERT, not a SELECT for dept managers
    expect(deptMgrSql).toContain('INSERT');
  });

  it('deduplicates recipients — actor who is also admin is counted once', async () => {
    // adminId=5 and actorId=5 → set = {5} → only 1 INSERT
    mockResolveRecipients({ adminIds: [5], directorIds: [] });
    mockPool.query.mockResolvedValueOnce(OK).mockResolvedValueOnce({ rows: [] });
    const ev: TicketEvent = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 5 };
    await notify(ev);
    expect(insertCount()).toBe(1);
  });

  it('includes creator, assignee, and approvers as direct participants', async () => {
    mockResolveRecipients({ adminIds: [], directorIds: [] });
    // recipients: actor=1, creator=2, assignee=3, approver=4 → 4 unique
    for (let i = 0; i < 4; i++) mockPool.query.mockResolvedValueOnce(OK);
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // email fetch
    const ev: TicketEvent = {
      type: 'ticket.created', ticketId: 1, ticketTitle: 'T',
      actorId: 1, creatorId: 2, assigneeId: 3, approverIds: [4],
    };
    await notify(ev);
    expect(insertCount()).toBe(4);
  });

  it('includes targetUserId for user events', async () => {
    mockResolveRecipients({ adminIds: [], directorIds: [] });
    // actor=1, target=50 → 2 unique recipients
    mockPool.query.mockResolvedValueOnce(OK).mockResolvedValueOnce(OK);
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // email fetch
    const ev: UserEvent = { type: 'user.created', targetUserId: 50, targetUserName: 'New User', actorId: 1 };
    await notify(ev);
    expect(insertCount()).toBe(2);
  });

  it('skips actorId=0 (falsy) and returns early when recipient set is empty', async () => {
    // admins=[], directors=[], no deptId, actorId=0 (falsy) → empty set
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // admins
      .mockResolvedValueOnce({ rows: [] }); // directors
    const ev = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 0 } as any;
    await notify(ev);
    expect(insertCount()).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// email dispatch
// ────────────────────────────────────────────────────────────────────────────

describe('email dispatch via notify()', () => {
  it('calls sendTicketEventEmail with recipient emails for ticket events', async () => {
    mockSendTicketEmail.mockResolvedValueOnce(undefined);
    // actorId=99 == adminId=99 → deduped to 1 recipient → 1 INSERT
    mockResolveRecipients({ adminIds: [99] });
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [{ email: 'admin@test.com' }] });
    const ev: TicketEvent = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 99 };
    await notify(ev);
    expect(mockSendTicketEmail).toHaveBeenCalledTimes(1);
    expect(mockSendUserEmail).not.toHaveBeenCalled();
    const [, emails] = mockSendTicketEmail.mock.calls[0];
    expect(emails).toContain('admin@test.com');
  });

  it('calls sendUserEventEmail for user events', async () => {
    mockSendUserEmail.mockResolvedValueOnce(undefined);
    // actor=99 (admin) + target=50 → 2 recipients → need 2 INSERT mocks
    mockResolveRecipients({ adminIds: [99] });
    mockPool.query
      .mockResolvedValueOnce(OK)                                        // INSERT for 99
      .mockResolvedValueOnce(OK)                                        // INSERT for 50
      .mockResolvedValueOnce({ rows: [{ email: 'admin@test.com' }] });  // email fetch
    const ev: UserEvent = { type: 'user.created', targetUserId: 50, targetUserName: 'New User', actorId: 99 };
    await notify(ev);
    expect(mockSendUserEmail).toHaveBeenCalledTimes(1);
    expect(mockSendTicketEmail).not.toHaveBeenCalled();
  });

  it('does not call email functions when email fetch returns no rows', async () => {
    mockResolveRecipients({ adminIds: [99] });
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [] }); // email fetch → no emails
    const ev: TicketEvent = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 99 };
    await notify(ev);
    expect(mockSendTicketEmail).not.toHaveBeenCalled();
  });

  it('does not re-throw when email dispatch fails — error is caught', async () => {
    mockSendTicketEmail.mockRejectedValueOnce(new Error('SMTP timeout'));
    mockResolveRecipients({ adminIds: [99] });
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [{ email: 'admin@test.com' }] });
    const ev: TicketEvent = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 99 };
    await expect(notify(ev)).resolves.toBeUndefined();
  });

  it('does not re-throw when in-app INSERT fails — error is caught per recipient', async () => {
    mockResolveRecipients({ adminIds: [99] });
    mockPool.query
      .mockRejectedValueOnce(new Error('DB write error'))               // INSERT throws
      .mockResolvedValueOnce({ rows: [{ email: 'admin@test.com' }] });  // email fetch still runs
    const ev: TicketEvent = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 99 };
    await expect(notify(ev)).resolves.toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// sendPush()
// VAPID constants in notifications.service.ts are evaluated at module-load time.
// Tests that need VAPID-enabled behaviour must use isolateModulesAsync so the
// service module is loaded AFTER the env vars are set.
// Inside isolateModulesAsync the pool is a FRESH instance — require it from
// inside the isolated scope (not the outer mockPool).
// ────────────────────────────────────────────────────────────────────────────

describe('sendPush() via notify()', () => {
  it('skips push_subscriptions query when VAPID keys are absent', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    mockResolveRecipients({ adminIds: [99] });
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [] });
    await notify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 99 });
    const subQ = mockPool.query.mock.calls.filter(([sql]: [string]) => sql.includes('push_subscriptions'));
    expect(subQ).toHaveLength(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('queries subscriptions and calls sendNotification when VAPID keys are configured', async () => {
    await jest.isolateModulesAsync(async () => {
      process.env.VAPID_PUBLIC_KEY  = 'BFAKE_PUBLIC';
      process.env.VAPID_PRIVATE_KEY = 'fake_private';

      const { pool: isoPool } = require('../db/pool');
      const iso = isoPool as any;

      // Pre-warm ensurePushTable for this isolated service instance
      for (let i = 0; i < 3; i++) iso.query.mockResolvedValueOnce(OK);
      const { ensurePushTable: warmEPT, notify: freshNotify } =
        require('../modules/notifications/notifications.service');
      await warmEPT();

      mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });
      iso.query
        .mockResolvedValueOnce({ rows: [{ id: 99 }] })          // admins
        .mockResolvedValueOnce({ rows: [] })                     // directors
        .mockResolvedValueOnce(OK)                               // INSERT notification
        .mockResolvedValueOnce({ rows: [                         // subscriptions
          { endpoint: 'https://fcm.googleapis.com/push/1', p256dh: 'p256', auth: 'auth' },
        ] })
        .mockResolvedValueOnce({ rows: [{ email: 'admin@test.com' }] }); // email fetch

      await freshNotify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 99 });

      expect(mockSendNotification).toHaveBeenCalledTimes(1);
      const [subArg, payloadStr] = mockSendNotification.mock.calls[0];
      expect(subArg.endpoint).toBe('https://fcm.googleapis.com/push/1');
      const payload = JSON.parse(payloadStr as string);
      expect(payload.icon).toBe('/favicon.svg');
      expect(payload.badge).toBe('/favicon.svg');
      expect(typeof payload.title).toBe('string');

      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    });
  });

  it('deletes the subscription row when sendNotification returns statusCode 410 (Gone)', async () => {
    await jest.isolateModulesAsync(async () => {
      process.env.VAPID_PUBLIC_KEY  = 'BFAKE_PUBLIC';
      process.env.VAPID_PRIVATE_KEY = 'fake_private';

      const { pool: isoPool } = require('../db/pool');
      const iso = isoPool as any;

      for (let i = 0; i < 3; i++) iso.query.mockResolvedValueOnce(OK);
      const { ensurePushTable: warmEPT, notify: freshNotify } =
        require('../modules/notifications/notifications.service');
      await warmEPT();

      mockSendNotification.mockRejectedValueOnce({ statusCode: 410 });
      iso.query
        .mockResolvedValueOnce({ rows: [{ id: 99 }] })          // admins
        .mockResolvedValueOnce({ rows: [] })                     // directors
        .mockResolvedValueOnce(OK)                               // INSERT notification
        .mockResolvedValueOnce({ rows: [                         // subscriptions
          { endpoint: 'https://fcm.googleapis.com/push/expired', p256dh: 'k', auth: 'a' },
        ] })
        .mockResolvedValueOnce(OK)                               // DELETE expired sub
        .mockResolvedValueOnce({ rows: [{ email: 'admin@test.com' }] }); // email fetch

      await freshNotify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 99 });

      const deleteCalls = iso.query.mock.calls.filter(([sql]: [string]) =>
        sql.includes('DELETE') && sql.includes('push_subscriptions'),
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0][1]).toContain('https://fcm.googleapis.com/push/expired');

      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    });
  });

  it('does not delete subscription for non-410 sendNotification failures', async () => {
    await jest.isolateModulesAsync(async () => {
      process.env.VAPID_PUBLIC_KEY  = 'BFAKE_PUBLIC';
      process.env.VAPID_PRIVATE_KEY = 'fake_private';

      const { pool: isoPool } = require('../db/pool');
      const iso = isoPool as any;

      for (let i = 0; i < 3; i++) iso.query.mockResolvedValueOnce(OK);
      const { ensurePushTable: warmEPT, notify: freshNotify } =
        require('../modules/notifications/notifications.service');
      await warmEPT();

      // 429 Too Many Requests — should NOT delete subscription
      mockSendNotification.mockRejectedValueOnce({ statusCode: 429 });
      iso.query
        .mockResolvedValueOnce({ rows: [{ id: 99 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(OK)
        .mockResolvedValueOnce({ rows: [
          { endpoint: 'https://fcm.googleapis.com/push/active', p256dh: 'k', auth: 'a' },
        ] })
        .mockResolvedValueOnce({ rows: [{ email: 'admin@test.com' }] });

      await freshNotify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 99 });

      const deleteCalls = iso.query.mock.calls.filter(([sql]: [string]) =>
        sql.includes('DELETE') && sql.includes('push_subscriptions'),
      );
      expect(deleteCalls).toHaveLength(0);

      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    });
  });
});
