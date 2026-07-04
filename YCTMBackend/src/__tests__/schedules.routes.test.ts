// Tests for the schedules router — role enforcement, CRUD validation
import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPool = pool as any;

function makeApp(role = 'super_admin', userId = 1) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { userId, email: 'test@yahwehcare.com.au', role, sessionId: 1, isAdmin: true, bootstrapAdmin: true, permissions: [] };
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const schedulesRouter = require('../modules/schedules/schedules.routes').default;
  app.use('/schedules', schedulesRouter);
  return app;
}

const dbScheduleRow = {
  id: 1,
  name: 'Weekly Activity',
  description: 'last_30',
  frequency: 'weekly',
  day_of_week: 'Monday',
  day_of_month: null,
  time_of_day: '08:00',
  report_types: ['activity_log'],
  recipient_ids: [2],
  active: true,
  sent_count: 0,
  last_sent_at: null,
  created_by: 1,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

// ── Role enforcement ──────────────────────────────────────────────────────────

describe('GET /schedules — role enforcement', () => {
  it('returns 403 for staff role', async () => {
    const app = makeApp('staff');
    const res = await request(app).get('/schedules');
    expect(res.status).toBe(403);
  });

  it('returns schedules for super_admin', async () => {
    const app = makeApp('super_admin');
    mockPool.query.mockResolvedValueOnce({ rows: [dbScheduleRow], rowCount: 1 } as any);
    const res = await request(app).get('/schedules');
    expect(res.status).toBe(200);
    expect(res.body.schedules).toHaveLength(1);
  });

  it('returns schedules for manager', async () => {
    const app = makeApp('manager');
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).get('/schedules');
    expect(res.status).toBe(200);
  });

  it('returns schedules for director (newly allowed)', async () => {
    const app = makeApp('director');
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).get('/schedules');
    expect(res.status).toBe(200);
  });
});

// ── POST /schedules — validation ──────────────────────────────────────────────

describe('POST /schedules — validation', () => {
  let app: express.Application;
  beforeAll(() => { app = makeApp('super_admin'); });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/schedules').send({ frequency: 'weekly', time: '08:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when frequency is missing', async () => {
    const res = await request(app).post('/schedules').send({ name: 'Test', time: '08:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 when time is missing', async () => {
    const res = await request(app).post('/schedules').send({ name: 'Test', frequency: 'weekly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_fields');
  });

  it('returns 400 for invalid frequency value', async () => {
    const res = await request(app).post('/schedules').send({
      name: 'Test', frequency: 'fortnightly', time: '08:00',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_frequency');
  });

  it('creates schedule for valid payload', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ...dbScheduleRow, id: 2 }], rowCount: 1 } as any)  // INSERT
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);  // audit log
    const res = await request(app).post('/schedules').send({
      name: 'Weekly Activity',
      frequency: 'weekly',
      time: '08:00',
      day_of_week: 'Monday',
      report_types: ['activity_log'],
      recipient_ids: [2],
    });
    expect(res.status).toBe(201);
    expect(res.body.schedule).toBeDefined();
    expect(res.body.schedule.name).toBe('Weekly Activity');
  });

  it('daily frequency is accepted', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ...dbScheduleRow, frequency: 'daily' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).post('/schedules').send({
      name: 'Daily Report', frequency: 'daily', time: '07:00',
    });
    expect(res.status).toBe(201);
    expect(res.body.schedule.frequency).toBe('daily');
  });

  it('monthly frequency is accepted', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ...dbScheduleRow, frequency: 'monthly' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).post('/schedules').send({
      name: 'Monthly Report', frequency: 'monthly', time: '09:00',
    });
    expect(res.status).toBe(201);
  });
});

// ── dbToFrontend shape ────────────────────────────────────────────────────────

describe('GET /schedules — dbToFrontend shape', () => {
  it('maps DB row to expected frontend fields', async () => {
    const app = makeApp('super_admin');
    mockPool.query.mockResolvedValueOnce({ rows: [dbScheduleRow], rowCount: 1 } as any);
    const res = await request(app).get('/schedules');
    const s = res.body.schedules[0];

    expect(typeof s.id).toBe('string');        // id is string-ified
    expect(s.name).toBe('Weekly Activity');
    expect(s.frequency).toBe('weekly');
    expect(s.dayOfWeek).toBe('Monday');        // camelCase field
    expect(s.time).toBe('08:00');              // mapped from time_of_day
    expect(Array.isArray(s.reportTypes)).toBe(true);
    expect(Array.isArray(s.recipientIds)).toBe(true);
    expect(s.recipientIds[0]).toBe('2');       // recipientIds stringified
    expect(typeof s.active).toBe('boolean');
    expect(typeof s.sentCount).toBe('number');
  });
});

// ── DELETE /schedules/:id ─────────────────────────────────────────────────────

describe('DELETE /schedules/:id', () => {
  it('returns 404 for non-existent schedule', async () => {
    const app = makeApp('super_admin');
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).delete('/schedules/999');
    expect(res.status).toBe(404);
  });

  it('returns 403 if manager tries to delete another user\'s schedule', async () => {
    const app = makeApp('manager', 99); // manager with userId=99
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...dbScheduleRow, created_by: 1 }], rowCount: 1, // schedule owned by user 1
    } as any);
    const res = await request(app).delete('/schedules/1');
    expect(res.status).toBe(403);
  });

  it('super_admin can delete any schedule', async () => {
    const app = makeApp('super_admin', 99);
    mockPool.query
      .mockResolvedValueOnce({ rows: [dbScheduleRow], rowCount: 1 } as any) // SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)              // DELETE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);             // audit
    const res = await request(app).delete('/schedules/1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── PATCH /schedules/:id ──────────────────────────────────────────────────────

describe('PATCH /schedules/:id', () => {
  it('returns 404 for non-existent schedule', async () => {
    const app = makeApp('super_admin');
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).patch('/schedules/999').send({ active: false });
    expect(res.status).toBe(404);
  });

  it('toggles active flag successfully', async () => {
    const app = makeApp('super_admin');
    const updated = { ...dbScheduleRow, active: false };
    mockPool.query
      .mockResolvedValueOnce({ rows: [dbScheduleRow], rowCount: 1 } as any)  // SELECT existing
      .mockResolvedValueOnce({ rows: [updated], rowCount: 1 } as any)        // UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);              // audit
    const res = await request(app).patch('/schedules/1').send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.schedule.active).toBe(false);
  });

  it('returns current schedule when body is empty (no fields to update)', async () => {
    const app = makeApp('super_admin');
    mockPool.query.mockResolvedValueOnce({ rows: [dbScheduleRow], rowCount: 1 } as any);
    const res = await request(app).patch('/schedules/1').send({});
    expect(res.status).toBe(200);
  });
});
