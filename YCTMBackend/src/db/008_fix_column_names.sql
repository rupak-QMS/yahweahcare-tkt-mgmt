-- Migration 008: Fix column name mismatches
-- parent_id → parent_position_id on positions
-- Seed hierarchy positions with correct column names
-- Date: 2026-06-05

SET search_path = yc_tkt_mgmt;

-- ── 1. Add parent_position_id column (the YCTMBackend code expects this) ──
ALTER TABLE yc_tkt_mgmt.positions
  ADD COLUMN IF NOT EXISTS parent_position_id INTEGER REFERENCES yc_tkt_mgmt.positions(id) ON DELETE SET NULL;

-- ── 2. Copy data from parent_id → parent_position_id ─────────────────────
UPDATE yc_tkt_mgmt.positions SET parent_position_id = parent_id WHERE parent_id IS NOT NULL AND parent_position_id IS NULL;

-- ── 3. Add is_vacant, is_active columns if missing ───────────────────────
ALTER TABLE yc_tkt_mgmt.positions
  ADD COLUMN IF NOT EXISTS is_vacant  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ── 4. Sync is_active/is_vacant based on current staff assignments ────────
-- Positions with a user assigned are active/not vacant
UPDATE yc_tkt_mgmt.positions p
SET is_vacant = FALSE
FROM yc_tkt_mgmt.staff_positions sp
WHERE sp.position_id = p.id;

-- ── 5. Seed hierarchy using parent_position_id ────────────────────────────
-- Director (root)
UPDATE yc_tkt_mgmt.positions SET parent_position_id = NULL WHERE title = 'Director' AND position_type = 'director';

-- Set Operations Manager parent → Director
UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Director' AND position_type = 'director' LIMIT 1)
WHERE title = 'Operations Manager';

-- Set Finance Manager parent → Director
UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Director' AND position_type = 'director' LIMIT 1)
WHERE title = 'Finance Manager';

-- Set Strategic Dev Manager parent → Director
UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Director' AND position_type = 'director' LIMIT 1)
WHERE title = 'Strategic Dev / Client Relationship Manager';

-- Ops children → Operations Manager
UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Operations Manager' LIMIT 1)
WHERE title IN ('Service Delivery Manager','Support Coordination Lead','HR / Admin Officer','Day Centre Officer');

-- Service Delivery Manager children
UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Service Delivery Manager' LIMIT 1)
WHERE title = 'Roster Coordinator';

UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Roster Coordinator' LIMIT 1)
WHERE title = 'Support Workers';

-- Support Coordination Lead children
UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Support Coordination Lead' LIMIT 1)
WHERE title = 'Support Coordination Staff';

-- HR / Admin Officer children
UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'HR / Admin Officer' LIMIT 1)
WHERE title = 'External Consultant (HR)';

-- Day Centre Officer children
UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Day Centre Officer' LIMIT 1)
WHERE title = 'Day Centre Staff';

-- Finance Manager children
UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Finance Manager' LIMIT 1)
WHERE title IN ('External Consultant (Finance)', 'Plan Manager');

-- Strategic children
UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Strategic Dev / Client Relationship Manager' LIMIT 1)
WHERE title IN ('Business Development Officer', 'Client Relationship Officer');

UPDATE yc_tkt_mgmt.positions
SET parent_position_id = (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Business Development Officer' LIMIT 1)
WHERE title = 'External Marketing Consultant';

-- ── 6. Set position_id on users based on staff_positions ─────────────────
-- This links the hrms backend (which uses users.position_id) to our data
UPDATE yc_tkt_mgmt.users u
SET position_id = sp.position_id
FROM yc_tkt_mgmt.staff_positions sp
WHERE sp.user_id = u.id AND sp.is_primary = TRUE AND u.position_id IS NULL;

-- Also set for non-primary if position_id still null
UPDATE yc_tkt_mgmt.users u
SET position_id = sp.position_id
FROM yc_tkt_mgmt.staff_positions sp
WHERE sp.user_id = u.id AND u.position_id IS NULL;

-- ── 7. Fix the org chart view to use is_active ────────────────────────────
CREATE OR REPLACE VIEW yc_tkt_mgmt.v_org_chart AS
SELECT
  u.id, u.name, u.email, u.is_active AS active,
  u.department_id, u.is_bootstrap_admin,
  p.id          AS position_id,
  p.title       AS position_title,
  p.is_vacant,
  p.parent_position_id,
  d.id          AS dept_id,
  d.name        AS department_name,
  m.id          AS manager_id,
  m.name        AS manager_name
FROM yc_tkt_mgmt.positions p
LEFT JOIN yc_tkt_mgmt.departments d ON d.id = p.department_id
LEFT JOIN yc_tkt_mgmt.users u       ON u.position_id = p.id AND u.is_active = TRUE
LEFT JOIN yc_tkt_mgmt.users m       ON m.id = u.manager_id;

-- ── 8. Create index on parent_position_id ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_positions_parent_pos ON yc_tkt_mgmt.positions(parent_position_id);
CREATE INDEX IF NOT EXISTS idx_users_pos_id         ON yc_tkt_mgmt.users(position_id);

-- Verify
SELECT title, parent_position_id, is_vacant,
       (SELECT u.name FROM yc_tkt_mgmt.users u WHERE u.position_id = p.id AND u.is_active = TRUE LIMIT 1) AS holder
FROM yc_tkt_mgmt.positions p
ORDER BY COALESCE(parent_position_id, 0), p.sort_order, p.id;
