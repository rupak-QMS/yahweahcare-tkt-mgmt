// Tests for requireAuth and optionalAuth middleware
import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';
import { signAccessToken } from '../utils/tokens';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPool = pool as any;

function makeApp() {
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireAuth, optionalAuth } = require('../middleware/auth.middleware');

  app.get('/protected', requireAuth, (req: any, res) => res.json({ auth: req.auth }));
  app.get('/optional',  optionalAuth, (req: any, res) => res.json({ auth: req.auth ?? null }));
  return app;
}

// Build a valid token + matching session mock
function validToken(role = 'staff', userId = 5, sessionId = 10) {
  const { token } = signAccessToken({
    sub:         String(userId),
    email:       'test@yahwehcare.com.au',
    role,
    permissions: [],
    sid:         String(sessionId),
  });
  // Pool returns a valid, non-revoked session
  mockPool.query.mockResolvedValue({
    rows: [{
      id:               sessionId,
      user_id:          userId,
      is_revoked:       false,
      expires_at:       new Date(Date.now() + 3_600_000).toISOString(),
      last_activity_at: new Date().toISOString(),
    }],
    rowCount: 1,
  } as any);
  return token;
}

describe('requireAuth middleware', () => {
  let app: express.Application;
  beforeAll(() => { app = makeApp(); });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a malformed Bearer token', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
  });

  it('returns 401 when session is revoked', async () => {
    const { token } = signAccessToken({
      sub: '5', email: 'x@y.com', role: 'staff', permissions: [], sid: '10',
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 10, user_id: 5, is_revoked: true,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        last_activity_at: new Date().toISOString(),
      }],
      rowCount: 1,
    } as any);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 when session is not found', async () => {
    const { token } = signAccessToken({
      sub: '5', email: 'x@y.com', role: 'staff', permissions: [], sid: '99',
    });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('passes with a valid Bearer token and populates req.auth', async () => {
    const token = validToken('manager', 7, 20);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.auth.userId).toBe(7);
    expect(res.body.auth.email).toBe('test@yahwehcare.com.au');
    expect(res.body.auth.role).toBe('manager');
  });

  it('isAdmin is true for manager role', async () => {
    const token = validToken('manager', 7, 20);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.body.auth.isAdmin).toBe(true);
  });

  it('isAdmin is false for staff role', async () => {
    const token = validToken('staff', 8, 21);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.body.auth.isAdmin).toBe(false);
  });

  it('bootstrapAdmin is true only for super_admin and admin roles', async () => {
    const token = validToken('super_admin', 1, 1);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.body.auth.bootstrapAdmin).toBe(true);
  });

  it('bootstrapAdmin is false for director role', async () => {
    const token = validToken('director', 3, 3);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.body.auth.bootstrapAdmin).toBe(false);
  });

  it('isBootstrapAdmin reflects the real users.is_bootstrap_admin DB column, not the role', async () => {
    // Even though this user has role 'staff' (bootstrapAdmin role-approximation would be false),
    // the DB says they ARE a real bootstrap admin (e.g. Ron / Alex) — isBootstrapAdmin must be true.
    const { token } = signAccessToken({
      sub: '1', email: 'ron@wmxsolutions.com.au', role: 'staff', permissions: [], sid: '30',
    });
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 30, user_id: 1, is_revoked: false,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          last_activity_at: new Date().toISOString(),
        }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [{ is_bootstrap_admin: true }], rowCount: 1 } as any)
      .mockResolvedValue({ rows: [] } as any); // catch-all for the fire-and-forget last_activity_at UPDATE
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.auth.isBootstrapAdmin).toBe(true);
    expect(res.body.auth.bootstrapAdmin).toBe(false); // role-based approximation stays false
  });

  it('isBootstrapAdmin defaults to false when the DB lookup fails', async () => {
    const { token } = signAccessToken({
      sub: '2', email: 'x@yahwehcare.com.au', role: 'staff', permissions: [], sid: '31',
    });
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 31, user_id: 2, is_revoked: false,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          last_activity_at: new Date().toISOString(),
        }],
        rowCount: 1,
      } as any)
      .mockRejectedValueOnce(new Error('column does not exist'))
      .mockResolvedValue({ rows: [] } as any); // catch-all for the fire-and-forget last_activity_at UPDATE
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.auth.isBootstrapAdmin).toBe(false);
  });

  it('director role is NOT marked as isAdmin by middleware', async () => {
    // Important: isManagerOrAdmin in schedules.routes.ts allows director,
    // but the middleware's isAdmin flag does NOT include director.
    // This is by design — director gets special access per-route, not globally.
    const token = validToken('director', 3, 3);
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.body.auth.isAdmin).toBe(false);
  });
});

describe('optionalAuth middleware', () => {
  let app: express.Application;
  beforeAll(() => { app = makeApp(); });

  it('sets auth to null when no token is provided (does not 401)', async () => {
    const res = await request(app).get('/optional');
    expect(res.status).toBe(200);
    expect(res.body.auth).toBeNull();
  });

  it('populates auth when valid token is provided', async () => {
    const token = validToken('staff', 5, 10);
    const res = await request(app).get('/optional').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.auth).not.toBeNull();
    expect(res.body.auth.userId).toBe(5);
  });
});
