-- ============================================================
-- Seed permissions and role_permissions into live Neon DB
-- Safe to re-run — uses ON CONFLICT DO NOTHING
-- ============================================================

SET search_path = yc_tkt_mgmt;

-- ── 1. Upsert roles ─────────────────────────────────────────
INSERT INTO roles (name, display_name, description, rank, is_system) VALUES
  ('super_admin', 'Super Admin',  'Full system access',                      1, TRUE),
  ('admin',       'Admin',        'Administrative access',                    2, TRUE),
  ('hr',          'HR',           'Human Resources access',                   3, TRUE),
  ('manager',     'Manager',      'Team management access',                   4, TRUE),
  ('user',        'User',         'Standard user — can raise their own tickets', 5, TRUE)
ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name, rank = EXCLUDED.rank;

-- ── 2. Upsert all permissions ────────────────────────────────
INSERT INTO permissions (name, module, description) VALUES
  ('user.read',           'users',       'View user list and profiles'),
  ('user.create',         'users',       'Create new user accounts'),
  ('user.update',         'users',       'Update user details'),
  ('user.delete',         'users',       'Delete user accounts'),
  ('user.activate',       'users',       'Activate/deactivate users'),
  ('role.read',           'roles',       'View roles and permissions'),
  ('role.assign',         'roles',       'Assign roles to users'),
  ('role.manage',         'roles',       'Create/modify role definitions'),
  ('permission.manage',   'permissions', 'Grant/revoke permissions on roles'),
  ('settings.read',       'settings',    'View HRMS settings'),
  ('settings.update',     'settings',    'Modify HRMS settings'),
  ('authsettings.manage', 'settings',    'Manage authentication settings'),
  ('audit.read',          'audit',       'View audit logs'),
  ('audit.export',        'audit',       'Export audit logs'),
  ('ticket.read.own',     'tickets',     'View own tickets'),
  ('ticket.read.team',    'tickets',     'View team tickets'),
  ('ticket.read.all',     'tickets',     'View all tickets'),
  ('ticket.create',       'tickets',     'Create tickets'),
  ('ticket.update',       'tickets',     'Update tickets'),
  ('ticket.delete',       'tickets',     'Delete tickets'),
  ('ticket.assign',       'tickets',     'Assign tickets'),
  ('employee.read',       'employees',   'Read employee profiles'),
  ('employee.update',     'employees',   'Update employee profiles'),
  ('report.read',         'reports',     'View dashboards and reports'),
  ('report.schedule',     'reports',     'Schedule recurring reports')
ON CONFLICT (name) DO NOTHING;

-- ── 3. Wire role → permissions ───────────────────────────────
-- super_admin gets everything
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- admin
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN (
    'user.read','user.create','user.update','user.activate',
    'role.read','role.assign',
    'settings.read','settings.update',
    'audit.read','audit.export',
    'ticket.read.all','ticket.create','ticket.update','ticket.assign','ticket.delete',
    'employee.read','employee.update',
    'report.read','report.schedule'
  )
  WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- hr
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN (
    'user.read','user.update','user.activate',
    'employee.read','employee.update',
    'ticket.read.all','ticket.create','ticket.update','ticket.assign',
    'report.read','audit.read'
  )
  WHERE r.name = 'hr'
ON CONFLICT DO NOTHING;

-- manager
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN (
    'user.read',
    'employee.read',
    'ticket.read.team','ticket.create','ticket.update','ticket.assign',
    'report.read'
  )
  WHERE r.name = 'manager'
ON CONFLICT DO NOTHING;

-- user (employee)
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN (
    'ticket.read.own','ticket.create'
  )
  WHERE r.name = 'user'
ON CONFLICT DO NOTHING;

-- ── 4. Make sure all existing users have the correct role_id ─
UPDATE users u
SET role_id = r.id
FROM roles r
WHERE r.name = u.role
  AND (u.role_id IS NULL OR u.role_id != r.id);

SELECT 'Done — permissions seeded and role_permissions wired.' AS result;
