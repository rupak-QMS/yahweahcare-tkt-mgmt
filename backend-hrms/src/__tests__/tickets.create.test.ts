// ============================================================
// Tests for POST /tickets — create ticket
// Covers: validation (title, category, priority, due date,
//         assignee, approvers), successful creation, conflict
//         between assignee and creator, assignee as approver.
// ============================================================

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

const mockPool = pool as any;

function makeApp(userId = 10, role = 'staff') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { userId, email: 'creator@yahwehcare.com.au', role, sessionId: 1, isAdmin: false, bootstrapAdmin: false, permissions: [] };
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

const validTicket = {
  title: 'Fix broken printer',
  category_id: 1,
  priority_id: 2,
  expected_completion: '2026-07-01',
  assigneeId: 5,
  approver_ids: [20],
  description: 'Printer on level 3 is broken',
};

const ticketRow = {
  id: 42, title: 'Fix broken printer', status: 'open', category_id: 1, priority_id: 2,
  created_by: 10, assigned_to: 5, due_date: '2026-07-01', description: 'Printer on level 3 is broken',
  attachments: '[]', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  closed_date: null,
};

// Helper: mock a successful ticket creation sequence
// Query order (migration guards already set — skip ensureX calls):
// 1) SELECT priorities sla_hours
// 2) SELECT statuses (inside try/catch, may be skipped if table missing)
// 3) INSERT tickets RETURNING *
// 4) INSERT ticket_approvers (one per approver)
// 5) INSERT activity 'created'
// 6) INSERT activity 'assigned' (if assignee provided)
// 7) logAudit INSERT audit_logs
// 8) SELECT ticket_approvers JOIN users (for response)
function mockSuccessfulCreate() {
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ sla_hours: 48 }] })       // 1. SELECT priorities
    .mockResolvedValueOnce({ rows: [{ id: 'open' }] })           // 2. SELECT statuses
    .mockResolvedValueOnce({ rows: [ticketRow] })                // 3. INSERT tickets
    .mockResolvedValueOnce({ rows: [] })                         // 4. INSERT ticket_approvers
    .mockResolvedValueOnce({ rows: [] })                         // 5. INSERT activity 'created'
    .mockResolvedValueOnce({ rows: [] })                         // 6. INSERT activity 'assigned'
    .mockResolvedValueOnce({ rows: [] })                         // 7. logAudit
    .mockResolvedValueOnce({ rows: [{ id: 1, approver_user_id: 20, user_name: 'Approver', user_email: 'approver@yahwehcare.com.au', approval_status: 'Pending' }] }); // 8. SELECT approvers
}

// ── Validation ────────────────────────────────────────────────────────────────

describe('POST /tickets — validation', () => {
  it('returns 400 when title is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/tickets').send({ ...validTicket, title: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when category_id is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/tickets').send({ ...validTicket, category_id: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when priority_id is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/tickets').send({ ...validTicket, priority_id: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when expected_completion (due date) is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/tickets').send({ ...validTicket, expected_completion: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when assignee is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/tickets').send({ ...validTicket, assigneeId: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when no approvers are provided', async () => {
    const app = makeApp();
    const res = await request(app).post('/tickets').send({ ...validTicket, approver_ids: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when creator tries to assign to themselves', async () => {
    const app = makeApp(10); // userId=10
    const res = await request(app).post('/tickets').send({ ...validTicket, assigneeId: 10 }); // same as creator
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_assignee');
  });

  it('returns 400 when assignee is also in approvers list', async () => {
    const app = makeApp(10);
    const res = await request(app).post('/tickets').send({ ...validTicket, assigneeId: 5, approver_ids: [5] }); // assignee=5, approver=5
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_approvers');
  });
});

// ── Successful creation ───────────────────────────────────────────────────────

describe('POST /tickets — successful creation', () => {
  it('returns 201 with ticket object on success', async () => {
    const app = makeApp();
    mockSuccessfulCreate();
    const res = await request(app).post('/tickets').send(validTicket);
    expect(res.status).toBe(201);
    expect(res.body.ticket).toBeDefined();
  });

  it('returned ticket has correct title', async () => {
    const app = makeApp();
    mockSuccessfulCreate();
    const res = await request(app).post('/tickets').send(validTicket);
    expect(res.body.ticket.title).toBe('Fix broken printer');
  });

  it('returned ticket has approvers array', async () => {
    const app = makeApp();
    mockSuccessfulCreate();
    const res = await request(app).post('/tickets').send(validTicket);
    expect(Array.isArray(res.body.ticket.approvers)).toBe(true);
  });

  it('ticket number follows TKT-XXXXXX format', async () => {
    const app = makeApp();
    mockSuccessfulCreate();
    const res = await request(app).post('/tickets').send(validTicket);
    expect(res.body.ticket.ticketNumber).toMatch(/^TKT-\d{6}$/);
  });

  it('accepts camelCase assigneeId and snake_case approver_ids interchangeably', async () => {
    const app = makeApp();
    mockSuccessfulCreate();
    const res = await request(app).post('/tickets').send({ ...validTicket, assign_to: 5, assigneeId: undefined });
    expect(res.status).toBe(201);
  });
});
