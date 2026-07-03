// ============================================================
// Tests for POST /tickets/:id/approve
// Covers: not-an-approver guard, partial approval (one of two),
//         full approval (all approved → status becomes resolved),
//         approval history insert.
// ============================================================

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';
import { notify } from '../modules/notifications/notifications.service';
import * as emailNotify from '../services/email/notification.service';

// The route handlers now await notify()/notifyTicketXxx() BEFORE sending the
// response (previously they fired-and-forgot after res.json(), which meant
// they silently never ran to completion on Vercel's serverless runtime).
// These tests exercise the ticket-approval business logic, not notification
// delivery, so the notification modules are mocked out here — otherwise
// their internal pool.query() calls would consume entries from this file's
// hand-crafted mockPool.query sequence meant for the approval flow itself.
jest.mock('../modules/notifications/notifications.service', () => ({
  notify: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/email/notification.service', () => ({
  notifyTicketCreated:       jest.fn().mockResolvedValue(undefined),
  notifyResolutionSubmitted: jest.fn().mockResolvedValue(undefined),
  notifyTicketApproved:      jest.fn().mockResolvedValue(undefined),
  notifyTicketRejected:      jest.fn().mockResolvedValue(undefined),
  notifyTicketClosed:        jest.fn().mockResolvedValue(undefined),
  notifyTicketReopened:      jest.fn().mockResolvedValue(undefined),
  notifyTicketEscalated:     jest.fn().mockResolvedValue(undefined),
  notifyCommentAdded:        jest.fn().mockResolvedValue(undefined),
  notifyAttachmentAdded:     jest.fn().mockResolvedValue(undefined),
  notifyExtensionRequested:  jest.fn().mockResolvedValue(undefined),
  notifyExtensionApproved:   jest.fn().mockResolvedValue(undefined),
  notifyExtensionRejected:   jest.fn().mockResolvedValue(undefined),
}));

const mockPool = pool as any;

function makeApp(userId = 20, role = 'staff') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { userId, email: 'approver@yahwehcare.com.au', role, sessionId: 1, isAdmin: false, bootstrapAdmin: false, permissions: [] };
    next();
  });
  const router = require('../modules/tickets/tickets.routes').default;
  app.use('/tickets', router);
  return app;
}

// ── Module warm-up ────────────────────────────────────────────────────────────
beforeAll(async () => {
  for (let i = 0; i < 12; i++) {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
  }
  require('../modules/tickets/tickets.routes');
  await new Promise(resolve => setImmediate(resolve));
});

// The approve route now also awaits getActorName()/getTicketDept() and an
// extra ticket lookup as part of the notify block (moved before res.json()
// so notifications reliably fire — see tickets.routes.ts). Those calls sit
// after every mockResolvedValueOnce() sequence below and are irrelevant to
// what each test actually asserts, so give pool.query a safe fallback for
// any call beyond the explicitly queued ones instead of letting it return
// undefined (which would crash a raw, un-try/caught destructure).
// jest.config's resetMocks:true clears every mock's implementation (including
// the .mockResolvedValue(undefined) set in the jest.mock() factories above)
// before each test. Without re-applying it here, notify()/notifyTicketXxx()
// return `undefined` instead of a Promise, so the route's `.catch(() => {})`
// on the result throws "Cannot read properties of undefined (reading 'catch')".
beforeEach(() => {
  const mockPool = pool as any;
  mockPool.query.mockResolvedValue({ rows: [] });
  (notify as jest.Mock).mockResolvedValue(undefined);
  Object.values(emailNotify).forEach((fn: any) => {
    if (typeof fn?.mockResolvedValue === 'function') fn.mockResolvedValue(undefined);
  });
});

const baseTicketRow = {
  id: 42, title: 'Fix printer', status: 'pending_approval', category_id: 1, priority_id: 2,
  created_by: 10, assigned_to: 5, due_date: '2026-07-01', description: 'desc',
  attachments: '[]', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  closed_date: null, resolution_note: 'Printer fixed', approval_round: 1,
};

const approverRow20 = { id: 1, ticket_id: 42, approver_user_id: 20, approval_status: 'Pending', user_email: 'approver@yahwehcare.com.au', user_name: 'Approver One' };
const approverRow21 = { id: 2, ticket_id: 42, approver_user_id: 21, approval_status: 'Pending', user_email: 'approver2@yahwehcare.com.au', user_name: 'Approver Two' };

// ── POST /tickets/:id/approve ────────────────────────────────────────────────

describe('POST /tickets/:id/approve', () => {
  it('returns 403 when user is not an approver', async () => {
    const app = makeApp(99); // user 99 not in ticket_approvers
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // no row found
    const res = await request(app).post('/tickets/42/approve').send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_approver');
  });

  it('returns 200 when approved with pending approvers remaining (partial)', async () => {
    const app = makeApp(20);
    // Sequence for partial approval (one of two approvers):
    // 1) SELECT ticket_approvers WHERE ticket_id=42 AND approver_user_id=20 (is approver)
    // 2) UPDATE ticket_approvers SET Approved WHERE ticket_id=42 AND approver_user_id=20
    // 3) SELECT resolution_note, approval_round FROM tickets (for history snapshot)
    // 4) getActorName → SELECT name FROM users WHERE id=20 (async, post-update)
    // 5) INSERT ticket_approval_history
    // 6) INSERT activity (approved)
    // 7) SELECT count(*) FROM ticket_approvers WHERE ticket_id=42 AND approval_status != 'Approved'  → count=1 (partial)
    // 8) SELECT * FROM tickets WHERE id=42 (fetch ticket for response)
    // 9) SELECT ticket_approvers + users JOIN (all approvers)
    // 10) logAudit INSERT
    mockPool.query
      .mockResolvedValueOnce({ rows: [approverRow20] })       // is approver check
      .mockResolvedValueOnce({ rows: [] })                    // UPDATE ticket_approvers
      .mockResolvedValueOnce({ rows: [{ resolution_note: 'Fixed', approval_round: 1 }] }) // ticket snap
      .mockResolvedValueOnce({ rows: [{ name: 'Approver One' }] }) // getActorName
      .mockResolvedValueOnce({ rows: [] })                    // INSERT approval_history
      .mockResolvedValueOnce({ rows: [] })                    // INSERT activity
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })      // pending count = 1 (partial)
      .mockResolvedValueOnce({ rows: [baseTicketRow] })       // SELECT ticket
      .mockResolvedValueOnce({ rows: [approverRow20, approverRow21] }) // all approvers
      .mockResolvedValueOnce({ rows: [] });                   // logAudit
    const res = await request(app).post('/tickets/42/approve').send({ acceptanceNote: 'Looks good' });
    expect(res.status).toBe(200);
    expect(res.body.ticket).toBeDefined();
  });

  it('ticket status stays pending_approval when not all have approved', async () => {
    const app = makeApp(20);
    mockPool.query
      .mockResolvedValueOnce({ rows: [approverRow20] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ resolution_note: 'Fixed', approval_round: 1 }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Approver One' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })      // still 1 pending
      .mockResolvedValueOnce({ rows: [baseTicketRow] })
      .mockResolvedValueOnce({ rows: [approverRow20, approverRow21] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/tickets/42/approve').send({});
    expect(res.body.ticket.status).toBe('pending_approval');
  });

  it('ticket status becomes Resolved when all approvers have approved', async () => {
    const app = makeApp(20);
    const resolvedRow = { ...baseTicketRow, status: 'resolved', closed_date: new Date().toISOString() };
    // When count = 0 (all approved), code does UPDATE status='resolved' then INSERT activity
    mockPool.query
      .mockResolvedValueOnce({ rows: [approverRow20] })
      .mockResolvedValueOnce({ rows: [] })                    // UPDATE approver
      .mockResolvedValueOnce({ rows: [{ resolution_note: 'Fixed', approval_round: 1 }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Approver One' }] })
      .mockResolvedValueOnce({ rows: [] })                    // INSERT history
      .mockResolvedValueOnce({ rows: [] })                    // INSERT activity (approved)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })      // ALL approved → resolve
      .mockResolvedValueOnce({ rows: [resolvedRow] })         // UPDATE tickets → resolved
      .mockResolvedValueOnce({ rows: [] })                    // INSERT activity (status_changed resolved)
      .mockResolvedValueOnce({ rows: [approverRow20] })       // SELECT all approvers
      .mockResolvedValueOnce({ rows: [] });                   // logAudit
    const res = await request(app).post('/tickets/42/approve').send({});
    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe('resolved');
  });

  it('returned ticket has approvers array', async () => {
    const app = makeApp(20);
    mockPool.query
      .mockResolvedValueOnce({ rows: [approverRow20] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ resolution_note: 'Fixed', approval_round: 1 }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Approver One' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [baseTicketRow] })
      .mockResolvedValueOnce({ rows: [approverRow20, approverRow21] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/tickets/42/approve').send({});
    expect(Array.isArray(res.body.ticket.approvers)).toBe(true);
    expect(res.body.ticket.approvers).toHaveLength(2);
  });
});
