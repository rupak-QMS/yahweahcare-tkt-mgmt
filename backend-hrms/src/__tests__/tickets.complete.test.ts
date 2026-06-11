// ============================================================
// Tests for POST /tickets/:id/complete (assignee marks work done)
// and POST /tickets/:id/reject (approver rejects back to in_progress)
// ============================================================

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

const mockPool = pool as any;

function makeApp(userId = 5, role = 'staff') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { userId, email: 'assignee@yahwehcare.com.au', role, sessionId: 1, isAdmin: false, bootstrapAdmin: false, permissions: [] };
    next();
  });
  const router = require('../modules/tickets/tickets.routes').default;
  app.use('/tickets', router);
  return app;
}

// ── Module warm-up: consume 12 migration queries ────────────────────────────
beforeAll(async () => {
  for (let i = 0; i < 12; i++) {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
  }
  require('../modules/tickets/tickets.routes');
  await new Promise(resolve => setImmediate(resolve));
});

const ticketRow = {
  id: 42, title: 'Fix printer', status: 'open', category_id: 1, priority_id: 2,
  created_by: 10, assigned_to: 5, due_date: '2026-07-01', description: 'desc',
  attachments: '[]', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  closed_date: null, resolution_note: null, approval_round: 1,
};

const pendingApprovalRow = { ...ticketRow, status: 'pending_approval' };

// Mock the complete flow sequence:
// 1) SELECT tickets WHERE id (find ticket)
// 2) SELECT count(*) FROM ticket_approvers (has approvers check)
// 3) INSERT INTO ticket_approval_history (snapshot)
// 4) UPDATE tickets SET approval_round + 1
// 5) UPDATE ticket_approvers SET approval_status='Pending'
// 6) UPDATE tickets SET status='pending_approval' RETURNING *
// 7) INSERT INTO activity (status_changed)
// 8) logAudit INSERT
// Post-response (ignored): getActorName, getTicketDept, SELECT approver_ids, notify
function mockCompleteFlow() {
  mockPool.query
    .mockResolvedValueOnce({ rows: [ticketRow] })            // SELECT ticket
    .mockResolvedValueOnce({ rows: [{ count: '2' }] })       // SELECT count approvers
    .mockResolvedValueOnce({ rows: [] })                     // INSERT history snapshot
    .mockResolvedValueOnce({ rows: [] })                     // UPDATE approval_round
    .mockResolvedValueOnce({ rows: [] })                     // UPDATE ticket_approvers → Pending
    .mockResolvedValueOnce({ rows: [pendingApprovalRow] })   // UPDATE tickets → pending_approval
    .mockResolvedValueOnce({ rows: [] })                     // INSERT activity
    .mockResolvedValueOnce({ rows: [] });                    // logAudit
}

// ── POST /tickets/:id/complete ────────────────────────────────────────────────

describe('POST /tickets/:id/complete', () => {
  it('returns 400 when resolutionNote is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/tickets/42/complete').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('resolution_required');
  });

  it('returns 400 when resolutionNote is empty string', async () => {
    const app = makeApp();
    const res = await request(app).post('/tickets/42/complete').send({ resolutionNote: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('resolution_required');
  });

  it('returns 404 when ticket does not exist', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // ticket not found
    const res = await request(app).post('/tickets/999/complete').send({ resolutionNote: 'Fixed it' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('returns 400 when ticket has no approvers', async () => {
    const app = makeApp();
    mockPool.query
      .mockResolvedValueOnce({ rows: [ticketRow] })       // SELECT ticket
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }); // count = 0
    const res = await request(app).post('/tickets/42/complete').send({ resolutionNote: 'Fixed it' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_approvers');
  });

  it('returns 200 and ticket with status pending_approval on success', async () => {
    const app = makeApp();
    mockCompleteFlow();
    const res = await request(app).post('/tickets/42/complete').send({ resolutionNote: 'Printer is fixed' });
    expect(res.status).toBe(200);
    expect(res.body.ticket).toBeDefined();
    expect(res.body.ticket.status).toBe('pending_approval');
  });

  it('returned ticket has id 42', async () => {
    const app = makeApp();
    mockCompleteFlow();
    const res = await request(app).post('/tickets/42/complete').send({ resolutionNote: 'Done' });
    expect(res.body.ticket.id).toBe(42);
  });
});

// ── POST /tickets/:id/reject ──────────────────────────────────────────────────

describe('POST /tickets/:id/reject', () => {
  const approverRow = { id: 1, ticket_id: 42, approver_user_id: 20, approval_status: 'Pending', user_email: 'approver@yahwehcare.com.au' };
  const rejectedTicketRow = { ...ticketRow, status: 'in_progress' };

  function mockRejectFlow() {
    mockPool.query
      .mockResolvedValueOnce({ rows: [approverRow] })      // SELECT ticket_approvers (is approver check)
      .mockResolvedValueOnce({ rows: [] })                 // UPDATE ticket_approvers → Rejected
      .mockResolvedValueOnce({ rows: [{ resolution_note: 'Fixed', approval_round: 1 }] }) // SELECT ticket snap
      .mockResolvedValueOnce({ rows: [] })                 // getActorName query (inside fn)
      .mockResolvedValueOnce({ rows: [] })                 // INSERT approval_history
      .mockResolvedValueOnce({ rows: [rejectedTicketRow] }) // UPDATE tickets → in_progress
      .mockResolvedValueOnce({ rows: [] })                 // INSERT activity rejected
      .mockResolvedValueOnce({ rows: [approverRow] })      // SELECT all approvers
      .mockResolvedValueOnce({ rows: [] });                // logAudit
  }

  it('returns 400 when justification is missing', async () => {
    const app = makeApp(20); // approver id=20
    const res = await request(app).post('/tickets/42/reject').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('justification_required');
  });

  it('returns 400 when justification is blank', async () => {
    const app = makeApp(20);
    const res = await request(app).post('/tickets/42/reject').send({ justification: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('justification_required');
  });

  it('returns 403 when user is not an approver for the ticket', async () => {
    const app = makeApp(99); // user 99 is not an approver
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // not found in ticket_approvers
    const res = await request(app).post('/tickets/42/reject').send({ justification: 'Not satisfied' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_approver');
  });

  it('returns 200 and reopened ticket on successful rejection', async () => {
    const app = makeApp(20);
    mockRejectFlow();
    const res = await request(app).post('/tickets/42/reject').send({ justification: 'Work not complete' });
    expect(res.status).toBe(200);
    expect(res.body.ticket).toBeDefined();
  });

  it('rejected ticket status is back to In Progress', async () => {
    const app = makeApp(20);
    mockRejectFlow();
    const res = await request(app).post('/tickets/42/reject').send({ justification: 'Needs more work' });
    expect(res.body.ticket.status).toBe('in_progress');
  });
});
