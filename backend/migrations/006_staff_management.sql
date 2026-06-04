-- Migration 006: Staff Management System
-- Adds auth_provider, multi-position support, org hierarchy
-- Date: 2026-06-04

BEGIN;

-- ============================================================
-- 1. Extend users table
-- ============================================================
ALTER TABLE yc_tkt_mgmt.users
  ADD COLUMN IF NOT EXISTS auth_provider   TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS azure_oid       TEXT,
  ADD COLUMN IF NOT EXISTS phone           TEXT,
  ADD COLUMN IF NOT EXISTS employment_type TEXT DEFAULT 'full_time',
  ADD COLUMN IF NOT EXISTS is_bootstrap_admin BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS start_date      DATE,
  ADD COLUMN IF NOT EXISTS profile_notes   TEXT,
  ADD COLUMN IF NOT EXISTS manager_id      INTEGER REFERENCES yc_tkt_mgmt.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_azure_oid ON yc_tkt_mgmt.users(azure_oid) WHERE azure_oid IS NOT NULL;

-- ============================================================
-- 2. Extend positions table with hierarchy support
-- ============================================================
ALTER TABLE yc_tkt_mgmt.positions
  ADD COLUMN IF NOT EXISTS parent_id      INTEGER REFERENCES yc_tkt_mgmt.positions(id),
  ADD COLUMN IF NOT EXISTS position_type  TEXT DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS dept_label     TEXT,
  ADD COLUMN IF NOT EXISTS sort_order     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN DEFAULT TRUE;

-- ============================================================
-- 3. Staff → Positions many-to-many (one staff, many positions)
-- ============================================================
CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.staff_positions (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id) ON DELETE CASCADE,
    position_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.positions(id) ON DELETE CASCADE,
    is_primary  BOOLEAN DEFAULT FALSE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by INTEGER REFERENCES yc_tkt_mgmt.users(id),
    UNIQUE(user_id, position_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_user     ON yc_tkt_mgmt.staff_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_sp_position ON yc_tkt_mgmt.staff_positions(position_id);

-- ============================================================
-- 4. Seed departments
-- ============================================================
INSERT INTO yc_tkt_mgmt.departments (name, description) VALUES
  ('Director Level',                          'Executive leadership'),
  ('Operations',                              'Day-to-day operations and support'),
  ('Finance',                                 'Financial management and planning'),
  ('Strategic Development & Client Relations','Strategic initiatives and client management')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 5. Seed org chart hierarchy positions
-- ============================================================
DO $$
DECLARE
  d_dir  INTEGER; d_ops INTEGER; d_fin INTEGER; d_str INTEGER;
  p_dir  INTEGER;
  p_ops  INTEGER;
  p_sdm  INTEGER;
  p_rc   INTEGER;
  p_scl  INTEGER;
  p_hro  INTEGER;
  p_dco  INTEGER;
  p_fin  INTEGER;
  p_str  INTEGER;
  p_bdo  INTEGER;
BEGIN
  -- dept ids
  SELECT id INTO d_dir FROM yc_tkt_mgmt.departments WHERE name = 'Director Level';
  SELECT id INTO d_ops FROM yc_tkt_mgmt.departments WHERE name = 'Operations';
  SELECT id INTO d_fin FROM yc_tkt_mgmt.departments WHERE name = 'Finance';
  SELECT id INTO d_str FROM yc_tkt_mgmt.departments WHERE name = 'Strategic Development & Client Relations';

  -- Director (root)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Director', '👤 Director', 'director', d_dir, NULL, 0, TRUE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO p_dir FROM yc_tkt_mgmt.positions WHERE title='Director' AND position_type='director';

  -- Operations Manager
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Operations Manager', '👥 Operations Department', 'ops', d_ops, p_dir, 1, TRUE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO p_ops FROM yc_tkt_mgmt.positions WHERE title='Operations Manager' AND department_id=d_ops AND parent_id=p_dir;

  -- Service Delivery Manager (under Ops)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Service Delivery Manager', NULL, 'ops', d_ops, p_ops, 1, TRUE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO p_sdm FROM yc_tkt_mgmt.positions WHERE title='Service Delivery Manager' AND parent_id=p_ops;

  -- Roster Coordinator (under SDM)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Roster Coordinator', NULL, 'ops', d_ops, p_sdm, 1, TRUE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO p_rc FROM yc_tkt_mgmt.positions WHERE title='Roster Coordinator' AND parent_id=p_sdm;

  -- Support Workers (under RC) - typically vacant
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Support Workers', NULL, 'staff', d_ops, p_rc, 1, TRUE)
  ON CONFLICT DO NOTHING;

  -- Support Coordination Lead (under Ops)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Support Coordination Lead', NULL, 'ops', d_ops, p_ops, 2, TRUE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO p_scl FROM yc_tkt_mgmt.positions WHERE title='Support Coordination Lead' AND parent_id=p_ops;

  -- Support Coordination Staff (under SCL)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Support Coordination Staff', NULL, 'ops', d_ops, p_scl, 1, TRUE)
  ON CONFLICT DO NOTHING;

  -- HR / Admin Officer (under Ops)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('HR / Admin Officer', NULL, 'ops', d_ops, p_ops, 3, TRUE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO p_hro FROM yc_tkt_mgmt.positions WHERE title='HR / Admin Officer' AND parent_id=p_ops;

  -- External Consultant under HR
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('External Consultant (HR)', NULL, 'external', d_ops, p_hro, 1, TRUE)
  ON CONFLICT DO NOTHING;

  -- Day Centre Officer (under Ops)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Day Centre Officer', NULL, 'ops', d_ops, p_ops, 4, TRUE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO p_dco FROM yc_tkt_mgmt.positions WHERE title='Day Centre Officer' AND parent_id=p_ops;

  -- Staff (Day Centre) vacant
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Day Centre Staff', NULL, 'staff', d_ops, p_dco, 1, TRUE)
  ON CONFLICT DO NOTHING;

  -- Finance Manager (under Director)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Finance Manager', '💰 Finance Department', 'finance', d_fin, p_dir, 2, TRUE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO p_fin FROM yc_tkt_mgmt.positions WHERE title='Finance Manager' AND department_id=d_fin AND parent_id=p_dir;

  -- External Consultant under Finance
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('External Consultant (Finance)', NULL, 'external', d_fin, p_fin, 1, TRUE)
  ON CONFLICT DO NOTHING;

  -- Plan Manager under Finance
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Plan Manager', NULL, 'finance', d_fin, p_fin, 2, TRUE)
  ON CONFLICT DO NOTHING;

  -- Strategic Dev Manager (under Director)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Strategic Dev / Client Relationship Manager', '🏢 Strategic Dev & Client Relationship', 'strategic', d_str, p_dir, 3, TRUE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO p_str FROM yc_tkt_mgmt.positions WHERE title='Strategic Dev / Client Relationship Manager' AND parent_id=p_dir;

  -- Business Development Officer (under Strategic)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Business Development Officer', NULL, 'strategic', d_str, p_str, 1, TRUE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO p_bdo FROM yc_tkt_mgmt.positions WHERE title='Business Development Officer' AND parent_id=p_str;

  -- External Marketing Consultant (under BDO)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('External Marketing Consultant', NULL, 'external', d_str, p_bdo, 1, TRUE)
  ON CONFLICT DO NOTHING;

  -- Client Relationship Officer (under Strategic)
  INSERT INTO yc_tkt_mgmt.positions (title, dept_label, position_type, department_id, parent_id, sort_order, is_active)
  VALUES ('Client Relationship Officer', NULL, 'strategic', d_str, p_str, 2, TRUE)
  ON CONFLICT DO NOTHING;

END $$;

-- ============================================================
-- 6. Seed initial staff + assign to org positions
-- ============================================================
DO $$
DECLARE
  u_alex    INTEGER; u_suganty INTEGER; u_sunita  INTEGER;
  u_elenor  INTEGER; u_saloni  INTEGER; u_james   INTEGER;
  u_miejkyla INTEGER; u_venujah INTEGER; u_akila  INTEGER;
  u_ron     INTEGER;
  p_dir     INTEGER; p_ops  INTEGER; p_sdm  INTEGER;
  p_rc      INTEGER; p_scl  INTEGER; p_scs  INTEGER;
  p_hro     INTEGER; p_dco  INTEGER;
  p_fin     INTEGER; p_pm   INTEGER;
  p_str     INTEGER;
BEGIN
  -- Insert core staff (idempotent)
  INSERT INTO yc_tkt_mgmt.users (name, email, auth_provider, is_bootstrap_admin, employment_type, is_active)
  VALUES ('Alex', 'alex@yahwehpc.com.au', 'local', TRUE, 'full_time', TRUE)
  ON CONFLICT (email) DO UPDATE SET is_bootstrap_admin=TRUE, auth_provider='local';

  INSERT INTO yc_tkt_mgmt.users (name, email, auth_provider, employment_type, is_active)
  VALUES
    ('Suganty P',          'suganty@yahwehpc.com.au',    'azure_ad', 'full_time', TRUE),
    ('Sunita Maharjan',    'sunny@yahwehcare.com.au',     'azure_ad', 'full_time', TRUE),
    ('Elenor Elia',        'elenor@yahwehcare.com.au',    'azure_ad', 'full_time', TRUE),
    ('Saloni',             'saloni@yahwehcare.com.au',    'azure_ad', 'full_time', TRUE),
    ('James Baskaran',     'james@yahwehcare.com.au',     'azure_ad', 'full_time', TRUE),
    ('Miejkyla',           'miejkyla@yahwehcare.com.au',  'azure_ad', 'full_time', TRUE),
    ('Venujah Arudselvam', 'venujah@yahwehcare.com.au',   'azure_ad', 'full_time', TRUE),
    ('Akila Nanayakkara',  'akila@yahwehcare.com.au',     'azure_ad', 'full_time', TRUE),
    ('Ron Costa',          'it@yahwehcare.com.au',        'local', 'full_time',    TRUE)
  ON CONFLICT (email) DO UPDATE SET is_active = TRUE;

  UPDATE yc_tkt_mgmt.users SET is_bootstrap_admin=TRUE WHERE email='it@yahwehcare.com.au';

  -- Get user IDs
  SELECT id INTO u_alex    FROM yc_tkt_mgmt.users WHERE email='alex@yahwehpc.com.au';
  SELECT id INTO u_suganty FROM yc_tkt_mgmt.users WHERE email='suganty@yahwehpc.com.au';
  SELECT id INTO u_sunita  FROM yc_tkt_mgmt.users WHERE email='sunny@yahwehcare.com.au';
  SELECT id INTO u_elenor  FROM yc_tkt_mgmt.users WHERE email='elenor@yahwehcare.com.au';
  SELECT id INTO u_saloni  FROM yc_tkt_mgmt.users WHERE email='saloni@yahwehcare.com.au';
  SELECT id INTO u_james   FROM yc_tkt_mgmt.users WHERE email='james@yahwehcare.com.au';
  SELECT id INTO u_miejkyla FROM yc_tkt_mgmt.users WHERE email='miejkyla@yahwehcare.com.au';
  SELECT id INTO u_venujah FROM yc_tkt_mgmt.users WHERE email='venujah@yahwehcare.com.au';
  SELECT id INTO u_akila   FROM yc_tkt_mgmt.users WHERE email='akila@yahwehcare.com.au';

  -- Get position IDs
  SELECT id INTO p_dir  FROM yc_tkt_mgmt.positions WHERE title='Director'                              AND position_type='director';
  SELECT id INTO p_ops  FROM yc_tkt_mgmt.positions WHERE title='Operations Manager'                    AND position_type='ops';
  SELECT id INTO p_sdm  FROM yc_tkt_mgmt.positions WHERE title='Service Delivery Manager'              AND position_type='ops';
  SELECT id INTO p_rc   FROM yc_tkt_mgmt.positions WHERE title='Roster Coordinator'                    AND position_type='ops';
  SELECT id INTO p_scl  FROM yc_tkt_mgmt.positions WHERE title='Support Coordination Lead'             AND position_type='ops';
  SELECT id INTO p_scs  FROM yc_tkt_mgmt.positions WHERE title='Support Coordination Staff'            AND position_type='ops';
  SELECT id INTO p_hro  FROM yc_tkt_mgmt.positions WHERE title='HR / Admin Officer'                    AND position_type='ops';
  SELECT id INTO p_dco  FROM yc_tkt_mgmt.positions WHERE title='Day Centre Officer'                    AND position_type='ops';
  SELECT id INTO p_fin  FROM yc_tkt_mgmt.positions WHERE title='Finance Manager'                       AND position_type='finance';
  SELECT id INTO p_pm   FROM yc_tkt_mgmt.positions WHERE title='Plan Manager'                          AND position_type='finance';
  SELECT id INTO p_str  FROM yc_tkt_mgmt.positions WHERE title='Strategic Dev / Client Relationship Manager' AND position_type='strategic';

  -- Assign staff to positions
  INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES
    (u_alex,     p_dir,  TRUE),
    (u_alex,     p_str,  FALSE),  -- Alex holds both Director AND Strategic Dev roles
    (u_suganty,  p_ops,  TRUE),
    (u_sunita,   p_sdm,  TRUE),
    (u_elenor,   p_rc,   TRUE),
    (u_saloni,   p_scl,  TRUE),
    (u_james,    p_scs,  TRUE),
    (u_miejkyla, p_hro,  TRUE),
    (u_venujah,  p_dco,  TRUE),
    (u_akila,    p_fin,  TRUE),
    (u_akila,    p_pm,   FALSE)   -- Akila holds both Finance Manager AND Plan Manager
  ON CONFLICT (user_id, position_id) DO NOTHING;

END $$;

COMMIT;
