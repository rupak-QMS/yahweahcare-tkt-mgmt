-- ============================================================
-- Yahweh Care — Definitive User Rebuild (paste into Neon)
-- ============================================================
SET search_path = yc_tkt_mgmt;

-- ── 0. Add columns if migration hasn't run yet ────────────────
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  parent_dept_id INT, sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL,
  department_id INT, parent_position_id INT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE, is_vacant BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS position_id        INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id         INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id      INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bootstrap_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS assignable         BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 1. Nuke all user-dependent data ──────────────────────────
UPDATE tickets  SET requester_id = NULL, assignee_id = NULL;
UPDATE users    SET manager_id = NULL, position_id = NULL;
DELETE FROM comments;
DELETE FROM activity;
-- also clear any other tables that might ref users:
DELETE FROM audit_logs   WHERE user_id IS NOT NULL;
DELETE FROM notifications WHERE user_id IS NOT NULL;
DELETE FROM schedules     WHERE user_id IS NOT NULL;

-- ── 2. Wipe users ─────────────────────────────────────────────
DELETE FROM users;

-- ── 3. Ensure roles exist ─────────────────────────────────────
INSERT INTO roles (name, display_name, description, rank, is_system)
VALUES
  ('super_admin','Super Admin','Full system access',1,TRUE),
  ('admin',      'Admin',      'Admin access',      2,TRUE),
  ('manager',    'Manager',    'Department head',   3,TRUE),
  ('hr',         'HR Officer', 'HR access',         4,TRUE),
  ('user',       'Staff',      'Standard access',   5,TRUE)
ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name;

-- ── 4. Insert 10 org-chart users ─────────────────────────────
INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'alex@yahwehpc.com.au','Alex',id,'super_admin','Director Level','Director / Client Relationship Manager','microsoft',TRUE,'AL',FALSE,TRUE,TRUE,TRUE FROM roles WHERE name='super_admin';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'it@yahwehcare.com.au','Ron Costa',id,'super_admin',NULL,'Bootstrap Super Admin','microsoft',TRUE,'RC',FALSE,TRUE,TRUE,TRUE FROM roles WHERE name='super_admin';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'suganty@yahwehpc.com.au','Suganty P',id,'manager','Operations','Operations Manager','microsoft',TRUE,'SP',FALSE,FALSE,FALSE,TRUE FROM roles WHERE name='manager';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'sunny@yahwehcare.com.au','Sunita Maharjan',id,'manager','Operations','Service Delivery Manager','microsoft',TRUE,'SM',FALSE,FALSE,FALSE,TRUE FROM roles WHERE name='manager';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'elenor@yahwehcare.com.au','Elenor Elia',id,'user','Operations','Roster Coordinator','microsoft',TRUE,'EE',FALSE,FALSE,FALSE,TRUE FROM roles WHERE name='user';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'saloni@yahwehcare.com.au','Saloni',id,'manager','Operations','Support Coordination Lead','microsoft',TRUE,'SA',FALSE,FALSE,FALSE,TRUE FROM roles WHERE name='manager';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'james@yahwehcare.com.au','James Baskaran',id,'user','Operations','Support Coordination Staff','microsoft',TRUE,'JB',FALSE,FALSE,FALSE,TRUE FROM roles WHERE name='user';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'miejkyla@yahwehcare.com.au','Miejkyla',id,'hr','Operations','HR / Admin Officer','microsoft',TRUE,'MI',FALSE,FALSE,FALSE,TRUE FROM roles WHERE name='hr';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'venujah@yahwehcare.com.au','Venujah Arudselvam',id,'user','Operations','Day Centre Officer','microsoft',TRUE,'VA',FALSE,FALSE,FALSE,TRUE FROM roles WHERE name='user';

INSERT INTO users (email, name, role_id, role, department, designation, auth_provider, active, avatar_initials, system_created, bootstrap_admin, is_bootstrap_admin, assignable)
SELECT 'akila@yahwehcare.com.au','Akila Nanayakkara',id,'manager','Finance','Finance Manager / Plan Manager','microsoft',TRUE,'AN',FALSE,FALSE,FALSE,TRUE FROM roles WHERE name='manager';

-- ── 5. Rebuild departments ────────────────────────────────────
DELETE FROM positions;
DELETE FROM departments;

INSERT INTO departments (name, sort_order) VALUES
  ('Director Level',                           0),
  ('Operations',                               1),
  ('Finance',                                  2),
  ('Strategic Development & Client Relations', 3);

-- ── 6. Seed positions (hierarchical order) ────────────────────

-- Root
INSERT INTO positions (title,department_id,parent_position_id,is_active,is_vacant,sort_order)
VALUES ('Director',(SELECT id FROM departments WHERE name='Director Level'),NULL,TRUE,FALSE,0);

-- Under Director
INSERT INTO positions (title,department_id,parent_position_id,is_active,is_vacant,sort_order) VALUES
('Operations Manager',(SELECT id FROM departments WHERE name='Operations'),(SELECT id FROM positions WHERE title='Director'),TRUE,FALSE,1),
('Finance Manager',(SELECT id FROM departments WHERE name='Finance'),(SELECT id FROM positions WHERE title='Director'),TRUE,FALSE,2),
('Strategic Development / Client Relationship Manager',(SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),(SELECT id FROM positions WHERE title='Director'),TRUE,FALSE,3);

-- Under Operations Manager
INSERT INTO positions (title,department_id,parent_position_id,is_active,is_vacant,sort_order) VALUES
('Service Delivery Manager',(SELECT id FROM departments WHERE name='Operations'),(SELECT id FROM positions WHERE title='Operations Manager'),TRUE,FALSE,1),
('Support Coordination Lead',(SELECT id FROM departments WHERE name='Operations'),(SELECT id FROM positions WHERE title='Operations Manager'),TRUE,FALSE,2),
('HR / Admin Officer',(SELECT id FROM departments WHERE name='Operations'),(SELECT id FROM positions WHERE title='Operations Manager'),TRUE,FALSE,3),
('Day Centre Officer',(SELECT id FROM departments WHERE name='Operations'),(SELECT id FROM positions WHERE title='Operations Manager'),TRUE,FALSE,4);

-- Under Service Delivery Manager
INSERT INTO positions (title,department_id,parent_position_id,is_active,is_vacant,sort_order) VALUES
('Roster Coordinator',(SELECT id FROM departments WHERE name='Operations'),(SELECT id FROM positions WHERE title='Service Delivery Manager'),TRUE,FALSE,1);

-- Under Support Coordination Lead
INSERT INTO positions (title,department_id,parent_position_id,is_active,is_vacant,sort_order) VALUES
('Support Coordination Staff',(SELECT id FROM departments WHERE name='Operations'),(SELECT id FROM positions WHERE title='Support Coordination Lead'),TRUE,FALSE,1);

-- Vacant leaves
INSERT INTO positions (title,department_id,parent_position_id,is_active,is_vacant,sort_order) VALUES
('Support Workers',(SELECT id FROM departments WHERE name='Operations'),(SELECT id FROM positions WHERE title='Roster Coordinator'),FALSE,TRUE,1),
('External Consultant (HR)',(SELECT id FROM departments WHERE name='Operations'),(SELECT id FROM positions WHERE title='HR / Admin Officer'),FALSE,TRUE,1),
('Staff (Day Centre)',(SELECT id FROM departments WHERE name='Operations'),(SELECT id FROM positions WHERE title='Day Centre Officer'),FALSE,TRUE,1),
('Plan Manager',(SELECT id FROM departments WHERE name='Finance'),(SELECT id FROM positions WHERE title='Finance Manager'),TRUE,FALSE,1),
('External Consultant (Finance)',(SELECT id FROM departments WHERE name='Finance'),(SELECT id FROM positions WHERE title='Finance Manager'),FALSE,TRUE,2),
('Business Development Officer',(SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),(SELECT id FROM positions WHERE title='Strategic Development / Client Relationship Manager'),FALSE,TRUE,1),
('Client Relationship Officer',(SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),(SELECT id FROM positions WHERE title='Strategic Development / Client Relationship Manager'),FALSE,TRUE,2),
('External Marketing Consultant',(SELECT id FROM departments WHERE name='Strategic Development & Client Relations'),(SELECT id FROM positions WHERE title='Business Development Officer'),FALSE,TRUE,1);

-- ── 7. Assign positions + managers ───────────────────────────
UPDATE users SET position_id=(SELECT id FROM positions WHERE title='Director'),
  department_id=(SELECT id FROM departments WHERE name='Director Level')
WHERE email='alex@yahwehpc.com.au';

UPDATE users SET position_id=(SELECT id FROM positions WHERE title='Operations Manager'),
  department_id=(SELECT id FROM departments WHERE name='Operations'),
  manager_id=(SELECT id FROM users WHERE email='alex@yahwehpc.com.au')
WHERE email='suganty@yahwehpc.com.au';

UPDATE users SET position_id=(SELECT id FROM positions WHERE title='Service Delivery Manager'),
  department_id=(SELECT id FROM departments WHERE name='Operations'),
  manager_id=(SELECT id FROM users WHERE email='suganty@yahwehpc.com.au')
WHERE email='sunny@yahwehcare.com.au';

UPDATE users SET position_id=(SELECT id FROM positions WHERE title='Roster Coordinator'),
  department_id=(SELECT id FROM departments WHERE name='Operations'),
  manager_id=(SELECT id FROM users WHERE email='sunny@yahwehcare.com.au')
WHERE email='elenor@yahwehcare.com.au';

UPDATE users SET position_id=(SELECT id FROM positions WHERE title='Support Coordination Lead'),
  department_id=(SELECT id FROM departments WHERE name='Operations'),
  manager_id=(SELECT id FROM users WHERE email='suganty@yahwehpc.com.au')
WHERE email='saloni@yahwehcare.com.au';

UPDATE users SET position_id=(SELECT id FROM positions WHERE title='Support Coordination Staff'),
  department_id=(SELECT id FROM departments WHERE name='Operations'),
  manager_id=(SELECT id FROM users WHERE email='saloni@yahwehcare.com.au')
WHERE email='james@yahwehcare.com.au';

UPDATE users SET position_id=(SELECT id FROM positions WHERE title='HR / Admin Officer'),
  department_id=(SELECT id FROM departments WHERE name='Operations'),
  manager_id=(SELECT id FROM users WHERE email='suganty@yahwehpc.com.au')
WHERE email='miejkyla@yahwehcare.com.au';

UPDATE users SET position_id=(SELECT id FROM positions WHERE title='Day Centre Officer'),
  department_id=(SELECT id FROM departments WHERE name='Operations'),
  manager_id=(SELECT id FROM users WHERE email='suganty@yahwehpc.com.au')
WHERE email='venujah@yahwehcare.com.au';

UPDATE users SET position_id=(SELECT id FROM positions WHERE title='Finance Manager'),
  department_id=(SELECT id FROM departments WHERE name='Finance'),
  manager_id=(SELECT id FROM users WHERE email='alex@yahwehpc.com.au')
WHERE email='akila@yahwehcare.com.au';

-- ── 8. Recreate org chart view ────────────────────────────────
DROP VIEW IF EXISTS v_org_chart;
CREATE VIEW v_org_chart AS
SELECT p.id,p.title,p.parent_position_id,p.is_active,p.is_vacant,p.sort_order,p.department_id,
  d.name AS department_name,
  u.id AS user_id, u.name AS user_name, u.email AS user_email,
  u.profile_photo_url, u.avatar_initials, u.role,
  COALESCE(u.is_bootstrap_admin,u.bootstrap_admin,FALSE) AS is_bootstrap_admin, u.designation
FROM positions p
LEFT JOIN departments d ON d.id=p.department_id
LEFT JOIN users u ON u.position_id=p.id AND u.active=TRUE
LEFT JOIN users m ON m.id=u.manager_id;

-- ── 9. Verify ────────────────────────────────────────────────
SELECT u.name, u.email, u.role, u.designation, u.department,
  p.title AS position, m.name AS reports_to,
  CASE WHEN u.active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status
FROM users u
LEFT JOIN positions p ON p.id=u.position_id
LEFT JOIN users m ON m.id=u.manager_id
ORDER BY u.role, u.department NULLS LAST, u.name;
