-- ============================================================
-- Yahweh Care — DEFINITIVE User + Org Rebuild
-- Pastes into Neon SQL Editor → Run
--
-- What this does:
--   1. Wipes all existing users (handles FK constraints)
--   2. Wipes and rebuilds departments + positions
--   3. Inserts EXACTLY the 10 people from the org chart
--   4. Assigns every person their role, designation,
--      department, position, and manager
-- ============================================================

SET search_path = yc_tkt_mgmt;

-- ── 0. Make tables safe for rebuild ───────────────────────────

-- Nullify user FKs in dependent tables so DELETE won't fail
UPDATE tickets  SET requester_id = NULL, assignee_id = NULL;
DELETE FROM comments;
DELETE FROM activity;

-- Nullify self-referential manager_id before clearing users
UPDATE users SET manager_id = NULL WHERE manager_id IS NOT NULL;
UPDATE users SET position_id = NULL WHERE position_id IS NOT NULL;

-- ── 1. Create org tables if they don't exist ──────────────────

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

ALTER TABLE users ADD COLUMN IF NOT EXISTS position_id       INT REFERENCES positions(id)   ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id        INT REFERENCES users(id)        ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id     INT REFERENCES departments(id)  ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bootstrap_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS assignable        BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Delete ALL existing users ─────────────────────────────
DELETE FROM users;

-- Reset serial so IDs start clean
ALTER SEQUENCE IF EXISTS users_id_seq RESTART WITH 1;

-- ── 3. Ensure role rows exist ─────────────────────────────────
INSERT INTO roles (name, display_name, description, rank, is_system) VALUES
  ('super_admin', 'Super Admin',         'Full system access',               1, TRUE),
  ('admin',       'Admin',               'Administrative access',            2, TRUE),
  ('manager',     'Manager',             'Department head',                  3, TRUE),
  ('hr',          'HR Officer',          'Human resources access',           4, TRUE),
  ('user',        'Staff',               'Standard staff access',            5, TRUE)
ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name;

-- ── 4. Insert org-chart users ─────────────────────────────────
-- Super Admin role id
-- (resolved inline via subquery)

INSERT INTO users
  (email, name, role_id, role, department, designation,
   auth_provider, active, avatar_initials,
   system_created, bootstrap_admin, is_bootstrap_admin, assignable)
VALUES
  -- Alex — Director / Bootstrap Admin
  ('alex@yahwehpc.com.au',    'Alex',               (SELECT id FROM roles WHERE name='super_admin'), 'super_admin',
   'Director Level',          'Director / Client Relationship Manager',
   'microsoft', TRUE, 'AL', FALSE, TRUE,  TRUE,  TRUE),

  -- Ron Costa — Bootstrap Super Admin (system role)
  ('it@yahwehcare.com.au',    'Ron Costa',          (SELECT id FROM roles WHERE name='super_admin'), 'super_admin',
   NULL,                      'Bootstrap Super Admin',
   'microsoft', TRUE, 'RC', FALSE, TRUE,  TRUE,  TRUE),

  -- Suganty P — Operations Manager
  ('suganty@yahwehpc.com.au', 'Suganty P',          (SELECT id FROM roles WHERE name='manager'),     'manager',
   'Operations',              'Operations Manager',
   'microsoft', TRUE, 'SP', FALSE, FALSE, FALSE, TRUE),

  -- Sunita Maharjan — Service Delivery Manager
  ('sunny@yahwehcare.com.au', 'Sunita Maharjan',    (SELECT id FROM roles WHERE name='manager'),     'manager',
   'Operations',              'Service Delivery Manager',
   'microsoft', TRUE, 'SM', FALSE, FALSE, FALSE, TRUE),

  -- Elenor Elia — Roster Coordinator
  ('elenor@yahwehcare.com.au','Elenor Elia',        (SELECT id FROM roles WHERE name='user'),        'user',
   'Operations',              'Roster Coordinator',
   'microsoft', TRUE, 'EE', FALSE, FALSE, FALSE, TRUE),

  -- Saloni — Support Coordination Lead
  ('saloni@yahwehcare.com.au','Saloni',              (SELECT id FROM roles WHERE name='manager'),     'manager',
   'Operations',              'Support Coordination Lead',
   'microsoft', TRUE, 'SA', FALSE, FALSE, FALSE, TRUE),

  -- James Baskaran — Support Coordination Staff
  ('james@yahwehcare.com.au', 'James Baskaran',     (SELECT id FROM roles WHERE name='user'),        'user',
   'Operations',              'Support Coordination Staff',
   'microsoft', TRUE, 'JB', FALSE, FALSE, FALSE, TRUE),

  -- Miejkyla — HR / Admin Officer
  ('miejkyla@yahwehcare.com.au','Miejkyla',          (SELECT id FROM roles WHERE name='hr'),          'hr',
   'Operations',              'HR / Admin Officer',
   'microsoft', TRUE, 'MI', FALSE, FALSE, FALSE, TRUE),

  -- Venujah Arudselvam — Day Centre Officer
  ('venujah@yahwehcare.com.au','Venujah Arudselvam',(SELECT id FROM roles WHERE name='user'),        'user',
   'Operations',              'Day Centre Officer',
   'microsoft', TRUE, 'VA', FALSE, FALSE, FALSE, TRUE),

  -- Akila Nanayakkara — Finance Manager / Plan Manager
  ('akila@yahwehcare.com.au', 'Akila Nanayakkara',  (SELECT id FROM roles WHERE name='manager'),     'manager',
   'Finance',                 'Finance Manager / Plan Manager',
   'microsoft', TRUE, 'AN', FALSE, FALSE, FALSE, TRUE);

-- ── 5. Rebuild departments ────────────────────────────────────
DELETE FROM departments;
ALTER SEQUENCE IF EXISTS departments_id_seq RESTART WITH 1;

INSERT INTO departments (name, sort_order) VALUES
  ('Director Level',                             0),
  ('Operations',                                 1),
  ('Finance',                                    2),
  ('Strategic Development & Client Relations',   3);

-- ── 6. Rebuild positions ──────────────────────────────────────
DELETE FROM positions;
ALTER SEQUENCE IF EXISTS positions_id_seq RESTART WITH 1;

-- Root: Director
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
VALUES ('Director',
  (SELECT id FROM departments WHERE name='Director Level'), NULL, TRUE, FALSE, 0);

-- Dept heads (report to Director)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('Operations Manager',
    (SELECT id FROM departments WHERE name='Operations'),
    (SELECT id FROM positions WHERE title='Director'), TRUE, FALSE, 1),
  ('Finance Manager',
    (SELECT id FROM departments WHERE name='Finance'),
    (SELECT id FROM positions WHERE title='Director'), TRUE, FALSE, 2),
  ('Strategic Development / Client Relationship Manager',
    (SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),
    (SELECT id FROM positions WHERE title='Director'), TRUE, FALSE, 3);

-- Under Operations Manager
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('Service Delivery Manager',
    (SELECT id FROM departments WHERE name='Operations'),
    (SELECT id FROM positions WHERE title='Operations Manager'), TRUE, FALSE, 1),
  ('Support Coordination Lead',
    (SELECT id FROM departments WHERE name='Operations'),
    (SELECT id FROM positions WHERE title='Operations Manager'), TRUE, FALSE, 2),
  ('HR / Admin Officer',
    (SELECT id FROM departments WHERE name='Operations'),
    (SELECT id FROM positions WHERE title='Operations Manager'), TRUE, FALSE, 3),
  ('Day Centre Officer',
    (SELECT id FROM departments WHERE name='Operations'),
    (SELECT id FROM positions WHERE title='Operations Manager'), TRUE, FALSE, 4);

-- Under Service Delivery Manager
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('Roster Coordinator',
    (SELECT id FROM departments WHERE name='Operations'),
    (SELECT id FROM positions WHERE title='Service Delivery Manager'), TRUE, FALSE, 1);

-- Under Roster Coordinator (vacant)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('Support Workers',
    (SELECT id FROM departments WHERE name='Operations'),
    (SELECT id FROM positions WHERE title='Roster Coordinator'), FALSE, TRUE, 1);

-- Under Support Coordination Lead
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('Support Coordination Staff',
    (SELECT id FROM departments WHERE name='Operations'),
    (SELECT id FROM positions WHERE title='Support Coordination Lead'), TRUE, FALSE, 1);

-- Under HR / Admin Officer (vacant)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('External Consultant (HR)',
    (SELECT id FROM departments WHERE name='Operations'),
    (SELECT id FROM positions WHERE title='HR / Admin Officer'), FALSE, TRUE, 1);

-- Under Day Centre Officer (vacant)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('Staff (Day Centre)',
    (SELECT id FROM departments WHERE name='Operations'),
    (SELECT id FROM positions WHERE title='Day Centre Officer'), FALSE, TRUE, 1);

-- Under Finance Manager
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('Plan Manager',
    (SELECT id FROM departments WHERE name='Finance'),
    (SELECT id FROM positions WHERE title='Finance Manager'), TRUE, FALSE, 1),
  ('External Consultant (Finance)',
    (SELECT id FROM departments WHERE name='Finance'),
    (SELECT id FROM positions WHERE title='Finance Manager'), FALSE, TRUE, 2);

-- Under Strategic Dev Manager (all vacant)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('Business Development Officer',
    (SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),
    (SELECT id FROM positions WHERE title='Strategic Development / Client Relationship Manager'), FALSE, TRUE, 1),
  ('Client Relationship Officer',
    (SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),
    (SELECT id FROM positions WHERE title='Strategic Development / Client Relationship Manager'), FALSE, TRUE, 2);

-- Under Business Development Officer (vacant)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order) VALUES
  ('External Marketing Consultant',
    (SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),
    (SELECT id FROM positions WHERE title='Business Development Officer'), FALSE, TRUE, 1);

-- ── 7. Assign positions + managers ───────────────────────────

-- Alex → Director, no manager
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Director'),
  department_id = (SELECT id FROM departments WHERE name='Director Level')
WHERE email = 'alex@yahwehpc.com.au';

-- Suganty → Operations Manager, reports to Alex
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Operations Manager'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  manager_id    = (SELECT id FROM users WHERE email='alex@yahwehpc.com.au')
WHERE email = 'suganty@yahwehpc.com.au';

-- Sunita → Service Delivery Manager, reports to Suganty
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Service Delivery Manager'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  manager_id    = (SELECT id FROM users WHERE email='suganty@yahwehpc.com.au')
WHERE email = 'sunny@yahwehcare.com.au';

-- Elenor → Roster Coordinator, reports to Sunita
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Roster Coordinator'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  manager_id    = (SELECT id FROM users WHERE email='sunny@yahwehcare.com.au')
WHERE email = 'elenor@yahwehcare.com.au';

-- Saloni → Support Coordination Lead, reports to Suganty
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Support Coordination Lead'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  manager_id    = (SELECT id FROM users WHERE email='suganty@yahwehpc.com.au')
WHERE email = 'saloni@yahwehcare.com.au';

-- James → Support Coordination Staff, reports to Saloni
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Support Coordination Staff'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  manager_id    = (SELECT id FROM users WHERE email='saloni@yahwehcare.com.au')
WHERE email = 'james@yahwehcare.com.au';

-- Miejkyla → HR / Admin Officer, reports to Suganty
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='HR / Admin Officer'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  manager_id    = (SELECT id FROM users WHERE email='suganty@yahwehpc.com.au')
WHERE email = 'miejkyla@yahwehcare.com.au';

-- Venujah → Day Centre Officer, reports to Suganty
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Day Centre Officer'),
  department_id = (SELECT id FROM departments WHERE name='Operations'),
  manager_id    = (SELECT id FROM users WHERE email='suganty@yahwehpc.com.au')
WHERE email = 'venujah@yahwehcare.com.au';

-- Akila → Finance Manager, reports to Alex
UPDATE users SET
  position_id   = (SELECT id FROM positions WHERE title='Finance Manager'),
  department_id = (SELECT id FROM departments WHERE name='Finance'),
  manager_id    = (SELECT id FROM users WHERE email='alex@yahwehpc.com.au')
WHERE email = 'akila@yahwehcare.com.au';

-- Ron Costa — system role only, no position in hierarchy
UPDATE users SET department_id = NULL, position_id = NULL
WHERE email = 'it@yahwehcare.com.au';

-- ── 8. Recreate org chart view ────────────────────────────────
DROP VIEW IF EXISTS v_org_chart;
CREATE VIEW v_org_chart AS
SELECT
  u.id, u.name, u.email, u.active, u.department, u.designation,
  u.profile_photo_url, u.avatar_initials, u.role,
  COALESCE(u.is_bootstrap_admin, u.bootstrap_admin, FALSE) AS is_bootstrap_admin,
  p.id    AS position_id,
  p.title AS position_title,
  p.is_vacant,
  p.is_active   AS position_is_active,
  p.parent_position_id,
  d.id    AS department_id,
  d.name  AS department_name,
  m.id    AS manager_id,
  m.name  AS manager_name,
  m.email AS manager_email
FROM positions p
LEFT JOIN departments d ON d.id = p.department_id
LEFT JOIN users u       ON u.position_id = p.id AND u.active = TRUE
LEFT JOIN users m       ON m.id = u.manager_id;

CREATE INDEX IF NOT EXISTS idx_positions_dept   ON positions(department_id);
CREATE INDEX IF NOT EXISTS idx_positions_parent ON positions(parent_position_id);
CREATE INDEX IF NOT EXISTS idx_users_position   ON users(position_id);
CREATE INDEX IF NOT EXISTS idx_users_manager    ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_dept       ON users(department_id);

-- ── 9. Verification — confirm result ─────────────────────────
SELECT
  u.name,
  u.email,
  u.role,
  u.designation,
  u.department,
  p.title  AS position,
  m.name   AS reports_to,
  CASE WHEN u.active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
  CASE WHEN COALESCE(u.is_bootstrap_admin, u.bootstrap_admin) THEN '✓ Bootstrap' ELSE '' END AS bootstrap
FROM users u
LEFT JOIN positions p ON p.id = u.position_id
LEFT JOIN users     m ON m.id = u.manager_id
ORDER BY
  CASE u.role WHEN 'super_admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'hr' THEN 2 ELSE 3 END,
  u.department NULLS LAST, u.designation;
