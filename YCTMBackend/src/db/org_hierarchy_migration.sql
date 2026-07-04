-- ============================================================
-- Yahweh Care — Organisational Hierarchy Migration
-- Run this in Neon SQL Editor (schema: yc_tkt_mgmt)
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING
-- ============================================================

SET search_path = yc_tkt_mgmt;

-- ── 1. DEPARTMENTS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  parent_dept_id    INT  REFERENCES departments(id) ON DELETE SET NULL,
  sort_order        INT  NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. POSITIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS positions (
  id                SERIAL PRIMARY KEY,
  title             TEXT NOT NULL,
  department_id     INT  REFERENCES departments(id) ON DELETE SET NULL,
  parent_position_id INT REFERENCES positions(id) ON DELETE SET NULL,
  is_active         BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE when a person holds it
  is_vacant         BOOLEAN NOT NULL DEFAULT TRUE,    -- TRUE when no one assigned
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Add org columns to users table ───────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS position_id   INT REFERENCES positions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_id    INT REFERENCES users(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_id INT REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entra_object_id TEXT,
  ADD COLUMN IF NOT EXISTS is_bootstrap_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 4. Mark existing bootstrap admins ────────────────────────
UPDATE users SET is_bootstrap_admin = TRUE
WHERE bootstrap_admin = TRUE OR email IN ('alex@yahwehpc.com.au','it@yahwehcare.com.au');

-- ── 5. SEED DEPARTMENTS ──────────────────────────────────────
INSERT INTO departments (name, sort_order) VALUES
  ('Director Level',                            0),
  ('Operations',                                1),
  ('Finance',                                   2),
  ('Strategic Development & Client Relations',  3)
ON CONFLICT (name) DO NOTHING;

-- ── 6. SEED POSITIONS ────────────────────────────────────────
-- Director Level
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Director', d.id, NULL, TRUE, FALSE, 0
FROM departments d WHERE d.name = 'Director Level'
ON CONFLICT DO NOTHING;

-- Operations — top level
WITH dir_pos AS (SELECT id FROM positions WHERE title = 'Director'),
     ops_dept AS (SELECT id FROM departments WHERE name = 'Operations')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Operations Manager', ops_dept.id, dir_pos.id, TRUE, FALSE, 0
FROM dir_pos, ops_dept
ON CONFLICT DO NOTHING;

-- Operations — under Operations Manager
WITH parent AS (SELECT id FROM positions WHERE title = 'Operations Manager'),
     dept AS (SELECT id FROM departments WHERE name = 'Operations')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('Service Delivery Manager',  (SELECT id FROM dept), (SELECT id FROM parent), TRUE,  FALSE, 1),
  ('Support Coordination Lead', (SELECT id FROM dept), (SELECT id FROM parent), TRUE,  FALSE, 2),
  ('HR / Admin Officer',        (SELECT id FROM dept), (SELECT id FROM parent), TRUE,  FALSE, 3),
  ('Day Centre Officer',        (SELECT id FROM dept), (SELECT id FROM parent), TRUE,  FALSE, 4)
ON CONFLICT DO NOTHING;

-- Under Service Delivery Manager
WITH parent AS (SELECT id FROM positions WHERE title = 'Service Delivery Manager'),
     dept AS (SELECT id FROM departments WHERE name = 'Operations')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Roster Coordinator', dept.id, parent.id, TRUE, FALSE, 1 FROM parent, dept
ON CONFLICT DO NOTHING;

-- Under Roster Coordinator
WITH parent AS (SELECT id FROM positions WHERE title = 'Roster Coordinator'),
     dept AS (SELECT id FROM departments WHERE name = 'Operations')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Support Worker', dept.id, parent.id, FALSE, TRUE, 1 FROM parent, dept
ON CONFLICT DO NOTHING;

-- Under Support Coordination Lead
WITH parent AS (SELECT id FROM positions WHERE title = 'Support Coordination Lead'),
     dept AS (SELECT id FROM departments WHERE name = 'Operations')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Support Coordination Staff', dept.id, parent.id, TRUE, FALSE, 1 FROM parent, dept
ON CONFLICT DO NOTHING;

-- Under HR/Admin Officer
WITH parent AS (SELECT id FROM positions WHERE title = 'HR / Admin Officer'),
     dept AS (SELECT id FROM departments WHERE name = 'Operations')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'External Consultant (Ops-HR)', dept.id, parent.id, FALSE, TRUE, 1 FROM parent, dept
ON CONFLICT DO NOTHING;

-- Under Day Centre Officer
WITH parent AS (SELECT id FROM positions WHERE title = 'Day Centre Officer'),
     dept AS (SELECT id FROM departments WHERE name = 'Operations')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Staff (Day Centre)', dept.id, parent.id, FALSE, TRUE, 1 FROM parent, dept
ON CONFLICT DO NOTHING;

-- Finance — top level
WITH parent AS (SELECT id FROM positions WHERE title = 'Director'),
     dept AS (SELECT id FROM departments WHERE name = 'Finance')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Finance Manager', dept.id, parent.id, TRUE, FALSE, 0 FROM parent, dept
ON CONFLICT DO NOTHING;

-- Under Finance Manager
WITH parent AS (SELECT id FROM positions WHERE title = 'Finance Manager'),
     dept AS (SELECT id FROM departments WHERE name = 'Finance')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('Plan Manager',                 (SELECT id FROM dept), (SELECT id FROM parent), TRUE,  FALSE, 1),
  ('External Consultant (Finance)',(SELECT id FROM dept), (SELECT id FROM parent), FALSE, TRUE,  2)
ON CONFLICT DO NOTHING;

-- Strategic Development — top level
WITH parent AS (SELECT id FROM positions WHERE title = 'Director'),
     dept AS (SELECT id FROM departments WHERE name = 'Strategic Development & Client Relations')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Strategic Development / Client Relationship Manager', dept.id, parent.id, TRUE, FALSE, 0
FROM parent, dept
ON CONFLICT DO NOTHING;

-- Under Strategic Dev Manager
WITH parent AS (SELECT id FROM positions WHERE title = 'Strategic Development / Client Relationship Manager'),
     dept AS (SELECT id FROM departments WHERE name = 'Strategic Development & Client Relations')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('Business Development Officer',    (SELECT id FROM dept), (SELECT id FROM parent), FALSE, TRUE, 1),
  ('Client Relationship Officer',     (SELECT id FROM dept), (SELECT id FROM parent), FALSE, TRUE, 2)
ON CONFLICT DO NOTHING;

-- Under Business Development Officer
WITH parent AS (SELECT id FROM positions WHERE title = 'Business Development Officer'),
     dept AS (SELECT id FROM departments WHERE name = 'Strategic Development & Client Relations')
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'External Marketing Consultant', dept.id, parent.id, FALSE, TRUE, 1 FROM parent, dept
ON CONFLICT DO NOTHING;

-- ── 7. ASSIGN users to positions & departments ────────────────
-- Alex — Director (also Bootstrap Admin)
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title = 'Director'),
  department_id = (SELECT id FROM departments WHERE name = 'Director Level'),
  is_bootstrap_admin = TRUE
WHERE email = 'alex@yahwehpc.com.au';

-- Ron Costa — Bootstrap Super Admin (no positional hierarchy)
UPDATE users SET is_bootstrap_admin = TRUE
WHERE email = 'it@yahwehcare.com.au';

-- Suganty — Operations Manager
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title = 'Operations Manager'),
  department_id = (SELECT id FROM departments WHERE name = 'Operations'),
  manager_id    = (SELECT id FROM users WHERE email = 'alex@yahwehpc.com.au')
WHERE email = 'suganty@yahwehpc.com.au';

-- Sunita — Service Delivery Manager
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title = 'Service Delivery Manager'),
  department_id = (SELECT id FROM departments WHERE name = 'Operations'),
  manager_id    = (SELECT id FROM users WHERE email = 'suganty@yahwehpc.com.au')
WHERE email = 'sunny@yahwehcare.com.au';

-- Elenor — Roster Coordinator
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title = 'Roster Coordinator'),
  department_id = (SELECT id FROM departments WHERE name = 'Operations'),
  manager_id    = (SELECT id FROM users WHERE email = 'sunny@yahwehcare.com.au')
WHERE email = 'elenor@yahwehcare.com.au';

-- Saloni — Support Coordination Lead
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title = 'Support Coordination Lead'),
  department_id = (SELECT id FROM departments WHERE name = 'Operations'),
  manager_id    = (SELECT id FROM users WHERE email = 'suganty@yahwehpc.com.au')
WHERE email = 'saloni@yahwehcare.com.au';

-- James — Support Coordination Staff
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title = 'Support Coordination Staff'),
  department_id = (SELECT id FROM departments WHERE name = 'Operations'),
  manager_id    = (SELECT id FROM users WHERE email = 'saloni@yahwehcare.com.au')
WHERE email = 'james@yahwehcare.com.au';

-- Miejkyla — HR / Admin Officer
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title = 'HR / Admin Officer'),
  department_id = (SELECT id FROM departments WHERE name = 'Operations'),
  manager_id    = (SELECT id FROM users WHERE email = 'suganty@yahwehpc.com.au')
WHERE email = 'miejkyla@yahwehcare.com.au';

-- Venujah — Day Centre Officer
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title = 'Day Centre Officer'),
  department_id = (SELECT id FROM departments WHERE name = 'Operations'),
  manager_id    = (SELECT id FROM users WHERE email = 'suganty@yahwehpc.com.au')
WHERE email = 'venujah@yahwehcare.com.au';

-- Akila — Finance Manager / Plan Manager
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title = 'Finance Manager'),
  department_id = (SELECT id FROM departments WHERE name = 'Finance'),
  manager_id    = (SELECT id FROM users WHERE email = 'alex@yahwehpc.com.au')
WHERE email = 'akila@yahwehcare.com.au';

-- ── 8. ROW-LEVEL SECURITY (RLS) ──────────────────────────────
-- Enable RLS on tickets table so staff only see their own / department tickets
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Bootstrap admins and super_admin see everything
CREATE POLICY IF NOT EXISTS tickets_superadmin
  ON tickets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = current_setting('app.user_id', TRUE)::INT
        AND (u.is_bootstrap_admin = TRUE OR u.role = 'super_admin')
    )
  );

-- Managers see their department's tickets
CREATE POLICY IF NOT EXISTS tickets_manager
  ON tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = current_setting('app.user_id', TRUE)::INT
        AND u.role IN ('manager','admin','hr')
    )
  );

-- Staff see only tickets they created or are assigned to
CREATE POLICY IF NOT EXISTS tickets_staff
  ON tickets FOR SELECT
  USING (
    requester_id = current_setting('app.user_id', TRUE)::INT
    OR assignee_id = current_setting('app.user_id', TRUE)::INT
  );

-- ── 9. INDEXES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_positions_dept   ON positions(department_id);
CREATE INDEX IF NOT EXISTS idx_positions_parent ON positions(parent_position_id);
CREATE INDEX IF NOT EXISTS idx_users_position   ON users(position_id);
CREATE INDEX IF NOT EXISTS idx_users_manager    ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_dept       ON users(department_id);

-- ── 10. Org chart view ───────────────────────────────────────
CREATE OR REPLACE VIEW v_org_chart AS
SELECT
  u.id,
  u.name,
  u.email,
  u.active,
  u.department,
  u.designation,
  u.profile_photo_url,
  u.avatar_initials,
  u.role,
  u.is_bootstrap_admin,
  p.id          AS position_id,
  p.title       AS position_title,
  p.is_vacant,
  p.parent_position_id,
  d.id          AS department_id,
  d.name        AS department_name,
  m.id          AS manager_id,
  m.name        AS manager_name,
  m.email       AS manager_email
FROM positions p
LEFT JOIN departments d    ON d.id = p.department_id
LEFT JOIN users u          ON u.position_id = p.id AND u.active = TRUE
LEFT JOIN users m          ON m.id = u.manager_id;

SELECT 'Migration complete — departments, positions, org chart view created.' AS result;
