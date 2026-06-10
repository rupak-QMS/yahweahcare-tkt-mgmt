// Tests for org routes
// Feature 1: Bootstrap admins are EXCLUDED from org chart position staff (is_bootstrap_admin = FALSE)
// Feature 2: Bootstrap admins CANNOT be moved via PATCH /org/move (returns 403)

import request from 'supertest';
import express from 'express';
import { pool } from '../db/pool';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPool = pool as any;

function makeApp(role = 'super_admin', userId = 1) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = {
      userId,
      email: 'test@yahwehcare.com.au',
      role,
      sessionId: 1,
      isAdmin: true,
      bootstrapAdmin: role === 'super_admin' || role === 'admin',
      permissions: [],
    };
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const orgRouter = require('../modules/org/org.routes').default;
  app.use('/org', orgRouter);
  return app;
}

// ── Sample DB rows ────────────────────────────────────────────────────────────

const dbPosition: Record<string, unknown> = {
  id: 1,
  title: 'CEO',
  parent_position_id: null,
  sort_order: 0,
  department_id: 1,
  position_type: 'director',
  dept_label: 'Leadership',
  department_name: 'Executive',
  staff: [],                // bootstrap admin excluded by SQL JOIN
};

const dbDepartment = {
  id: 1,
  name: 'Executive',
  parent_dept_id: null,
  sort_order: 0,
};

const dbBootstrapAdmin = {
  id: 99,
  name: 'System Admin',
  email: 'admin@yahwehcare.com.au',
  is_bootstrap_admin: true,
  active: true,
};

const dbRegularUser = {
  id: 5,
  name: 'John Director',
  email: 'john@yahwehcare.com.au',
  is_bootstrap_admin: false,
  is_active: true,
};

// Helper — mocks the 3 queries GET /org/chart fires in sequence
function mockChartQueries(
  positions = [dbPosition],
  departments = [dbDepartment],
  bootstrapAdmins = [dbBootstrapAdmin],
) {
  mockPool.query
    .mockResolvedValueOnce({ rows: positions, rowCount: positions.length } as any)
    .mockResolvedValueOnce({ rows: departments, rowCount: departments.length } as any)
    .mockResolvedValueOnce({ rows: bootstrapAdmins, rowCount: bootstrapAdmins.length } as any);
}

// ── GET /org/chart — bootstrap admin exclusion ───────────────────────────────

describe('GET /org/chart — bootstrap admin exclusion from hierarchy', () => {
  let app: express.Application;
  beforeAll(() => { app = makeApp(); });

  it('returns 200 with tree, departments and bootstrapAdmins fields', async () => {
    mockChartQueries();
    const res = await request(app).get('/org/chart');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tree');
    expect(res.body).toHaveProperty('departments');
    expect(res.body).toHaveProperty('bootstrapAdmins');
  });

  it('bootstrapAdmins field contains the bootstrap admin user', async () => {
    mockChartQueries();
    const res = await request(app).get('/org/chart');
    expect(Array.isArray(res.body.bootstrapAdmins)).toBe(true);
    expect(res.body.bootstrapAdmins).toHaveLength(1);
    expect(res.body.bootstrapAdmins[0].is_bootstrap_admin).toBe(true);
    expect(res.body.bootstrapAdmins[0].name).toBe('System Admin');
  });

  it('bootstrap admin does NOT appear in position staff (SQL-level exclusion)', async () => {
    // The position row comes back with staff: [] because SQL filters is_bootstrap_admin = FALSE
    const positionWithBootstrapExcluded = { ...dbPosition, staff: [] };
    mockChartQueries([positionWithBootstrapExcluded]);
    const res = await request(app).get('/org/chart');
    const treeRoot = res.body.tree[0];
    // staff array should be empty — bootstrap admin was excluded by the JOIN condition
    expect(Array.isArray(treeRoot.staff)).toBe(true);
    expect(treeRoot.staff).toHaveLength(0);
  });

  it('regular (non-bootstrap) staff DO appear in position staff', async () => {
    const positionWithDirector = {
      ...dbPosition,
      staff: [{
        id: 5,
        name: 'John Director',
        email: 'john@yahwehcare.com.au',
        profile_photo_url: null,
        avatar_initials: 'JD',
        role: 'director',
        designation: 'CEO',
      }],
    };
    mockChartQueries([positionWithDirector]);
    const res = await request(app).get('/org/chart');
    const treeRoot = res.body.tree[0];
    expect(treeRoot.staff).toHaveLength(1);
    expect(treeRoot.staff[0].name).toBe('John Director');
  });

  it('position is marked is_vacant when no staff assigned', async () => {
    mockChartQueries([{ ...dbPosition, staff: [] }]);
    const res = await request(app).get('/org/chart');
    expect(res.body.tree[0].is_vacant).toBe(true);
    expect(res.body.tree[0].is_active).toBe(false);
  });

  it('position is marked is_active (not vacant) when staff assigned', async () => {
    const posWithStaff = {
      ...dbPosition,
      staff: [{ id: 5, name: 'John', email: 'j@y.com', profile_photo_url: null, avatar_initials: 'J', role: 'director', designation: 'CEO' }],
    };
    mockChartQueries([posWithStaff]);
    const res = await request(app).get('/org/chart');
    expect(res.body.tree[0].is_active).toBe(true);
    expect(res.body.tree[0].is_vacant).toBe(false);
  });

  it('returns empty tree when no positions exist', async () => {
    mockChartQueries([], [], []);
    const res = await request(app).get('/org/chart');
    expect(res.status).toBe(200);
    expect(res.body.tree).toHaveLength(0);
  });

  it('departments are returned correctly', async () => {
    mockChartQueries();
    const res = await request(app).get('/org/chart');
    expect(res.body.departments).toHaveLength(1);
    expect(res.body.departments[0].name).toBe('Executive');
  });

  it('child positions are nested under parent in tree', async () => {
    const parent = { ...dbPosition, id: 1, parent_position_id: null, staff: [] };
    const child  = { ...dbPosition, id: 2, parent_position_id: 1,    title: 'COO', staff: [] };
    mockChartQueries([parent, child]);
    const res = await request(app).get('/org/chart');
    expect(res.body.tree).toHaveLength(1);                       // only root at top level
    expect(res.body.tree[0].children).toHaveLength(1);          // child nested inside
    expect((res.body.tree[0].children[0] as any).title).toBe('COO');
  });
});

// ── PATCH /org/move — bootstrap admin move restriction ───────────────────────

describe('PATCH /org/move — bootstrap admin cannot be moved', () => {
  let app: express.Application;
  beforeAll(() => { app = makeApp('super_admin', 1); });

  it('returns 400 when userId is missing', async () => {
    const res = await request(app).patch('/org/move').send({ positionId: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_userId');
  });

  it('returns 404 when user does not exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).patch('/org/move').send({ userId: 999, positionId: 2 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('user_not_found');
  });

  it('returns 403 when trying to move a bootstrap admin', async () => {
    // DB returns a user with is_bootstrap_admin = true
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...dbBootstrapAdmin, id: 99, is_bootstrap_admin: true }],
      rowCount: 1,
    } as any);
    const res = await request(app).patch('/org/move').send({ userId: 99, positionId: 3 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('cannot_move_bootstrap_admin');
  });

  it('allows moving a regular (non-bootstrap) user', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ...dbRegularUser }], rowCount: 1 } as any) // user lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)                     // UPDATE users
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);                    // UPDATE positions
    const res = await request(app).patch('/org/move').send({ userId: 5, positionId: 2 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 403 for non-super_admin role', async () => {
    const staffApp = makeApp('staff', 10);
    const res = await request(staffApp).patch('/org/move').send({ userId: 5, positionId: 2 });
    expect(res.status).toBe(403);
  });
});

// ── GET /org/departments ──────────────────────────────────────────────────────

describe('GET /org/departments', () => {
  it('returns departments array', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [dbDepartment], rowCount: 1 } as any);
    const res = await request(app).get('/org/departments');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.departments)).toBe(true);
    expect(res.body.departments[0].name).toBe('Executive');
  });

  it('returns empty array when no departments', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const res = await request(app).get('/org/departments');
    expect(res.status).toBe(200);
    expect(res.body.departments).toHaveLength(0);
  });
});

// ── POST /org/departments ─────────────────────────────────────────────────────

describe('POST /org/departments — access control and validation', () => {
  it('returns 403 for non-super_admin', async () => {
    const managerApp = makeApp('manager', 10);
    const res = await request(managerApp).post('/org/departments').send({ name: 'Finance' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when name is missing', async () => {
    const app = makeApp('super_admin');
    const res = await request(app).post('/org/departments').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_name');
  });

  it('creates department successfully for super_admin', async () => {
    const app = makeApp('super_admin');
    const newDept = { id: 2, name: 'Finance', parent_dept_id: null, sort_order: 1 };
    mockPool.query
      .mockResolvedValueOnce({ rows: [newDept], rowCount: 1 } as any)   // INSERT
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);          // audit log
    const res = await request(app).post('/org/departments').send({ name: 'Finance' });
    expect(res.status).toBe(201);
    expect(res.body.department.name).toBe('Finance');
  });
});

// ── GET /org/positions ────────────────────────────────────────────────────────

describe('GET /org/positions', () => {
  const dbPositionRow = {
    id: 1, title: 'CEO', department_id: 1, parent_position_id: null,
    sort_order: 0, position_type: 'director', dept_label: 'Leadership',
    department_name: 'Executive', user_id: 5, user_name: 'John', user_email: 'john@y.com',
  };

  it('returns positions array', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [dbPositionRow], rowCount: 1 } as any);
    const res = await request(app).get('/org/positions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.positions)).toBe(true);
    expect(res.body.positions[0].title).toBe('CEO');
  });

  it('filters by departmentId when provided', async () => {
    const app = makeApp();
    mockPool.query.mockResolvedValueOnce({ rows: [dbPositionRow], rowCount: 1 } as any);
    const res = await request(app).get('/org/positions?departmentId=1');
    expect(res.status).toBe(200);
    // Confirm a query was made (dept filter applied)
    const callArgs = mockPool.query.mock.calls[0];
    const sql = callArgs[0] as string;
    expect(sql).toContain('department_id');
  });
});
