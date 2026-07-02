/**
 * Unit tests — ticket-routes.js
 *
 * Covers:
 *  GET  /api/tickets            — list (role filtering, query params, limit)
 *  GET  /api/tickets/:id        — detail (not found, forbidden for wrong staff)
 *  POST /api/tickets            — create (validation, happy path, SLA, email/push hooks)
 *  PATCH /api/tickets/:id       — update (staff restrictions, no-op, status transitions)
 *  POST /api/tickets/:id/comments — add comment (validation, forbidden)
 *
 * All DB calls are mocked — no real Postgres connection needed.
 */

const express = require('express');
const request = require('supertest');

// ── Fixtures ─────────────────────────────────────────────────────────────────
const TICKET_ROW = {
  id: 1,
  ticket_number: 'YAH-000001',
  title: 'Printer not working',
  description: 'Toner is empty',
  category_id: 'hardware',
  priority_id: 'high',
  status_id: 'new',
  requester_id: 10,
  assignee_id: null,
  site: 'Sydney',
  due_at: new Date(Date.now() + 86400000).toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  resolved_at: null,
  closed_at: null,
  sla_breached: false,
  category_label: 'Hardware',
  category_icon: 'monitor',
  priority_label: 'High',
  sla_hours: 8,
  status_label: 'New',
  is_closed: false,
  requester_name: 'Alice Smith',
  requester_email: 'alice@test.com',
  assignee_name: null,
  assignee_email: null,
  sla_breached_now: false,
};

const COMMENT_ROW = {
  id: 99,
  ticket_id: 1,
  author_id: 20,
  body: 'Looking into this now',
  is_internal: false,
  created_at: new Date().toISOString(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeAuth(user = { id: 20, email: 'agent@test.com', name: 'Bob Agent', role: 'agent', site: 'Sydney' }) {
  return (req, _res, next) => { req.user = user; next(); };
}

function makeStaffAuth(overrides = {}) {
  return makeAuth({ id: 10, email: 'alice@test.com', name: 'Alice Smith', role: 'staff', site: 'Sydney', ...overrides });
}

function makeHelpers(overrides = {}) {
  return {
    nextTicketNumber: jest.fn().mockResolvedValue('YAH-000001'),
    slaHoursFor:      jest.fn().mockResolvedValue(8),
    queueEmail:       jest.fn().mockResolvedValue(undefined),
    sendPushToUser:   jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Build a pool mock whose `query` calls return values in order.
 * Pass an array of { rows } objects (one per expected query call).
 */
function makePool(responses = []) {
  const fn = jest.fn();
  responses.forEach(r => fn.mockResolvedValueOnce(r));
  fn.mockResolvedValue({ rows: [] }); // fallback for any extra queries
  return { query: fn, on: jest.fn() };
}

function buildApp(pool, auth, helpers) {
  const ticketRoutes = require('../ticket-routes');
  const app = express();
  app.use(express.json());
  app.use('/api', ticketRoutes(pool, auth, helpers));
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/tickets
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/tickets', () => {
  test('returns tickets list for an agent', async () => {
    const pool = makePool([{ rows: [TICKET_ROW] }]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app).get('/api/tickets');

    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(res.body.tickets[0].ticket_number).toBe('YAH-000001');
    expect(res.body.total).toBe(1);
  });

  test('staff user only sees their own tickets (requester_id filter added)', async () => {
    const pool = makePool([{ rows: [] }]);
    const app  = buildApp(pool, makeStaffAuth(), makeHelpers());

    await request(app).get('/api/tickets');

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/requester_id/);
  });

  test('agent sees all tickets — no requester_id WHERE filter (params list shorter)', async () => {
    const agentPool = makePool([{ rows: [] }]);
    const staffPool = makePool([{ rows: [] }]);
    const agentApp  = buildApp(agentPool, makeAuth(), makeHelpers());
    const staffApp  = buildApp(staffPool, makeStaffAuth(), makeHelpers());

    await request(agentApp).get('/api/tickets');
    await request(staffApp).get('/api/tickets');

    // Staff query has one extra param (the requester_id), agent query does not
    const agentParams = agentPool.query.mock.calls[0][1];
    const staffParams = staffPool.query.mock.calls[0][1];
    // Agent only passes the limit; staff passes requester_id + limit
    expect(agentParams.length).toBeLessThan(staffParams.length);
  });

  test('filters by status query param', async () => {
    const pool = makePool([{ rows: [] }]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    await request(app).get('/api/tickets?status=in_progress');

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/status_id/);
  });

  test('filters by priority query param', async () => {
    const pool = makePool([{ rows: [] }]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    await request(app).get('/api/tickets?priority=critical');

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/priority_id/);
  });

  test('filters by assignee=me', async () => {
    const pool = makePool([{ rows: [] }]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    await request(app).get('/api/tickets?assignee=me');

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/assignee_id/);
  });

  test('filters by assignee=unassigned adds IS NULL clause', async () => {
    const pool = makePool([{ rows: [] }]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    await request(app).get('/api/tickets?assignee=unassigned');

    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/assignee_id IS NULL/);
  });

  test('full-text search adds ILIKE clause', async () => {
    const pool = makePool([{ rows: [] }]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    await request(app).get('/api/tickets?q=printer');

    const sql    = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toMatch(/ILIKE/);
    expect(params).toContain('%printer%');
  });

  test('respects limit param', async () => {
    const pool = makePool([{ rows: [] }]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    await request(app).get('/api/tickets?limit=25');

    const params = pool.query.mock.calls[0][1];
    expect(params).toContain(25);
  });

  test('returns 500 on DB error', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('DB down')), on: jest.fn() };
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app).get('/api/tickets');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/DB down/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/tickets/:id
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/tickets/:id', () => {
  test('returns ticket with comments and activity for an agent', async () => {
    const pool = makePool([
      { rows: [TICKET_ROW] },              // main ticket query
      { rows: [COMMENT_ROW] },             // comments
      { rows: [] },                        // activity
    ]);
    const app = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app).get('/api/tickets/1');

    expect(res.status).toBe(200);
    expect(res.body.ticket.ticket_number).toBe('YAH-000001');
    expect(res.body.ticket.comments).toHaveLength(1);
    expect(res.body.ticket.activity).toHaveLength(0);
  });

  test('returns 404 when ticket does not exist', async () => {
    const pool = makePool([{ rows: [] }]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app).get('/api/tickets/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('staff can view their own ticket', async () => {
    const pool = makePool([
      { rows: [{ ...TICKET_ROW, requester_id: 10 }] },
      { rows: [] }, { rows: [] },
    ]);
    const app = buildApp(pool, makeStaffAuth({ id: 10 }), makeHelpers());

    const res = await request(app).get('/api/tickets/1');
    expect(res.status).toBe(200);
  });

  test('staff cannot view another staff member\'s ticket', async () => {
    // TICKET_ROW has requester_id: 10, but this user is id: 55
    const pool = makePool([{ rows: [TICKET_ROW] }]);
    const app  = buildApp(pool, makeStaffAuth({ id: 55 }), makeHelpers());

    const res = await request(app).get('/api/tickets/1');
    expect(res.status).toBe(403);
  });

  test('returns 500 on DB error', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('timeout')), on: jest.fn() };
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app).get('/api/tickets/1');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/tickets
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/tickets', () => {
  test('creates a ticket and returns id + ticket_number', async () => {
    const pool = makePool([
      { rows: [{ id: 1 }] },   // INSERT ticket RETURNING id
      { rows: [] },             // INSERT activity
    ]);
    const helpers = makeHelpers();
    const app = buildApp(pool, makeAuth(), helpers);

    const res = await request(app)
      .post('/api/tickets')
      .send({ title: 'Broken monitor', description: 'Screen flickering', priority_id: 'high' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    expect(res.body.ticket_number).toBe('YAH-000001');
  });

  test('rejects missing title with 400', async () => {
    const pool = makePool([]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app).post('/api/tickets').send({ description: 'No title here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title required/i);
  });

  test('rejects blank title with 400', async () => {
    const pool = makePool([]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app).post('/api/tickets').send({ title: '   ' });
    expect(res.status).toBe(400);
  });

  test('calls slaHoursFor with the given priority', async () => {
    const pool = makePool([{ rows: [{ id: 2 }] }, { rows: [] }]);
    const helpers = makeHelpers();
    const app = buildApp(pool, makeAuth(), helpers);

    await request(app).post('/api/tickets').send({ title: 'Critical issue', priority_id: 'critical' });

    expect(helpers.slaHoursFor).toHaveBeenCalledWith('critical');
  });

  test('defaults to medium priority when not specified', async () => {
    const pool = makePool([{ rows: [{ id: 3 }] }, { rows: [] }]);
    const helpers = makeHelpers();
    const app = buildApp(pool, makeAuth(), helpers);

    await request(app).post('/api/tickets').send({ title: 'Generic issue' });

    expect(helpers.slaHoursFor).toHaveBeenCalledWith('medium');
  });

  test('calls queueEmail after creation', async () => {
    const pool = makePool([{ rows: [{ id: 4 }] }, { rows: [] }]);
    const helpers = makeHelpers();
    const app = buildApp(pool, makeAuth(), helpers);

    await request(app).post('/api/tickets').send({ title: 'Email test ticket' });

    expect(helpers.queueEmail).toHaveBeenCalledTimes(1);
    const [, emailArgs] = helpers.queueEmail.mock.calls[0];
    expect(emailArgs.to).toBe('agent@test.com');
    expect(emailArgs.subject).toMatch(/YAH-000001/);
  });

  test('calls sendPushToUser after creation', async () => {
    const pool = makePool([{ rows: [{ id: 5 }] }, { rows: [] }]);
    const helpers = makeHelpers();
    const app = buildApp(pool, makeAuth(), helpers);

    await request(app).post('/api/tickets').send({ title: 'Push test ticket' });

    expect(helpers.sendPushToUser).toHaveBeenCalledTimes(1);
    const [, userId] = helpers.sendPushToUser.mock.calls[0];
    expect(userId).toBe(20); // auth user id
  });

  test('notifies assignee by email + push when assignee_id provided', async () => {
    const ASSIGNEE_ID = 99;
    const pool = makePool([
      { rows: [{ id: 7 }] },                              // INSERT ticket
      { rows: [] },                                        // INSERT activity
      { rows: [{ name: 'Carol Agent', email: 'carol@test.com' }] }, // SELECT assignee user
    ]);
    const helpers = makeHelpers();
    const auth = makeAuth({ id: 20, email: 'agent@test.com', name: 'Bob Agent', role: 'agent', site: 'Sydney' });
    const app = buildApp(pool, auth, helpers);

    await request(app)
      .post('/api/tickets')
      .send({ title: 'Assign on create', priority_id: 'high', assignee_id: ASSIGNEE_ID });

    // Should have emailed both requester (index 0) and assignee (index 1)
    expect(helpers.queueEmail).toHaveBeenCalledTimes(2);
    const assigneeEmail = helpers.queueEmail.mock.calls[1][1];
    expect(assigneeEmail.to).toBe('carol@test.com');
    expect(assigneeEmail.subject).toMatch(/assigned to you/i);
    expect(assigneeEmail.eventName).toBe('TicketAssigned');

    // Should have pushed to both requester and assignee
    expect(helpers.sendPushToUser).toHaveBeenCalledTimes(2);
    const [, pushedToId] = helpers.sendPushToUser.mock.calls[1];
    expect(pushedToId).toBe(ASSIGNEE_ID);
  });

  test('does NOT notify assignee when assignee_id equals requester', async () => {
    const pool = makePool([
      { rows: [{ id: 8 }] },  // INSERT ticket
      { rows: [] },            // INSERT activity
      // no assignee lookup query expected
    ]);
    const helpers = makeHelpers();
    // assignee_id === req.user.id (20)
    const app = buildApp(pool, makeAuth(), helpers);

    await request(app)
      .post('/api/tickets')
      .send({ title: 'Self-assigned', assignee_id: 20 });

    // Only requester notification, no second call
    expect(helpers.queueEmail).toHaveBeenCalledTimes(1);
    expect(helpers.sendPushToUser).toHaveBeenCalledTimes(1);
  });

  test('returns 500 on DB error', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('insert failed')), on: jest.fn() };
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app).post('/api/tickets').send({ title: 'Will fail' });
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/tickets/:id
// ═══════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/tickets/:id', () => {
  test('agent can update status_id', async () => {
    const pool = makePool([
      { rows: [TICKET_ROW] },   // SELECT current
      { rows: [] },             // UPDATE tickets
      { rows: [] },             // INSERT activity
    ]);
    const app = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app)
      .patch('/api/tickets/1')
      .send({ status_id: 'in_progress' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('returns 404 when ticket not found', async () => {
    const pool = makePool([{ rows: [] }]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app).patch('/api/tickets/999').send({ status_id: 'resolved' });
    expect(res.status).toBe(404);
  });

  test('staff can update title and description', async () => {
    const staffTicket = { ...TICKET_ROW, requester_id: 10 };
    const pool = makePool([
      { rows: [staffTicket] },
      { rows: [] },
      { rows: [] },
    ]);
    const app = buildApp(pool, makeStaffAuth({ id: 10 }), makeHelpers());

    const res = await request(app)
      .patch('/api/tickets/1')
      .send({ title: 'Updated title' });

    expect(res.status).toBe(200);
  });

  test('staff cannot update status_id (not in allowed list)', async () => {
    const staffTicket = { ...TICKET_ROW, requester_id: 10 };
    // Only title/description are updated; status_id is silently ignored for staff
    const pool = makePool([
      { rows: [staffTicket] },
      // no UPDATE query expected since status_id isn't in allowed fields
    ]);
    const app = buildApp(pool, makeStaffAuth({ id: 10 }), makeHelpers());

    // Sending only status_id — nothing in allowed list changes → no-op → ok:true
    const res = await request(app)
      .patch('/api/tickets/1')
      .send({ status_id: 'resolved' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Verify no UPDATE was issued
    const updateCalls = pool.query.mock.calls.filter(c => c[0].toString().includes('UPDATE'));
    expect(updateCalls).toHaveLength(0);
  });

  test('staff forbidden from updating another staff member\'s ticket', async () => {
    const pool = makePool([{ rows: [TICKET_ROW] }]); // requester_id: 10
    const app  = buildApp(pool, makeStaffAuth({ id: 55 }), makeHelpers());

    const res = await request(app).patch('/api/tickets/1').send({ title: 'Hijack' });
    expect(res.status).toBe(403);
  });

  test('returns ok:true immediately when nothing changes', async () => {
    // Send the same values that are already on the ticket → no update needed
    const pool = makePool([{ rows: [TICKET_ROW] }]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app)
      .patch('/api/tickets/1')
      .send({ title: TICKET_ROW.title }); // same title → no diff

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const updateCalls = pool.query.mock.calls.filter(c => String(c[0]).includes('UPDATE'));
    expect(updateCalls).toHaveLength(0);
  });

  test('setting status_id to resolved also sets resolved_at', async () => {
    const pool = makePool([
      { rows: [{ ...TICKET_ROW, status_id: 'in_progress' }] },
      { rows: [] }, { rows: [] },
    ]);
    const app = buildApp(pool, makeAuth(), makeHelpers());

    await request(app).patch('/api/tickets/1').send({ status_id: 'resolved' });

    const updateSql = pool.query.mock.calls.find(c => String(c[0]).includes('UPDATE yc_tkt_mgmt.tickets'));
    expect(updateSql[0]).toMatch(/resolved_at/);
  });

  test('setting status_id to closed also sets closed_at', async () => {
    const pool = makePool([
      { rows: [{ ...TICKET_ROW, status_id: 'in_progress' }] },
      { rows: [] }, { rows: [] },
    ]);
    const app = buildApp(pool, makeAuth(), makeHelpers());

    await request(app).patch('/api/tickets/1').send({ status_id: 'closed' });

    const updateSql = pool.query.mock.calls.find(c => String(c[0]).includes('UPDATE yc_tkt_mgmt.tickets'));
    expect(updateSql[0]).toMatch(/closed_at/);
  });

  test('notifies new assignee by email + push when assignee_id changes', async () => {
    const NEW_ASSIGNEE_ID = 77;
    // Current ticket has no assignee (null)
    const pool = makePool([
      { rows: [{ ...TICKET_ROW, assignee_id: null }] },       // SELECT current
      { rows: [] },                                            // UPDATE tickets
      { rows: [] },                                            // INSERT activity
      { rows: [{ name: 'Dave Agent', email: 'dave@test.com' }] }, // SELECT assignee user
    ]);
    const helpers = makeHelpers();
    const app = buildApp(pool, makeAuth(), helpers);

    const res = await request(app)
      .patch('/api/tickets/1')
      .send({ assignee_id: NEW_ASSIGNEE_ID });

    expect(res.status).toBe(200);
    expect(helpers.queueEmail).toHaveBeenCalledTimes(1);
    const emailCall = helpers.queueEmail.mock.calls[0][1];
    expect(emailCall.to).toBe('dave@test.com');
    expect(emailCall.subject).toMatch(/assigned to you/i);
    expect(emailCall.eventName).toBe('TicketAssigned');
    expect(helpers.sendPushToUser).toHaveBeenCalledTimes(1);
    const [, pushedToId] = helpers.sendPushToUser.mock.calls[0];
    expect(pushedToId).toBe(NEW_ASSIGNEE_ID);
  });

  test('does NOT notify when assignee_id is unchanged', async () => {
    const SAME_ASSIGNEE = 77;
    // Ticket already has this assignee — value hasn't changed
    const pool = makePool([
      { rows: [{ ...TICKET_ROW, assignee_id: SAME_ASSIGNEE }] }, // SELECT current
      // no UPDATE expected (nothing differs), route returns ok:true early
    ]);
    const helpers = makeHelpers();
    const app = buildApp(pool, makeAuth(), helpers);

    const res = await request(app)
      .patch('/api/tickets/1')
      .send({ assignee_id: SAME_ASSIGNEE });

    expect(res.status).toBe(200);
    expect(helpers.queueEmail).not.toHaveBeenCalled();
    expect(helpers.sendPushToUser).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/tickets/:id/comments
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/tickets/:id/comments', () => {
  test('adds a comment and returns it', async () => {
    const pool = makePool([
      { rows: [TICKET_ROW] },       // SELECT ticket
      { rows: [COMMENT_ROW] },      // INSERT comment
      { rows: [] },                 // UPDATE updated_at
      { rows: [] },                 // INSERT activity
    ]);
    const app = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app)
      .post('/api/tickets/1/comments')
      .send({ body: 'Looking into this now' });

    expect(res.status).toBe(201);
    expect(res.body.comment.body).toBe('Looking into this now');
  });

  test('trims whitespace from comment body', async () => {
    const pool = makePool([
      { rows: [TICKET_ROW] },
      { rows: [{ ...COMMENT_ROW, body: 'Trimmed' }] },
      { rows: [] }, { rows: [] },
    ]);
    const app = buildApp(pool, makeAuth(), makeHelpers());

    await request(app)
      .post('/api/tickets/1/comments')
      .send({ body: '   Trimmed   ' });

    const insertCall = pool.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO yc_tkt_mgmt.comments'));
    expect(insertCall[1][2]).toBe('Trimmed');
  });

  test('rejects missing body with 400', async () => {
    const pool = makePool([]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app).post('/api/tickets/1/comments').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/body required/i);
  });

  test('rejects blank body with 400', async () => {
    const pool = makePool([]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app).post('/api/tickets/1/comments').send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when ticket does not exist', async () => {
    const pool = makePool([{ rows: [] }]);
    const app  = buildApp(pool, makeAuth(), makeHelpers());

    const res = await request(app)
      .post('/api/tickets/999/comments')
      .send({ body: 'Ghost comment' });

    expect(res.status).toBe(404);
  });

  test('staff cannot comment on another staff member\'s ticket', async () => {
    const pool = makePool([{ rows: [TICKET_ROW] }]); // requester_id: 10
    const app  = buildApp(pool, makeStaffAuth({ id: 55 }), makeHelpers());

    const res = await request(app)
      .post('/api/tickets/1/comments')
      .send({ body: 'Unauthorised comment' });

    expect(res.status).toBe(403);
  });

  test('staff can comment on their own ticket', async () => {
    const pool = makePool([
      { rows: [{ ...TICKET_ROW, requester_id: 10 }] },
      { rows: [COMMENT_ROW] },
      { rows: [] }, { rows: [] },
    ]);
    const app = buildApp(pool, makeStaffAuth({ id: 10 }), makeHelpers());

    const res = await request(app)
      .post('/api/tickets/1/comments')
      .send({ body: 'My own comment' });

    expect(res.status).toBe(201);
  });

  test('is_internal flag is stored correctly', async () => {
    const pool = makePool([
      { rows: [TICKET_ROW] },
      { rows: [{ ...COMMENT_ROW, is_internal: true }] },
      { rows: [] }, { rows: [] },
    ]);
    const app = buildApp(pool, makeAuth(), makeHelpers());

    await request(app)
      .post('/api/tickets/1/comments')
      .send({ body: 'Internal note', is_internal: true });

    const insertCall = pool.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO yc_tkt_mgmt.comments'));
    expect(insertCall[1][3]).toBe(true);
  });
});
