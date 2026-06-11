// ============================================================
// Tests for /users routes
// Covers: GET (list, filters), POST (create), PATCH (update),
//         DELETE (soft-delete), bootstrap-admin guards
// ============================================================

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

const mockPool = pool as any;

function makeApp(role = 'super_admin', userId = 1) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { userId, email: 'admin@yahwehcare.com.au', role, sessionId: 1, isAdmin: true, bootstrapAdmin: false, permissions: [] };
    next();
  });
  const router = require('../modules/users/users.routes').default;
  app.use('/users', router);
  return app;
}

// ── GET /users ────────────────────────────────────────────────────────────────

describe('GET /users', () => {
  const userRows = [
    { id: 1, email: 'alice@yahwehcare.com.au', name: 'Alice Smith', is_active: true, department_id: 1, position_id: null, created_at: new Date().toISOString(), is_bootstrap_admin: false, department_name: 'IT', positions: [] },
    { id: 2, email: 'bob@yahwehcare.com.au',   name: 'Bob Jones',   is_active: true, department_id: 2, position_id: null, created_at: new Date().toISOString(), is_bootstrap_admin: false, department_name: 'HR',  positions: [] },
  ];

  it('returns users array with status 200', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: userRows });
    const res = await request(app).get('/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users).toHaveLength(2);
  });

  it('each user has active field mapped from is_active', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: userRows });
    const res = await request(app).get('/users');
    expect(res.body.users[0].active).toBe(true);
  });

  it('returns empty array when no users exist', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/users');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(0);
  });

  it('returns total equal to users length', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: userRows });
    const res = await request(app).get('/users');
    expect(res.body.total).toBe(2);
  });
});

// ── POST /users ───────────────────────────────────────────────────────────────

describe('POST /users — create', () => {
  const newUserRow = { id: 10, email: 'new@yahwehcare.com.au', name: 'New User', is_active: true, position_id: null, department_id: 1, manager_id: null, employment_type: 'full_time', auth_provider: 'azure_ad', avatar_initials: 'NU' };

  it('returns 400 when email is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/users').send({ name: 'No Email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when name is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/users').send({ email: 'test@yahwehcare.com.au' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 for invalid email domain', async () => {
    const app = makeApp();
    const res = await request(app).post('/users').send({ email: 'user@gmail.com', name: 'Gmail User' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_email_domain');
  });

  it('creates user successfully and returns 201', async () => {
    const app = makeApp();
    mockPool.query
      .mockResolvedValueOnce({ rows: [newUserRow] })  // INSERT user
      .mockResolvedValueOnce({ rows: [] })             // audit INSERT (logAudit)
      .mockResolvedValueOnce({ rows: [] });            // notify (ensurePushTable etc) - ignored
    const res = await request(app).post('/users').send({ email: 'new@yahwehcare.com.au', name: 'New User', department_id: 1 });
    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('new@yahwehcare.com.au');
  });

  it('returns 409 on duplicate email', async () => {
    const app = makeApp();
    mockPool.query.mockRejectedValueOnce({ code: '23505' });
    const res = await request(app).post('/users').send({ email: 'dupe@yahwehcare.com.au', name: 'Dupe User' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('duplicate_email');
  });
});

// ── PATCH /users/:id ──────────────────────────────────────────────────────────

describe('PATCH /users/:id — update', () => {
  const existingUser = { id: 5, name: 'Old Name', email: 'old@yahwehcare.com.au', is_active: true, is_bootstrap_admin: false, department_id: 1, position_id: null };
  const updatedUser  = { ...existingUser, name: 'New Name', is_bootstrap_admin: false };

  it('returns 404 when user does not exist', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // SELECT user
    const res = await request(app).patch('/users/999').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('updates user name successfully', async () => {
    const app = makeApp();
    mockPool.query
      .mockResolvedValueOnce({ rows: [existingUser] })  // SELECT existing
      .mockResolvedValueOnce({ rows: [] })               // UPDATE
      .mockResolvedValueOnce({ rows: [updatedUser] })    // SELECT updated
      .mockResolvedValueOnce({ rows: [] });              // logAudit
    const res = await request(app).patch('/users/5').send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
  });

  it('returns 403 when trying to deactivate a bootstrap admin', async () => {
    const app = makeApp();
    const bootstrapUser = { ...existingUser, is_bootstrap_admin: true };
    mockPool.query.mockResolvedValueOnce({ rows: [bootstrapUser] });
    const res = await request(app).patch('/users/5').send({ is_active: false });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('bootstrap_admin_deactivate_blocked');
  });

  it('returns 400 when changing email to invalid domain', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [existingUser] });
    const res = await request(app).patch('/users/5').send({ email: 'hacker@gmail.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_email_domain');
  });
});

// ── DELETE /users/:id ─────────────────────────────────────────────────────────

describe('DELETE /users/:id — soft delete', () => {
  it('returns 404 when user does not exist', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/users/999');
    expect(res.status).toBe(404);
  });

  it('returns 403 when trying to delete a bootstrap admin', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1, is_bootstrap_admin: true, name: 'Admin' }] });
    const res = await request(app).delete('/users/1');
    expect(res.status).toBe(403);
  });
});
