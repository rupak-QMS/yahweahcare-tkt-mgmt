// ============================================================
// Tests for notifications.service.ts
// Covers:
//   ensurePushTable()   — 3 DDL queries, SQL content, idempotency, error retry
//   buildMessage()      — all event types (via notify())
//   resolveRecipients() — event-specific logic, dedup, DB queries only when needed
//   notify()            — in-app inserts, email dispatch, graceful error handling
//   sendPush()          — skips when VAPID absent, sends push, cleans up 410 subs
//
// KEY BEHAVIOUR (current code):
//   • Ticket events resolve recipients from event fields (assigneeId, approverIds,
//     creatorId, escalatedToId) — NO admin/director DB queries.
//   • ticket.escalated/extension_requested query getDeptManagerIds only when deptId present.
//   • ticket.critical always queries getDirectorIds (and optionally getDeptManagerIds).
//   • User events query bootstrap admins + directors + add targetUserId.
// ============================================================

import { pool } from '../db/pool';

const mockPool = pool as any;

// ── Mock web-push ─────────────────────────────────────────────────────────────
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
    await jest.isolateModulesAsync(async () => {
      const { pool: isoPool } = require('../db/pool');
      const isoMock = isoPool as any;

      isoMock.query.mockRejectedValueOnce(new Error('DB unavailable'));
      const { ensurePushTable: fresh } = require('../modules/notifications/notifications.service');
      await fresh(); // should not re-throw — error is caught internally

      for (let i = 0; i < 3; i++) isoMock.query.mockResolvedValueOnce(OK);
      await fresh();

      // 1 (failed) + 3 (successful retry) = 4 total calls
      expect(isoMock.query).toHaveBeenCalledTimes(4);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildMessage() — all event types, tested via notify()
//
// Ticket events: recipients come from event fields (NO admin/director DB queries).
//   → INSERT call is at mock.calls[0], email fetch at mock.calls[1].
// User events:   recipients queried from DB (admins=[0], directors=[1]).
//   → INSERT call is at mock.calls[2], email fetch at mock.calls[3].
// ────────────────────────────────────────────────────────────────────────────

describe('buildMessage() via notify()', () => {
  // Set up mocks for a ticket event with 1 recipient (no DB queries in resolveRecipients)
  function setupTicket() {
    mockPool.query
      .mockResolvedValueOnce(OK)                                        // INSERT notification [0]
      .mockResolvedValueOnce({ rows: [{ email: 'user@test.com' }] });   // email fetch [1]
  }

  // Set up mocks for a user event (admins + directors + INSERT + email fetch)
  function setupUser() {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 99 }] })                    // admins [0]
      .mockResolvedValueOnce({ rows: [] })                               // directors [1]
      .mockResolvedValueOnce(OK)                                         // INSERT notification [2]
      .mockResolvedValueOnce({ rows: [{ email: 'admin@test.com' }] });   // email fetch [3]
  }

  // Ticket INSERT is calls[0]; user event INSERT is calls[2]
  function ticketSubject():  string { return mockPool.query.mock.calls[0][1][2]; }
  function ticketBody():     string { return mockPool.query.mock.calls[0][1][3]; }
  function userSubject():    string { return mockPool.query.mock.calls[2][1][2]; }
  function userBody():       string { return mockPool.query.mock.calls[2][1][3]; }

  it('ticket.created — subject and body contain ticket title', async () => {
    setupTicket();
    await notify({ type: 'ticket.created', ticketId: 10, ticketTitle: 'Fix Login Bug', actorId: 1, actorName: 'Alice', assigneeId: 99 });
    expect(ticketSubject()).toContain('Fix Login Bug');
    expect(ticketBody()).toContain('Fix Login Bug');
  });

  it('ticket.status_changed — subject contains ticket id and body contains new status', async () => {
    setupTicket();
    await notify({ type: 'ticket.status_changed', ticketId: 11, ticketTitle: 'Slow PC', actorId: 1, actorName: 'Bob', assigneeId: 99, extra: 'In Progress' });
    expect(ticketSubject()).toContain('11');
    expect(ticketBody()).toContain('In Progress');
  });

  it('ticket.escalated — subject contains "escalated"', async () => {
    setupTicket();
    await notify({ type: 'ticket.escalated', ticketId: 12, ticketTitle: 'Server Down', actorId: 1, assigneeId: 99 });
    expect(ticketSubject().toLowerCase()).toContain('escalat');
  });

  it('ticket.completed — subject contains "Ready for Approval"', async () => {
    setupTicket();
    await notify({ type: 'ticket.completed', ticketId: 13, ticketTitle: 'Deploy Fix', actorId: 1, approverIds: [99] });
    expect(ticketSubject()).toContain('Ready for Approval');
  });

  it('ticket.approved — subject contains "approved"', async () => {
    setupTicket();
    await notify({ type: 'ticket.approved', ticketId: 14, ticketTitle: 'Budget', actorId: 1, assigneeId: 99 });
    expect(ticketSubject().toLowerCase()).toContain('approv');
  });

  it('ticket.rejected — subject contains "rejected"', async () => {
    setupTicket();
    await notify({ type: 'ticket.rejected', ticketId: 15, ticketTitle: 'Office Move', actorId: 1, assigneeId: 99 });
    expect(ticketSubject().toLowerCase()).toContain('reject');
  });

  it('ticket.extension_requested — subject contains ticket id and "extension"', async () => {
    setupTicket();
    await notify({ type: 'ticket.extension_requested', ticketId: 16, ticketTitle: 'Migration', actorId: 1, approverIds: [99], extra: '2026-07-01' });
    const subj = ticketSubject();
    expect(subj).toContain('16');
    expect(subj.toLowerCase()).toContain('extension');
    expect(ticketBody()).toContain('2026-07-01');
  });

  it('ticket.extension_approved — subject contains "approved"', async () => {
    setupTicket();
    await notify({ type: 'ticket.extension_approved', ticketId: 17, ticketTitle: 'DR Plan', actorId: 1, assigneeId: 99 });
    expect(ticketSubject().toLowerCase()).toContain('approv');
  });

  it('ticket.extension_denied — subject contains "denied"', async () => {
    setupTicket();
    await notify({ type: 'ticket.extension_denied', ticketId: 18, ticketTitle: 'Cloud', actorId: 1, assigneeId: 99 });
    expect(ticketSubject().toLowerCase()).toContain('deni');
  });

  it('ticket.closed — subject contains ticket id', async () => {
    setupTicket();
    await notify({ type: 'ticket.closed', ticketId: 19, ticketTitle: 'Closed Ticket', actorId: 1, assigneeId: 99 });
    expect(ticketSubject()).toContain('19');
    expect(ticketSubject().toLowerCase()).toContain('close');
  });

  it('user.created — subject contains target user name', async () => {
    setupUser();
    const ev: UserEvent = { type: 'user.created', targetUserId: 99, targetUserName: 'Jane Smith', actorId: 99 };
    await notify(ev);
    expect(userSubject()).toContain('Jane Smith');
  });

  it('user.position_changed — subject contains target user name and body contains new position', async () => {
    setupUser();
    const ev: UserEvent = { type: 'user.position_changed', targetUserId: 99, targetUserName: 'Bob Jones', actorId: 99, extra: 'Senior Developer' };
    await notify(ev);
    expect(userSubject()).toContain('Bob Jones');
    expect(userBody()).toContain('Senior Developer');
  });

  it('user.deleted — subject contains target user name', async () => {
    setupUser();
    const ev: UserEvent = { type: 'user.deleted', targetUserId: 99, targetUserName: 'Charlie', actorId: 99 };
    await notify(ev);
    expect(userSubject()).toContain('Charlie');
  });

  it('uses "User #<id>" in body when actorName is undefined (ticket event)', async () => {
    setupTicket();
    // ticket.status_changed includes actor in body: "${actor} changed status of ticket …"
    await notify({ type: 'ticket.status_changed', ticketId: 20, ticketTitle: 'Test', actorId: 42, assigneeId: 99, extra: 'open' });
    expect(ticketBody()).toContain('User #42');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveRecipients() — event-specific logic
// ────────────────────────────────────────────────────────────────────────────

describe('resolveRecipients() via notify()', () => {
  function insertCount(): number {
    return mockPool.query.mock.calls.filter(([sql]: [string]) =>
      sql.includes('INSERT INTO') && sql.includes('notifications'),
    ).length;
  }

  it('ticket.created sends to assignee and approvers (no DB queries)', async () => {
    // assigneeId=5, approverIds=[6] → 2 unique recipients
    mockPool.query
      .mockResolvedValueOnce(OK)            // INSERT for assignee 5
      .mockResolvedValueOnce(OK)            // INSERT for approver 6
      .mockResolvedValueOnce({ rows: [] }); // email fetch
    await notify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 5, approverIds: [6] });
    expect(insertCount()).toBe(2);
    // Verify no admin/director SELECT was made
    const selectCalls = mockPool.query.mock.calls.filter(([sql]: [string]) =>
      sql.includes('bootstrap_admin') || sql.includes("'director'"),
    );
    expect(selectCalls).toHaveLength(0);
  });

  it('ticket.completed sends to approvers only', async () => {
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [] });
    await notify({ type: 'ticket.completed', ticketId: 1, ticketTitle: 'T', actorId: 1, approverIds: [5, 6] });
    expect(insertCount()).toBe(2);
  });

  it('ticket.approved sends to assignee and creator', async () => {
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [] });
    await notify({ type: 'ticket.approved', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 5, creatorId: 6 });
    expect(insertCount()).toBe(2);
  });

  it('ticket.assigned sends to new assignee only', async () => {
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [] });
    await notify({ type: 'ticket.assigned', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 7 });
    expect(insertCount()).toBe(1);
  });

  it('deduplicates — assigneeId that also appears in approverIds counts once', async () => {
    mockPool.query
      .mockResolvedValueOnce(OK)            // single INSERT (deduped)
      .mockResolvedValueOnce({ rows: [] }); // email fetch
    await notify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 5, approverIds: [5] });
    expect(insertCount()).toBe(1);
  });

  it('ticket.escalated with deptId queries getDeptManagerIds', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 77 }] }) // getDeptManagerIds
      .mockResolvedValueOnce(OK)                       // INSERT for assignee 5
      .mockResolvedValueOnce(OK)                       // INSERT for manager 77
      .mockResolvedValueOnce({ rows: [] });             // email fetch
    await notify({ type: 'ticket.escalated', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 5, deptId: 10 });
    const managerSql = mockPool.query.mock.calls[0][0] as string;
    expect(managerSql.toLowerCase()).toContain("'manager'");
    expect(insertCount()).toBe(2);
  });

  it('ticket.escalated without deptId sends to escalatedToId only (no DB query)', async () => {
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [] });
    await notify({ type: 'ticket.escalated', ticketId: 1, ticketTitle: 'T', actorId: 1, escalatedToId: 8 });
    expect(insertCount()).toBe(1);
    const selectCalls = mockPool.query.mock.calls.filter(([sql]: [string]) =>
      sql.includes("'manager'") || sql.includes("'director'"),
    );
    expect(selectCalls).toHaveLength(0);
  });

  it('ticket.critical always queries getDirectorIds', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 88 }] }) // getDirectorIds
      .mockResolvedValueOnce(OK)                       // INSERT for assignee 5
      .mockResolvedValueOnce(OK)                       // INSERT for director 88
      .mockResolvedValueOnce({ rows: [] });             // email fetch
    await notify({ type: 'ticket.critical', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 5 });
    const directorSql = mockPool.query.mock.calls[0][0] as string;
    expect(directorSql.toLowerCase()).toContain("'director'");
    expect(insertCount()).toBe(2);
  });

  it('user events query bootstrap admins and directors, then add targetUserId', async () => {
    // admins=[], directors=[], targetUserId=50 → 1 recipient (no dedup issue)
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })             // admins
      .mockResolvedValueOnce({ rows: [] })             // directors
      .mockResolvedValueOnce(OK)                       // INSERT for targetUserId=50
      .mockResolvedValueOnce({ rows: [] });             // email fetch
    const ev: UserEvent = { type: 'user.created', targetUserId: 50, targetUserName: 'New User', actorId: 1 };
    await notify(ev);
    // Verify admin query ran
    const adminSql = mockPool.query.mock.calls[0][0] as string;
    expect(adminSql).toContain('is_bootstrap_admin');
    expect(insertCount()).toBe(1);
  });

  it('returns early when recipient set is empty — no INSERT made', async () => {
    // ticket.created with no assigneeId or approverIds → empty set
    const ev = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 1 } as TicketEvent;
    await notify(ev);
    expect(insertCount()).toBe(0);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('ticket.comment_added excludes actor from notification set', async () => {
    // creator=5, assignee=6, actor=6 → actor excluded → only creator 5
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [] });
    await notify({ type: 'ticket.comment_added', ticketId: 1, ticketTitle: 'T', actorId: 6, creatorId: 5, assigneeId: 6 });
    expect(insertCount()).toBe(1);
    const insertParams = mockPool.query.mock.calls[0][1] as unknown[];
    expect(insertParams[0]).toBe(5); // only creator gets notified
  });
});

// ────────────────────────────────────────────────────────────────────────────
// email dispatch
// ────────────────────────────────────────────────────────────────────────────

describe('email dispatch via notify()', () => {
  it('calls sendTicketEventEmail with recipient emails for ticket events', async () => {
    mockSendTicketEmail.mockResolvedValueOnce(undefined);
    // assigneeId=99 → 1 recipient, email fetched
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [{ email: 'assignee@test.com' }] });
    const ev: TicketEvent = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 99 };
    await notify(ev);
    expect(mockSendTicketEmail).toHaveBeenCalledTimes(1);
    expect(mockSendUserEmail).not.toHaveBeenCalled();
    const [, emails] = mockSendTicketEmail.mock.calls[0];
    expect(emails).toContain('assignee@test.com');
  });

  it('calls sendUserEventEmail for user events', async () => {
    mockSendUserEmail.mockResolvedValueOnce(undefined);
    // admins=[99]=targetUserId → 1 recipient
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 99 }] })                    // admins
      .mockResolvedValueOnce({ rows: [] })                               // directors
      .mockResolvedValueOnce(OK)                                         // INSERT
      .mockResolvedValueOnce({ rows: [{ email: 'admin@test.com' }] });   // email fetch
    const ev: UserEvent = { type: 'user.created', targetUserId: 99, targetUserName: 'New User', actorId: 99 };
    await notify(ev);
    expect(mockSendUserEmail).toHaveBeenCalledTimes(1);
    expect(mockSendTicketEmail).not.toHaveBeenCalled();
  });

  it('does not call email functions when email fetch returns no rows', async () => {
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [] }); // email fetch → empty
    const ev: TicketEvent = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 99 };
    await notify(ev);
    expect(mockSendTicketEmail).not.toHaveBeenCalled();
  });

  it('does not re-throw when email dispatch fails — error is caught', async () => {
    mockSendTicketEmail.mockRejectedValueOnce(new Error('SMTP timeout'));
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [{ email: 'user@test.com' }] });
    const ev: TicketEvent = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 99 };
    await expect(notify(ev)).resolves.toBeUndefined();
  });

  it('does not re-throw when in-app INSERT fails — error is caught per recipient', async () => {
    mockPool.query
      .mockRejectedValueOnce(new Error('DB write error'))               // INSERT throws
      .mockResolvedValueOnce({ rows: [{ email: 'user@test.com' }] });   // email fetch still runs
    const ev: TicketEvent = { type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 99 };
    await expect(notify(ev)).resolves.toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// sendPush()
// VAPID constants are evaluated at module-load time → isolateModulesAsync for
// VAPID-enabled tests.
// ────────────────────────────────────────────────────────────────────────────

describe('sendPush() via notify()', () => {
  it('skips push_subscriptions query when VAPID keys are absent', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    mockPool.query
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ rows: [] });
    await notify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 99 });
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

      // Pre-warm ensurePushTable
      for (let i = 0; i < 3; i++) iso.query.mockResolvedValueOnce(OK);
      const { ensurePushTable: warmEPT, notify: freshNotify } =
        require('../modules/notifications/notifications.service');
      await warmEPT();

      mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });
      iso.query
        .mockResolvedValueOnce(OK)                               // INSERT notification for assignee=99
        .mockResolvedValueOnce({ rows: [                         // push_subscriptions for user 99
          { endpoint: 'https://fcm.googleapis.com/push/1', p256dh: 'p256', auth: 'auth' },
        ] })
        .mockResolvedValueOnce({ rows: [{ email: 'user@test.com' }] }); // email fetch

      await freshNotify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 99 });

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
        .mockResolvedValueOnce(OK)                               // INSERT notification
        .mockResolvedValueOnce({ rows: [                         // push_subscriptions
          { endpoint: 'https://fcm.googleapis.com/push/expired', p256dh: 'k', auth: 'a' },
        ] })
        .mockResolvedValueOnce(OK)                               // DELETE expired sub
        .mockResolvedValueOnce({ rows: [{ email: 'user@test.com' }] }); // email fetch

      await freshNotify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 99 });

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
        .mockResolvedValueOnce(OK)
        .mockResolvedValueOnce({ rows: [
          { endpoint: 'https://fcm.googleapis.com/push/active', p256dh: 'k', auth: 'a' },
        ] })
        .mockResolvedValueOnce({ rows: [{ email: 'user@test.com' }] });

      await freshNotify({ type: 'ticket.created', ticketId: 1, ticketTitle: 'T', actorId: 1, assigneeId: 99 });

      const deleteCalls = iso.query.mock.calls.filter(([sql]: [string]) =>
        sql.includes('DELETE') && sql.includes('push_subscriptions'),
      );
      expect(deleteCalls).toHaveLength(0);

      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    });
  });
});
