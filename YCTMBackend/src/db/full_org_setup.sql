-- ============================================================
-- Yahweh Care — Full Org Setup (run in Neon SQL Editor)
-- ✅ Step 1: Clean up users to only org-chart members
-- ✅ Step 2: Create departments & positions tables
-- ✅ Step 3: Seed all departments + positions
-- ✅ Step 4: Assign users to positions, departments, managers
-- Safe to re-run — uses IF NOT EXISTS and ON CONFLICT DO NOTHING
-- ============================================================

SET search_path = yc_tkt_mgmt;

-- ── STEP 1: Keep only authorised users, delete the rest ──────
-- Emails authorised per org chart
DO $$
DECLARE
  authorised_emails TEXT[] := ARRAY[
    'alex@yahwehpc.com.au',
    'it@yahwehcare.com.au',
    'suganty@yahwehpc.com.au',
    'sunny@yahwehcare.com.au',
    'elenor@yahwehcare.com.au',
    'saloni@yahwehcare.com.au',
    'james@yahwehcare.com.au',
    'miejkyla@yahwehcare.com.au',
    'venujah@yahwehcare.com.au',
    'akila@yahwehcare.com.au'
  ];
BEGIN
  -- Nullify FK references first (tickets)
  UPDATE tickets SET requester_id = NULL WHERE requester_id IN (
    SELECT id FROM users WHERE email != ALL(authorised_emails)
  );
  UPDATE tickets SET assignee_id = NULL WHERE assignee_id IN (
    SELECT id FROM users WHERE email != ALL(authorised_emails)
  );
  -- Delete comments/activity by unauthorised users
  DELETE FROM comments  WHERE author_id IN (SELECT id FROM users WHERE email != ALL(authorised_emails));
  DELETE FROM activity  WHERE actor_id  IN (SELECT id FROM users WHERE email != ALL(authorised_emails));
  -- Delete unauthorised users
  DELETE FROM users WHERE email != ALL(authorised_emails);
  RAISE NOTICE 'Users cleaned — only org-chart members remain.';
END $$;

-- ── STEP 2: Create tables (safe — IF NOT EXISTS) ─────────────

CREATE TABLE IF NOT EXISTS departments (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  parent_dept_id INT  REFERENCES departments(id) ON DELETE SET NULL,
  sort_order     INT  NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS positions (
  id                 SERIAL PRIMARY KEY,
  title              TEXT NOT NULL,
  department_id      INT  REFERENCES departments(id) ON DELETE SET NULL,
  parent_position_id INT  REFERENCES positions(id)  ON DELETE SET NULL,
  is_active          BOOLEAN NOT NULL DEFAULT FALSE,
  is_vacant          BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order         INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add org columns to users (safe — IF NOT EXISTS)
ALTER TABLE users ADD COLUMN IF NOT EXISTS position_id      INT REFERENCES positions(id)   ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id       INT REFERENCES users(id)        ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id    INT REFERENCES departments(id)  ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bootstrap_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ── STEP 3: Seed departments ──────────────────────────────────
INSERT INTO departments (name, sort_order) VALUES
  ('Director Level',                                0),
  ('Operations',                                    1),
  ('Finance',                                       2),
  ('Strategic Development & Client Relations',      3)
ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order;

-- ── STEP 4: Clear old positions (re-seed cleanly) ─────────────
-- Nullify position references first
UPDATE users SET position_id = NULL;
DELETE FROM positions;

-- ── STEP 5: Seed positions in hierarchy order ─────────────────

-- Director (root)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Director',
       (SELECT id FROM departments WHERE name='Director Level'),
       NULL, TRUE, FALSE, 0;

-- Operations Manager (reports to Director)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Operations Manager',
       (SELECT id FROM departments WHERE name='Operations'),
       (SELECT id FROM positions WHERE title='Director'),
       TRUE, FALSE, 1;

-- Finance Manager (reports to Director)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Finance Manager',
       (SELECT id FROM departments WHERE name='Finance'),
       (SELECT id FROM positions WHERE title='Director'),
       TRUE, FALSE, 2;

-- Strategic Dev Manager (reports to Director)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Strategic Development / Client Relationship Manager',
       (SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),
       (SELECT id FROM positions WHERE title='Director'),
       TRUE, FALSE, 3;

-- Service Delivery Manager (under Ops Manager)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Service Delivery Manager',
       (SELECT id FROM departments WHERE name='Operations'),
       (SELECT id FROM positions WHERE title='Operations Manager'),
       TRUE, FALSE, 1;

-- Support Coordination Lead (under Ops Manager)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Support Coordination Lead',
       (SELECT id FROM departments WHERE name='Operations'),
       (SELECT id FROM positions WHERE title='Operations Manager'),
       TRUE, FALSE, 2;

-- HR / Admin Officer (under Ops Manager)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'HR / Admin Officer',
       (SELECT id FROM departments WHERE name='Operations'),
       (SELECT id FROM positions WHERE title='Operations Manager'),
       TRUE, FALSE, 3;

-- Day Centre Officer (under Ops Manager)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Day Centre Officer',
       (SELECT id FROM departments WHERE name='Operations'),
       (SELECT id FROM positions WHERE title='Operations Manager'),
       TRUE, FALSE, 4;

-- Roster Coordinator (under Service Delivery Manager)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Roster Coordinator',
       (SELECT id FROM departments WHERE name='Operations'),
       (SELECT id FROM positions WHERE title='Service Delivery Manager'),
       TRUE, FALSE, 1;

-- Support Coordination Staff (under Support Coordination Lead)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Support Coordination Staff',
       (SELECT id FROM departments WHERE name='Operations'),
       (SELECT id FROM positions WHERE title='Support Coordination Lead'),
       TRUE, FALSE, 1;

-- Plan Manager (under Finance Manager)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Plan Manager',
       (SELECT id FROM departments WHERE name='Finance'),
       (SELECT id FROM positions WHERE title='Finance Manager'),
       TRUE, FALSE, 1;

-- Support Workers (vacant, under Roster Coordinator)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Support Workers',
       (SELECT id FROM departments WHERE name='Operations'),
       (SELECT id FROM positions WHERE title='Roster Coordinator'),
       FALSE, TRUE, 1;

-- External Consultant under HR/Admin
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'External Consultant (HR)',
       (SELECT id FROM departments WHERE name='Operations'),
       (SELECT id FROM positions WHERE title='HR / Admin Officer'),
       FALSE, TRUE, 1;

-- Staff under Day Centre Officer
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Staff (Day Centre)',
       (SELECT id FROM departments WHERE name='Operations'),
       (SELECT id FROM positions WHERE title='Day Centre Officer'),
       FALSE, TRUE, 1;

-- External Consultant under Finance Manager
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'External Consultant (Finance)',
       (SELECT id FROM departments WHERE name='Finance'),
       (SELECT id FROM positions WHERE title='Finance Manager'),
       FALSE, TRUE, 1;

-- Business Development Officer (under Strategic Dev Manager)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Business Development Officer',
       (SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),
       (SELECT id FROM positions WHERE title='Strategic Development / Client Relationship Manager'),
       FALSE, TRUE, 1;

-- Client Relationship Officer (under Strategic Dev Manager)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Client Relationship Officer',
       (SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),
       (SELECT id FROM positions WHERE title='Strategic Development / Client Relationship Manager'),
       FALSE, TRUE, 2;

-- External Marketing Consultant (under Business Dev Officer)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'External Marketing Consultant',
       (SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),
       (SELECT id FROM positions WHERE title='Business Development Officer'),
       FALSE, TRUE, 1;

-- ── STEP 6: Assign users to positions + departments + managers ─

-- Alex — Director + Bootstrap Admin
UPDATE users SET
  position_id        = (SELECT id FROM positions WHERE title='Director'),
  department_id      = (SELECT id FROM departments WHERE name='Director Level'),
  department         = 'Director Level',
  designation        = 'Director / Client Relationship Manager',
  manager_id         = NULL,
  is_bootstrap_admin = TRUE,
  bootstrap_admin    = TRUE,
  assignable         = TRUE
WHERE email = 'alex@yahwehpc.com.au';

-- Ron Costa — Bootstrap Super Admin (system role, no position)
UPDATE users SET
  is_bootstrap_admin = TRUE,
  bootstrap_admin    = TRUE,
  assignable         = TRUE
WHERE email = 'it@yahwehcare.com.au';

-- Suganty P — Operations Manager
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Operations Manager'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  department    = 'Operations',
  designation   = 'Operations Manager',
  manager_id    = (SELECT id FROM users WHERE email='alex@yahwehpc.com.au'),
  assignable    = TRUE
WHERE email = 'suganty@yahwehpc.com.au';

-- Sunita Maharjan — Service Delivery Manager
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Service Delivery Manager'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  department    = 'Operations',
  designation   = 'Service Delivery Manager',
  manager_id    = (SELECT id FROM users WHERE email='suganty@yahwehpc.com.au'),
  assignable    = TRUE
WHERE email = 'sunny@yahwehcare.com.au';

-- Elenor Elia — Roster Coordinator
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Roster Coordinator'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  department    = 'Operations',
  designation   = 'Roster Coordinator',
  manager_id    = (SELECT id FROM users WHERE email='sunny@yahwehcare.com.au'),
  assignable    = TRUE
WHERE email = 'elenor@yahwehcare.com.au';

-- Saloni — Support Coordination Lead
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Support Coordination Lead'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  department    = 'Operations',
  designation   = 'Support Coordination Lead',
  manager_id    = (SELECT id FROM users WHERE email='suganty@yahwehpc.com.au'),
  assignable    = TRUE
WHERE email = 'saloni@yahwehcare.com.au';

-- James Baskaran — Support Coordination Staff
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Support Coordination Staff'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  department    = 'Operations',
  designation   = 'Support Coordination Staff',
  manager_id    = (SELECT id FROM users WHERE email='saloni@yahwehcare.com.au'),
  assignable    = TRUE
WHERE email = 'james@yahwehcare.com.au';

-- Miejkyla — HR / Admin Officer
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='HR / Admin Officer'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  department    = 'Operations',
  designation   = 'HR / Admin Officer',
  manager_id    = (SELECT id FROM users WHERE email='suganty@yahwehpc.com.au'),
  assignable    = TRUE
WHERE email = 'miejkyla@yahwehcare.com.au';

-- Venujah Arudselvam — Day Centre Officer
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Day Centre Officer'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  department    = 'Operations',
  designation   = 'Day Centre Officer',
  manager_id    = (SELECT id FROM users WHERE email='suganty@yahwehpc.com.au'),
  assignable    = TRUE
WHERE email = 'venujah@yahwehcare.com.au';

-- Akila Nanayakkara — Finance Manager + Plan Manager
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Finance Manager'),
  department_id = (SELECT id FROM departments WHERE name='Finance'),
  department    = 'Finance',
  designation   = 'Finance Manager / Plan Manager',
  manager_id    = (SELECT id FROM users WHERE email='alex@yahwehpc.com.au'),
  assignable    = TRUE
WHERE email = 'akila@yahwehcare.com.au';

-- ── STEP 7: Recreate org chart view ──────────────────────────
DROP VIEW IF EXISTS v_org_chart;
CREATE VIEW v_org_chart AS
SELECT
  u.id, u.name, u.email, u.active, u.department, u.designation,
  u.profile_photo_url, u.avatar_initials, u.role,
  COALESCE(u.is_bootstrap_admin, u.bootstrap_admin, FALSE) AS is_bootstrap_admin,
  p.id          AS position_id,
  p.title       AS position_title,
  p.is_vacant,
  p.is_active   AS position_is_active,
  p.parent_position_id,
  d.id          AS department_id,
  d.name        AS department_name,
  m.id          AS manager_id,
  m.name        AS manager_name,
  m.email       AS manager_email
FROM positions p
LEFT JOIN departments d ON d.id = p.department_id
LEFT JOIN users u       ON u.position_id = p.id AND u.active = TRUE
LEFT JOIN users m       ON m.id = u.manager_id;

-- ── STEP 8: Indexes ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_positions_dept   ON positions(department_id);
CREATE INDEX IF NOT EXISTS idx_positions_parent ON positions(parent_position_id);
CREATE INDEX IF NOT EXISTS idx_users_position   ON users(position_id);
CREATE INDEX IF NOT EXISTS idx_users_manager    ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_dept       ON users(department_id);

-- ── Verify ────────────────────────────────────────────────────
SELECT
  u.name,
  u.email,
  u.designation,
  u.department,
  p.title AS position,
  m.name  AS reports_to,
  u.active,
  u.is_bootstrap_admin
FROM users u
LEFT JOIN positions   p ON p.id = u.position_id
LEFT JOIN users       m ON m.id = u.manager_id
ORDER BY u.department NULLS LAST, u.designation;
