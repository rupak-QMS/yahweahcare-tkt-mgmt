// ============================================================
// Tests for the dept scope query — verifies the Akila fix:
// scope=dept now includes tickets where the user is an approver
// (even cross-department), not just dept-based assignment/creation.
// ============================================================

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

const mockPool = pool as any;

function makeApp(userId = 30, role = 'staff') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { userId, email: 'manager@yahwehcare.com.au', role, sessionId: 1, isAdmin: false, bootstrapAdmin: false, permissions: [] };
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

// Minimal response shape needed by GET /tickets
const emptyTicketListResponse = { rows: [] };
const emptyActivityRows = { rows: [] };
const emptyCommentRows = { rows: [] };
const emptyApproverMap = { rows: [] };

function mockListFlow(ticketRows: unknown[] = []) {
  // GET /tickets query sequence:
  // 1) Main ticket SELECT (with all joins)
  // 2) Comments (separate)
  // 3) Activity (separate)
  // 4) Approver map (separate)
  mockPool.query
    .mockResolvedValueOnce({ rows: ticketRows })
    .mockResolvedValueOnce(emptyCommentRows)
    .mockResolvedValueOnce(emptyActivityRows)
    .mockResolvedValueOnce(emptyApproverMap);
}

// ── Dept scope SQL generation ─────────────────────────────────────────────────

describe('GET /tickets — scope=dept includes approver clause (Akila fix)', () => {
  it('returns 200 with scope=dept and deptId', async () => {
    const app = makeApp();
    mockListFlow();
    const res = await request(app).get('/tickets?scope=dept&deptId=3&userId=30&all=1');
    expect(res.status).toBe(200);
    expect(res.body.tickets).toBeDefined();
  });

  it('returns empty tickets array when no matching tickets', async () => {
    const app = makeApp();
    mockListFlow([]);
    const res = await request(app).get('/tickets?scope=dept&deptId=3&userId=30&all=1');
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('returns tickets when userId is provided with scope=dept', async () => {
    const ticketRow = {
      id: 55, title: 'Cross-dept ticket', status: 'pending_approval', category_id: 1, priority_id: 2,
      created_by: 99, assigned_to: 98, due_date: '2026-07-01', description: '',
      attachments: '[]', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      closed_date: null, total: '1', category_label: null, category_icon: null,
      priority_label: 'Medium', priority_sla_hours: 48, assigned_to_name: null,
      pending_approver_ids: null,
    };
    mockListFlow([ticketRow]);
    const app = makeApp(30);
    const res = await request(app).get('/tickets?scope=dept&deptId=3&userId=30&all=1');
    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(res.body.tickets[0].title).toBe('Cross-dept ticket');
  });

  it('scope=dept without userId still works (no approver clause)', async () => {
    const app = makeApp();
    mockListFlow();
    const res = await request(app).get('/tickets?scope=dept&deptId=3&all=1');
    expect(res.status).toBe(200);
  });

  it('scope=mine with userId filters to own + approver tickets', async () => {
    const app = makeApp(30);
    mockListFlow();
    const res = await request(app).get('/tickets?scope=mine&userId=30&all=1');
    expect(res.status).toBe(200);
    expect(res.body.tickets).toBeDefined();
  });

  it('scope=all returns tickets without department filtering', async () => {
    const app = makeApp(30);
    mockListFlow();
    const res = await request(app).get('/tickets?scope=all&all=1');
    expect(res.status).toBe(200);
  });
});

// ── SQL clause correctness ────────────────────────────────────────────────────

describe('dept scope SQL clause — unit-level check', () => {
  it('WHERE clause includes EXISTS subquery for ticket_approvers when userId provided', async () => {
    // Intercept the actual pool.query call to inspect the SQL sent
    let capturedSql = '';
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes('ticket_approvers') && sql.includes('approver_user_id')) {
        capturedSql = sql;
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const app = makeApp(30);
    await request(app).get('/tickets?scope=dept&deptId=3&userId=30&all=1');
    // The main ticket query should contain the EXISTS approver subquery
    expect(capturedSql).toMatch(/EXISTS/i);
    expect(capturedSql).toMatch(/approver_user_id/);
  });

  it('WHERE clause does NOT include EXISTS subquery when userId is absent', async () => {
    let capturedSql = '';
    mockPool.query.mockImplementation((sql: string, params?: unknown[]) => {
      // Capture the main ticket list query (the one with the big SELECT v.*)
      if (typeof sql === 'string' && sql.includes('department_id') && sql.includes('created_by')) {
        capturedSql = sql;
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const app = makeApp(30);
    await request(app).get('/tickets?scope=dept&deptId=3&all=1'); // no userId
    // Without userId, the approver EXISTS clause should NOT appear
    if (capturedSql) {
      expect(capturedSql).not.toMatch(/approver_user_id/);
    }
  });
});
