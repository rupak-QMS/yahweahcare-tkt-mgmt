-- ============================================================
-- Yahweh Care — Full Rebuild (Neon-compatible, single paste)
-- ============================================================
SET search_path = yc_tkt_mgmt;

-- ── 0. Add org columns to users if missing ───────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS position_id        INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id         INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id      INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bootstrap_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS assignable         BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 1. Clear FK-blocking tables (safe: skips if table absent) ─
DO $$ BEGIN DELETE FROM role_permissions; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM sessions;         EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM audit_logs;       EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM comments;         EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM activity;         EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM notifications;    EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM schedules;        EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ── 2. Remove tickets (requester_id is NOT NULL — must delete, not nullify) ─
DO $$ BEGIN DELETE FROM ticket_comments;    EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM ticket_history;     EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM ticket_attachments; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM tickets;            EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Nullify user self-references before deleting users
UPDATE users SET manager_id = NULL, position_id = NULL;

-- ── 3. Delete everything — order matters for FK safety ────────
DELETE FROM users;
DO $$ BEGIN DELETE FROM positions;    EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DELETE FROM departments;  EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ── 4. Ensure roles exist ─────────────────────────────────────
INSERT INTO roles (name, display_name, description, rank, is_system) VALUES
  ('super_admin', 'Super Admin', 'Full system access', 1, TRUE),
  ('admin',       'Admin',       'Admin access',       2, TRUE),
  ('manager',     'Manager',     'Department head',    3, TRUE),
  ('hr',          'HR Officer',  'HR access',          4, TRUE),
  ('user',        'Staff',       'Standard access',    5, TRUE)
ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name;

-- ── 5. Insert 10 org-chart users ─────────────────────────────
-- All users are ACTIVE. Designations match the org chart exactly.

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'alex@yahwehpc.com.au', 'Alex', id, 'super_admin', 'Director Level', 'Director / Client Relationship Manager', 'microsoft', TRUE, 'AL', FALSE, TRUE, TRUE, TRUE
FROM roles WHERE name = 'super_admin';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'it@yahwehcare.com.au', 'Ron Costa', id, 'super_admin', NULL, 'Bootstrap Super Admin', 'microsoft', TRUE, 'RC', FALSE, TRUE, TRUE, TRUE
FROM roles WHERE name = 'super_admin';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'suganty@yahwehpc.com.au', 'Suganty P', id, 'manager', 'Operations', 'Operations Manager', 'microsoft', TRUE, 'SP', FALSE, FALSE, FALSE, TRUE
FROM roles WHERE name = 'manager';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'sunny@yahwehcare.com.au', 'Sunita Maharjan', id, 'manager', 'Operations', 'Service Delivery Manager', 'microsoft', TRUE, 'SM', FALSE, FALSE, FALSE, TRUE
FROM roles WHERE name = 'manager';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'elenor@yahwehcare.com.au', 'Elenor Elia', id, 'user', 'Operations', 'Roster Coordinator', 'microsoft', TRUE, 'EE', FALSE, FALSE, FALSE, TRUE
FROM roles WHERE name = 'user';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'saloni@yahwehcare.com.au', 'Saloni', id, 'manager', 'Operations', 'Support Coordination Lead', 'microsoft', TRUE, 'SA', FALSE, FALSE, FALSE, TRUE
FROM roles WHERE name = 'manager';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'james@yahwehcare.com.au', 'James Baskaran', id, 'user', 'Operations', 'Support Coordination Staff', 'microsoft', TRUE, 'JB', FALSE, FALSE, FALSE, TRUE
FROM roles WHERE name = 'user';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'miejkyla@yahwehcare.com.au', 'Miejkyla', id, 'hr', 'Operations', 'HR / Admin Officer', 'microsoft', TRUE, 'MI', FALSE, FALSE, FALSE, TRUE
FROM roles WHERE name = 'hr';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'venujah@yahwehcare.com.au', 'Venujah Arudselvam', id, 'user', 'Operations', 'Day Centre Officer', 'microsoft', TRUE, 'VA', FALSE, FALSE, FALSE, TRUE
FROM roles WHERE name = 'user';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'akila@yahwehcare.com.au', 'Akila Nanayakkara', id, 'manager', 'Finance', 'Finance Manager / Plan Manager', 'microsoft', TRUE, 'AN', FALSE, FALSE, FALSE, TRUE
FROM roles WHERE name = 'manager';

-- ── 6. Create tables if they don't exist, then seed ──────────
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

-- Add FK columns on users now that tables exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS position_id   INT REFERENCES positions(id)   ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id    INT REFERENCES users(id)        ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INT REFERENCES departments(id)  ON DELETE SET NULL;

INSERT INTO departments (name, sort_order) VALUES
  ('Director Level',                           0),
  ('Operations',                               1),
  ('Finance',                                  2),
  ('Strategic Development & Client Relations', 3);

-- ── 7. Seed positions (each in its own statement to avoid ─────
--      subquery-on-same-table issues in Neon) ──────────────────

-- L0: Director (root)
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Director',
  (SELECT id FROM departments WHERE name = 'Director Level'),
  NULL, TRUE, FALSE, 0;

-- L1: Reports to Director
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Operations Manager',
  (SELECT id FROM departments WHERE name = 'Operations'),
  (SELECT id FROM positions  WHERE title  = 'Director'),
  TRUE, FALSE, 1;

INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Finance Manager',
  (SELECT id FROM departments WHERE name = 'Finance'),
  (SELECT id FROM positions  WHERE title  = 'Director'),
  TRUE, FALSE, 2;

INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Strategic Development / Client Relationship Manager',
  (SELECT id FROM departments WHERE name = 'Strategic Development & Client Relations'),
  (SELECT id FROM positions  WHERE title  = 'Director'),
  TRUE, FALSE, 3;

-- L2: Reports to Operations Manager
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Service Delivery Manager',
  (SELECT id FROM departments WHERE name = 'Operations'),
  (SELECT id FROM positions  WHERE title  = 'Operations Manager'),
  TRUE, FALSE, 1;

INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Support Coordination Lead',
  (SELECT id FROM departments WHERE name = 'Operations'),
  (SELECT id FROM positions  WHERE title  = 'Operations Manager'),
  TRUE, FALSE, 2;

INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'HR / Admin Officer',
  (SELECT id FROM departments WHERE name = 'Operations'),
  (SELECT id FROM positions  WHERE title  = 'Operations Manager'),
  TRUE, FALSE, 3;

INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Day Centre Officer',
  (SELECT id FROM departments WHERE name = 'Operations'),
  (SELECT id FROM positions  WHERE title  = 'Operations Manager'),
  TRUE, FALSE, 4;

-- L3: Reports to Service Delivery Manager
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Roster Coordinator',
  (SELECT id FROM departments WHERE name = 'Operations'),
  (SELECT id FROM positions  WHERE title  = 'Service Delivery Manager'),
  TRUE, FALSE, 1;

-- L3: Reports to Support Coordination Lead
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Support Coordination Staff',
  (SELECT id FROM departments WHERE name = 'Operations'),
  (SELECT id FROM positions  WHERE title  = 'Support Coordination Lead'),
  TRUE, FALSE, 1;

-- L2: Reports to Finance Manager
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Plan Manager',
  (SELECT id FROM departments WHERE name = 'Finance'),
  (SELECT id FROM positions  WHERE title  = 'Finance Manager'),
  TRUE, FALSE, 1;

-- Vacant leaf positions
INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Support Workers',
  (SELECT id FROM departments WHERE name = 'Operations'),
  (SELECT id FROM positions  WHERE title  = 'Roster Coordinator'),
  FALSE, TRUE, 1;

INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'External Consultant (HR)',
  (SELECT id FROM departments WHERE name = 'Operations'),
  (SELECT id FROM positions  WHERE title  = 'HR / Admin Officer'),
  FALSE, TRUE, 1;

INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Staff (Day Centre)',
  (SELECT id FROM departments WHERE name = 'Operations'),
  (SELECT id FROM positions  WHERE title  = 'Day Centre Officer'),
  FALSE, TRUE, 1;

INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'External Consultant (Finance)',
  (SELECT id FROM departments WHERE name = 'Finance'),
  (SELECT id FROM positions  WHERE title  = 'Finance Manager'),
  FALSE, TRUE, 2;

INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Business Development Officer',
  (SELECT id FROM departments WHERE name = 'Strategic Development & Client Relations'),
  (SELECT id FROM positions  WHERE title  = 'Strategic Development / Client Relationship Manager'),
  FALSE, TRUE, 1;

INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'Client Relationship Officer',
  (SELECT id FROM departments WHERE name = 'Strategic Development & Client Relations'),
  (SELECT id FROM positions  WHERE title  = 'Strategic Development / Client Relationship Manager'),
  FALSE, TRUE, 2;

INSERT INTO positions (title, department_id, parent_position_id, is_active, is_vacant, sort_order)
SELECT 'External Marketing Consultant',
  (SELECT id FROM departments WHERE name = 'Strategic Development & Client Relations'),
  (SELECT id FROM positions  WHERE title  = 'Business Development Officer'),
  FALSE, TRUE, 1;

-- ── 8. Assign position + department + manager to each user ────

UPDATE users SET
  position_id   = (SELECT id FROM positions   WHERE title = 'Director'),
  department_id = (SELECT id FROM departments WHERE name  = 'Director Level'),
  manager_id    = NULL
WHERE email = 'alex@yahwehpc.com.au';

UPDATE users SET
  position_id   = (SELECT id FROM positions   WHERE title = 'Operations Manager'),
  department_id = (SELECT id FROM departments WHERE name  = 'Operations'),
  manager_id    = (SELECT id FROM users       WHERE email = 'alex@yahwehpc.com.au')
WHERE email = 'suganty@yahwehpc.com.au';

UPDATE users SET
  position_id   = (SELECT id FROM positions   WHERE title = 'Service Delivery Manager'),
  department_id = (SELECT id FROM departments WHERE name  = 'Operations'),
  manager_id    = (SELECT id FROM users       WHERE email = 'suganty@yahwehpc.com.au')
WHERE email = 'sunny@yahwehcare.com.au';

UPDATE users SET
  position_id   = (SELECT id FROM positions   WHERE title = 'Roster Coordinator'),
  department_id = (SELECT id FROM departments WHERE name  = 'Operations'),
  manager_id    = (SELECT id FROM users       WHERE email = 'sunny@yahwehcare.com.au')
WHERE email = 'elenor@yahwehcare.com.au';

UPDATE users SET
  position_id   = (SELECT id FROM positions   WHERE title = 'Support Coordination Lead'),
  department_id = (SELECT id FROM departments WHERE name  = 'Operations'),
  manager_id    = (SELECT id FROM users       WHERE email = 'suganty@yahwehpc.com.au')
WHERE email = 'saloni@yahwehcare.com.au';

UPDATE users SET
  position_id   = (SELECT id FROM positions   WHERE title = 'Support Coordination Staff'),
  department_id = (SELECT id FROM departments WHERE name  = 'Operations'),
  manager_id    = (SELECT id FROM users       WHERE email = 'saloni@yahwehcare.com.au')
WHERE email = 'james@yahwehcare.com.au';

UPDATE users SET
  position_id   = (SELECT id FROM positions   WHERE title = 'HR / Admin Officer'),
  department_id = (SELECT id FROM departments WHERE name  = 'Operations'),
  manager_id    = (SELECT id FROM users       WHERE email = 'suganty@yahwehpc.com.au')
WHERE email = 'miejkyla@yahwehcare.com.au';

UPDATE users SET
  position_id   = (SELECT id FROM positions   WHERE title = 'Day Centre Officer'),
  department_id = (SELECT id FROM departments WHERE name  = 'Operations'),
  manager_id    = (SELECT id FROM users       WHERE email = 'suganty@yahwehpc.com.au')
WHERE email = 'venujah@yahwehcare.com.au';

UPDATE users SET
  position_id   = (SELECT id FROM positions   WHERE title = 'Finance Manager'),
  department_id = (SELECT id FROM departments WHERE name  = 'Finance'),
  manager_id    = (SELECT id FROM users       WHERE email = 'alex@yahwehpc.com.au')
WHERE email = 'akila@yahwehcare.com.au';

-- Ron Costa — bootstrap admin only, no position in hierarchy
UPDATE users SET
  is_bootstrap_admin = TRUE,
  bootstrap_admin    = TRUE
WHERE email = 'it@yahwehcare.com.au';

-- ── 9. Recreate org chart view ────────────────────────────────
DROP VIEW IF EXISTS v_org_chart;
CREATE VIEW v_org_chart AS
SELECT
  p.id, p.title, p.parent_position_id,
  p.is_active, p.is_vacant, p.sort_order, p.department_id,
  d.name  AS department_name,
  u.id    AS user_id,
  u.name  AS user_name,
  u.email AS user_email,
  u.profile_photo_url,
  u.avatar_initials,
  u.role,
  COALESCE(u.is_bootstrap_admin, u.bootstrap_admin, FALSE) AS is_bootstrap_admin,
  u.designation,
  u.active AS user_active
FROM positions p
LEFT JOIN departments d ON d.id = p.department_id
LEFT JOIN users u       ON u.position_id = p.id AND u.active = TRUE;

-- ── 10. Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_positions_dept   ON positions(department_id);
CREATE INDEX IF NOT EXISTS idx_positions_parent ON positions(parent_position_id);
CREATE INDEX IF NOT EXISTS idx_users_position   ON users(position_id);
CREATE INDEX IF NOT EXISTS idx_users_manager    ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_dept       ON users(department_id);

-- ── 11. Verify — should show 10 rows, all ACTIVE ─────────────
SELECT
  u.name,
  u.email,
  u.role,
  u.designation,
  p.title       AS position,
  m.name        AS reports_to,
  d.name        AS department,
  CASE WHEN u.active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
  CASE WHEN COALESCE(u.is_bootstrap_admin, u.bootstrap_admin, FALSE)
       THEN 'YES' ELSE 'NO' END AS bootstrap
FROM users u
LEFT JOIN positions   p ON p.id = u.position_id
LEFT JOIN users       m ON m.id = u.manager_id
LEFT JOIN departments d ON d.id = u.department_id
ORDER BY u.role, d.name NULLS LAST, u.name;
