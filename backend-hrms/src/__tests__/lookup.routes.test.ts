// ============================================================
// Tests for /lookup routes
// Covers: GET /all, /categories, /priorities, /statuses
// These are public read-only reference endpoints — no auth required.
// ============================================================

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

const mockPool = pool as any;

function makeApp() {
  const app = express();
  app.use(express.json());
  const router = require('../modules/lookup/lookup.routes').default;
  app.use('/lookup', router);
  return app;
}

const catRows = [
  { id: 1, label: 'General Enquiry', icon: '📋', sort_order: 1 },
  { id: 2, label: 'IT Support',      icon: '💻', sort_order: 2 },
];
const priRows = [
  { id: 1, label: 'Low',      sla_hours: 72, sort_order: 1 },
  { id: 2, label: 'Medium',   sla_hours: 48, sort_order: 2 },
  { id: 3, label: 'High',     sla_hours: 24, sort_order: 3 },
  { id: 4, label: 'Critical', sla_hours: 4,  sort_order: 4 },
];
const statRows = [
  { id: 'open',    label: 'Open',     sort_order: 1 },
  { id: 'closed',  label: 'Closed',   sort_order: 6 },
];

// ── GET /lookup/all ───────────────────────────────────────────────────────────

describe('GET /lookup/all', () => {
  it('returns categories, priorities and statuses', async () => {
    const app = makeApp();
    mockPool.query
      .mockResolvedValueOnce({ rows: catRows })   // categories
      .mockResolvedValueOnce({ rows: priRows })   // priorities
      .mockResolvedValueOnce({ rows: statRows }); // statuses
    const res = await request(app).get('/lookup/all');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(Array.isArray(res.body.priorities)).toBe(true);
    expect(Array.isArray(res.body.statuses)).toBe(true);
  });

  it('returns correct number of categories', async () => {
    const app = makeApp();
    mockPool.query
      .mockResolvedValueOnce({ rows: catRows })
      .mockResolvedValueOnce({ rows: priRows })
      .mockResolvedValueOnce({ rows: statRows });
    const res = await request(app).get('/lookup/all');
    expect(res.body.categories).toHaveLength(2);
    expect(res.body.priorities).toHaveLength(4);
  });

  it('degrades gracefully when statuses table errors — returns empty statuses array', async () => {
    const app = makeApp();
    mockPool.query
      .mockResolvedValueOnce({ rows: catRows })
      .mockResolvedValueOnce({ rows: priRows })
      .mockRejectedValueOnce(new Error('statuses table missing'));
    const res = await request(app).get('/lookup/all');
    expect(res.status).toBe(200);
    expect(res.body.statuses).toEqual([]);
  });
});

// ── GET /lookup/categories ────────────────────────────────────────────────────

describe('GET /lookup/categories', () => {
  it('returns categories array', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: catRows });
    const res = await request(app).get('/lookup/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toHaveLength(2);
    expect(res.body.categories[0].label).toBe('General Enquiry');
  });

  it('returns empty array when no categories exist', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/lookup/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toHaveLength(0);
  });
});

// ── GET /lookup/priorities ────────────────────────────────────────────────────

describe('GET /lookup/priorities', () => {
  it('returns priorities with sla_hours', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: priRows });
    const res = await request(app).get('/lookup/priorities');
    expect(res.status).toBe(200);
    expect(res.body.priorities).toHaveLength(4);
    expect(res.body.priorities[3].label).toBe('Critical');
    expect(res.body.priorities[3].sla_hours).toBe(4);
  });
});

// ── GET /lookup/statuses ──────────────────────────────────────────────────────

describe('GET /lookup/statuses', () => {
  it('returns statuses array', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: statRows });
    const res = await request(app).get('/lookup/statuses');
    expect(res.status).toBe(200);
    expect(res.body.statuses).toHaveLength(2);
  });
});
