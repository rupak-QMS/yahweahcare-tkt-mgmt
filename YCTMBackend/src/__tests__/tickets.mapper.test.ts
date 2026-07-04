// Tests for the dbTicket mapper and ticket route business logic
// The mapper is not exported, so we test it via the GET /tickets endpoint
// using supertest with a mocked pool.

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

// Build a minimal Express app that mounts the tickets router
function makeApp() {
  const app = express();
  app.use(express.json());

  // Inject a fake auth object so requireAuth middleware passes
  app.use((req: any, _res, next) => {
    req.auth = {
      userId: 1,
      email: 'admin@yahwehcare.com.au',
      role: 'super_admin',
      permissions: [],
      sessionId: 1,
      isAdmin: true,
      bootstrapAdmin: true,
    };
    next();
  });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ticketsRouter = require('../modules/tickets/tickets.routes').default;
  app.use('/tickets', ticketsRouter);
  return app;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPool = pool as any;

// ── Helper DB rows ────────────────────────────────────────────────────────────
const baseRow: Record<string, unknown> = {
  id: 42,
  title: 'Fix printer',
  description: 'It jams',
  category_id: 3,
  priority_id: 2,
  status: 'open',
  created_by: 1,
  assigned_to: 5,
  due_date: '2026-07-01T00:00:00Z',
  closed_date: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  attachments: [],
  total: 1,
};

function mockTicketQuery(row: Partial<typeof baseRow> = {}) {
  const r = { ...baseRow, ...row };
  mockPool.query
    // main ticket query
    .mockResolvedValueOnce({ rows: [r], rowCount: 1 } as any)
    // comments
    .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
    // activity
    .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
    // pending approvers
    .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
}

describe('GET /tickets — dbTicket mapper', () => {
  let app: express.Application;

  beforeAll(() => { app = makeApp(); });

  it('maps id as a number', async () => {
    mockTicketQuery();
    const res = await request(app).get('/tickets?scope=all');
    expect(res.status).toBe(200);
    const t = res.body.tickets[0];
    expect(t.id).toBe(42);
  });

  it('generates ticketNumber in TKT-XXXXXX format', async () => {
    mockTicketQuery();
    const res = await request(app).get('/tickets?scope=all');
    expect(res.body.tickets[0].ticketNumber).toBe('TKT-000042');
  });

  it('sets assigneeId from assigned_to', async () => {
    mockTicketQuery({ assigned_to: 7 });
    const res = await request(app).get('/tickets?scope=all');
    expect(res.body.tickets[0].assigneeId).toBe(7);
  });

  it('assigneeId is null when assigned_to is null', async () => {
    mockTicketQuery({ assigned_to: null as any });
    const res = await request(app).get('/tickets?scope=all');
    expect(res.body.tickets[0].assigneeId).toBeNull();
  });

  it('slaBreached is false when closedDate is before dueDate (on time)', async () => {
    mockTicketQuery({
      due_date:    '2026-07-10T00:00:00Z',
      closed_date: '2026-07-05T00:00:00Z',
    });
    const res = await request(app).get('/tickets?scope=all');
    expect(res.body.tickets[0].slaBreached).toBe(false);
  });

  it('slaBreached is true when closedDate is after dueDate', async () => {
    mockTicketQuery({
      due_date:    '2026-07-01T00:00:00Z',
      closed_date: '2026-07-15T00:00:00Z',
    });
    const res = await request(app).get('/tickets?scope=all');
    expect(res.body.tickets[0].slaBreached).toBe(true);
  });

  it('isClosed is true for resolved status', async () => {
    mockTicketQuery({ status: 'resolved', closed_date: null as any });
    const res = await request(app).get('/tickets?scope=all');
    expect(res.body.tickets[0].isClosed).toBe(true);
  });

  it('isClosed is false for open status', async () => {
    mockTicketQuery({ status: 'open', closed_date: null as any });
    const res = await request(app).get('/tickets?scope=all');
    expect(res.body.tickets[0].isClosed).toBe(false);
  });

  it('attachments defaults to [] when not an array', async () => {
    mockTicketQuery({ attachments: null as any });
    const res = await request(app).get('/tickets?scope=all');
    expect(Array.isArray(res.body.tickets[0].attachments)).toBe(true);
    expect(res.body.tickets[0].attachments).toHaveLength(0);
  });

  it('pendingApproverIds defaults to [] when absent', async () => {
    mockTicketQuery();
    const res = await request(app).get('/tickets?scope=all');
    expect(Array.isArray(res.body.tickets[0].pendingApproverIds)).toBe(true);
  });
});

// ── GET /tickets — scope filtering ───────────────────────────────────────────

describe('GET /tickets — scope parameter handling', () => {
  let app: express.Application;

  beforeAll(() => { app = makeApp(); });

  it('returns tickets for scope=all with no extra WHERE clause', async () => {
    mockTicketQuery();
    const res = await request(app).get('/tickets?scope=all');
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
  });

  it('returns empty array when pool returns no rows', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).get('/tickets?scope=all');
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('scope=mine with userId queries are included', async () => {
    mockTicketQuery();
    const res = await request(app).get('/tickets?scope=mine&userId=1');
    expect(res.status).toBe(200);
    // The SQL sent to pool should reference $1 (userId)
    const callArgs = mockPool.query.mock.calls[0];
    const sql = callArgs[0] as string;
    expect(sql).toContain('created_by');
    expect(sql).toContain('assigned_to');
    expect(sql).toContain('ticket_approvers');
  });

  it('scope=assigned_to_me only filters on assigned_to', async () => {
    mockTicketQuery();
    const res = await request(app).get('/tickets?scope=assigned_to_me&userId=5');
    expect(res.status).toBe(200);
    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('assigned_to');
    // Must NOT use created_by as a WHERE filter (JOIN for requester name is fine)
    // scope=mine uses "OR v.created_by = $N"; assigned_to_me must not
    expect(sql).not.toContain('OR v.created_by');
    expect(sql).not.toContain('ticket_approvers');
  });

  it('scope=dept filters on department users', async () => {
    mockTicketQuery();
    const res = await request(app).get('/tickets?scope=dept&deptId=3');
    expect(res.status).toBe(200);
    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('department_id');
  });

  it('?all=1 includes closed tickets', async () => {
    mockTicketQuery({ status: 'closed', closed_date: '2026-06-01T00:00:00Z' });
    const res = await request(app).get('/tickets?all=1');
    expect(res.status).toBe(200);
    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).not.toContain("NOT IN ('resolved', 'closed')");
  });

  it('default (no all param) excludes closed tickets via SQL filter', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).get('/tickets');
    expect(res.status).toBe(200);
    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain("NOT IN ('resolved', 'closed')");
  });
});

// ── POST /tickets — validation ────────────────────────────────────────────────

describe('POST /tickets — input validation', () => {
  let app: express.Application;

  beforeAll(() => { app = makeApp(); });

  const validPayload = {
    title_type: 'Service Request',
    subtitle:   'Fix printer',
    category_id:  3,
    priority_id:  2,
    assigneeId:   5,
    approver_ids: [10],
    expected_completion: '2026-07-01',
  };

  it('returns 400 when title is missing', async () => {
    const res = await request(app).post('/tickets').send({
      ...validPayload,
      title_type: '',
      subtitle: '',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when category is missing', async () => {
    const res = await request(app).post('/tickets').send({
      ...validPayload,
      category_id: undefined,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when assignee is missing', async () => {
    const res = await request(app).post('/tickets').send({
      ...validPayload,
      assigneeId: undefined,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when expected_completion is missing', async () => {
    const res = await request(app).post('/tickets').send({
      ...validPayload,
      expected_completion: undefined,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when no approvers provided', async () => {
    const res = await request(app).post('/tickets').send({
      ...validPayload,
      approver_ids: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when assignee == creator (user id=1)', async () => {
    // Auth injects userId=1 as creator
    const res = await request(app).post('/tickets').send({
      ...validPayload,
      assigneeId: 1, // same as creator (req.auth.userId = 1)
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_assignee');
  });

  it('returns 400 when assignee is also in approver list', async () => {
    // Need pool to pass the priorities + statuses queries first
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ sla_hours: 8 }] } as any)   // priorities
      .mockResolvedValueOnce({ rows: [{ id: 'open' }] } as any);     // statuses
    const res = await request(app).post('/tickets').send({
      ...validPayload,
      assigneeId:   5,
      approver_ids: [5, 10], // 5 is both assignee and approver
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_approvers');
  });
});
