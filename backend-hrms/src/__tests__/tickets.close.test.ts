// Tests for POST /tickets/:id/close
// Feature: requester confirms resolution → ticket moves from 'resolved' to 'closed'

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPool = pool as any;

// Build a minimal Express app with injected auth
function makeApp(role = 'staff', userId = 10, bootstrapAdmin = false) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = {
      userId,
      email: 'test@yahwehcare.com.au',
      role,
      sessionId: 1,
      isAdmin: ['super_admin', 'admin', 'manager', 'hr'].includes(role),
      bootstrapAdmin,
      permissions: [],
    };
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ticketsRouter = require('../modules/tickets/tickets.routes').default;
  app.use('/tickets', ticketsRouter);
  return app;
}

// ── Shared DB row shapes ──────────────────────────────────────────────────────

const resolvedTicketRow = {
  id: 42,
  title: 'Fix printer',
  status: 'resolved',
  created_by: 10,      // matches userId=10 (the requester)
  assigned_to: 5,
};

const closedTicketRow = {
  id: 42,
  title: 'Fix printer',
  status: 'closed',
  created_by: 10,
  assigned_to: 5,
  description: '',
  category_id: 3,
  priority_id: 2,
  due_date: '2026-07-01T00:00:00Z',
  closed_date: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  attachments: [],
  total: 1,
};

// Helper — mock all pool calls for a successful close
function mockSuccessfulClose() {
  mockPool.query
    .mockResolvedValueOnce({ rows: [resolvedTicketRow], rowCount: 1 } as any)  // SELECT ticket
    .mockResolvedValueOnce({ rows: [closedTicketRow],   rowCount: 1 } as any)  // UPDATE RETURNING *
    .mockResolvedValueOnce({ rows: [{ name: 'Yahweh Care' }], rowCount: 1 } as any) // getActorName
    .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)                   // INSERT activity
    .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)                   // SELECT approvers
    .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);                  // logAudit INSERT
}

// ── Module warm-up ────────────────────────────────────────────────────────────
// tickets.routes.ts fires 3 async migration functions (12 pool.query calls total)
// at module load time. We pre-consume those calls here so they don't steal mock
// values from the first test.
beforeAll(async () => {
  for (let i = 0; i < 12; i++) {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
  }
  require('../modules/tickets/tickets.routes');
  // Yield to the event loop so all 12 migration awaits resolve
  await new Promise(resolve => setImmediate(resolve));
});

// ── POST /tickets/:id/close — access control ──────────────────────────────────

describe('POST /tickets/:id/close — access control', () => {
  it('returns 404 when ticket does not exist', async () => {
    const app = makeApp('staff', 10);
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).post('/tickets/999/close');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('returns 403 when caller is not the ticket creator', async () => {
    // userId=99 is NOT created_by=10
    const app = makeApp('staff', 99, false);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...resolvedTicketRow, created_by: 10 }], rowCount: 1,
    } as any);
    const res = await request(app).post('/tickets/42/close');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 400 when ticket status is not resolved (e.g. open)', async () => {
    const app = makeApp('staff', 10);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...resolvedTicketRow, status: 'open' }], rowCount: 1,
    } as any);
    const res = await request(app).post('/tickets/42/close');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_status');
  });

  it('returns 400 when ticket status is in_progress', async () => {
    const app = makeApp('staff', 10);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...resolvedTicketRow, status: 'in_progress' }], rowCount: 1,
    } as any);
    const res = await request(app).post('/tickets/42/close');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_status');
  });

  it('returns 400 when ticket is already closed', async () => {
    const app = makeApp('staff', 10);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...resolvedTicketRow, status: 'closed' }], rowCount: 1,
    } as any);
    const res = await request(app).post('/tickets/42/close');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_status');
  });
});

// ── POST /tickets/:id/close — successful close by creator ─────────────────────

describe('POST /tickets/:id/close — successful close', () => {
  it('returns 200 and ticket with status closed when creator closes a resolved ticket', async () => {
    const app = makeApp('staff', 10);
    mockSuccessfulClose();
    const res = await request(app).post('/tickets/42/close');
    expect(res.status).toBe(200);
    expect(res.body.ticket).toBeDefined();
    expect(res.body.ticket.status).toBe('closed');
  });

  it('ticket id in response matches the closed ticket', async () => {
    const app = makeApp('staff', 10);
    mockSuccessfulClose();
    const res = await request(app).post('/tickets/42/close');
    expect(res.body.ticket.id).toBe(42);
  });

  it('isClosed is true on the returned ticket', async () => {
    const app = makeApp('staff', 10);
    mockSuccessfulClose();
    const res = await request(app).post('/tickets/42/close');
    expect(res.body.ticket.isClosed).toBe(true);
  });
});

// ── POST /tickets/:id/close — admin override ──────────────────────────────────

describe('POST /tickets/:id/close — admin can close any resolved ticket', () => {
  it('bootstrap admin (not creator) can close a resolved ticket', async () => {
    // userId=99 is NOT created_by=10, but bootstrapAdmin=true
    const app = makeApp('super_admin', 99, true);
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ...resolvedTicketRow, created_by: 10 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [closedTicketRow], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ name: 'Admin' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).post('/tickets/42/close');
    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe('closed');
  });

  it('super_admin role (not creator) can close a resolved ticket', async () => {
    const app = makeApp('super_admin', 50, false);
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ...resolvedTicketRow, created_by: 10 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [closedTicketRow], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ name: 'Super Admin' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).post('/tickets/42/close');
    expect(res.status).toBe(200);
  });

  it('admin role (not creator) can close a resolved ticket', async () => {
    const app = makeApp('admin', 50, true);
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ...resolvedTicketRow, created_by: 10 }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [closedTicketRow], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ name: 'Admin User' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).post('/tickets/42/close');
    expect(res.status).toBe(200);
  });

  it('regular staff (not creator, not admin) cannot close', async () => {
    const app = makeApp('staff', 77, false);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...resolvedTicketRow, created_by: 10 }], rowCount: 1,
    } as any);
    const res = await request(app).post('/tickets/42/close');
    expect(res.status).toBe(403);
  });

  it('manager (not creator, not bootstrap admin) cannot close another user\'s ticket', async () => {
    const app = makeApp('manager', 77, false);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...resolvedTicketRow, created_by: 10 }], rowCount: 1,
    } as any);
    const res = await request(app).post('/tickets/42/close');
    expect(res.status).toBe(403);
  });
});
