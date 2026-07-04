-- ============================================================
-- POST_RESET_RECOVERY.sql
--
-- WHY THIS FILE EXISTS
-- ---------------------
-- YCTMBackend (the real production API) has never had an automated
-- migration runner. Schema changes were historically applied by hand,
-- one .sql file at a time, directly against the Neon database:
--   approval_workflow_migration.sql
--   escalation_migration.sql
--   008_fix_column_names.sql
--   seed_lookup_tables.sql
-- None of these are referenced anywhere in application code or CI --
-- they only ran because a developer opened them and executed them
-- manually at some point in the past.
--
-- After the 2026-07-02/03 data-loss incident (api/run-migrations.js
-- re-running the destructive 000_reset_schema.sql -- see that runner's
-- comments and api/migrations/DANGEROUS_full_reset_do_not_run_manual_only.sql),
-- the base schema was rebuilt, but these four one-off patches had never
-- been re-applied. That silently broke, in production, until caught by
-- a full end-to-end verification pass on 2026-07-03:
--   - POST /tickets (ticket creation) -- tickets.expected_completion and
--     pending_approval_at columns were missing, so every create failed.
--   - POST /tickets/:id/escalate -- is_escalated/escalated_to/escalated_by/
--     escalated_at/escalation_reason columns and the ticket_escalations
--     table were missing, so escalation failed.
--   - Org chart / position hierarchy -- positions.parent_position_id,
--     is_vacant, updated_at were missing, so org.routes.ts (which reads
--     parent_position_id) could not build the reporting hierarchy even
--     though positions existed with the legacy parent_id column.
--   - GET /lookup/all (category/priority/status dropdowns on the Create
--     Ticket form) -- yc_tkt_mgmt.categories/priorities/statuses were
--     completely empty. Ticket creation would have failed validation
--     ("category and priority are required") even after the columns
--     above were fixed.
--
-- WHEN TO RUN THIS
-- ----------------
-- Any time the yc_tkt_mgmt schema is rebuilt from a bare/partial state
-- (fresh environment, or recovery after another incident). Safe to run
-- multiple times -- every statement is idempotent (IF NOT EXISTS /
-- ON CONFLICT DO NOTHING/UPDATE / WHERE ... IS NULL guards).
--
-- This does NOT restore ticket data itself -- there is no seed source
-- for real ticket history. It only restores the schema shape and the
-- reference/lookup data every ticket depends on.
-- ============================================================

SET search_path TO yc_tkt_mgmt, public;

-- 1. Ticket approval workflow columns
ALTER TABLE yc_tkt_mgmt.tickets
  ADD COLUMN IF NOT EXISTS expected_completion DATE,
  ADD COLUMN IF NOT EXISTS pending_approval_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ticket_approvers_approver
  ON yc_tkt_mgmt.ticket_approvers(approver_user_id);

INSERT INTO yc_tkt_mgmt.statuses (id, label, sort_order, is_closed)
VALUES ('pending_approval', 'Pending Approval', 4, FALSE)
ON CONFLICT (id) DO NOTHING;

-- 2. Ticket escalation columns + history table
ALTER TABLE yc_tkt_mgmt.tickets
  ADD COLUMN IF NOT EXISTS is_escalated       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS escalated_to       INTEGER REFERENCES yc_tkt_mgmt.users(id),
  ADD COLUMN IF NOT EXISTS escalated_by       INTEGER REFERENCES yc_tkt_mgmt.users(id),
  ADD COLUMN IF NOT EXISTS escalated_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_reason  TEXT;

CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.ticket_escalations (
  id                SERIAL PRIMARY KEY,
  ticket_id         INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
  escalated_by      INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
  escalated_to      INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
  reason            TEXT NOT NULL,
  previous_assignee INTEGER REFERENCES yc_tkt_mgmt.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalations_ticket ON yc_tkt_mgmt.ticket_escalations(ticket_id);

-- 3. Position hierarchy column-name fix (parent_id -> parent_position_id)
ALTER TABLE yc_tkt_mgmt.positions
  ADD COLUMN IF NOT EXISTS parent_position_id INTEGER REFERENCES yc_tkt_mgmt.positions(id) ON DELETE SET NULL;

UPDATE yc_tkt_mgmt.positions
SET parent_position_id = parent_id
WHERE parent_id IS NOT NULL AND parent_position_id IS NULL;

ALTER TABLE yc_tkt_mgmt.positions
  ADD COLUMN IF NOT EXISTS is_vacant  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE yc_tkt_mgmt.positions p
SET is_vacant = FALSE
FROM yc_tkt_mgmt.staff_positions sp
WHERE sp.position_id = p.id;

UPDATE yc_tkt_mgmt.users u
SET position_id = sp.position_id
FROM yc_tkt_mgmt.staff_positions sp
WHERE sp.user_id = u.id AND sp.is_primary = TRUE AND u.position_id IS NULL;

UPDATE yc_tkt_mgmt.users u
SET position_id = sp.position_id
FROM yc_tkt_mgmt.staff_positions sp
WHERE sp.user_id = u.id AND u.position_id IS NULL;

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

CREATE INDEX IF NOT EXISTS idx_positions_parent_pos ON yc_tkt_mgmt.positions(parent_position_id);
CREATE INDEX IF NOT EXISTS idx_users_pos_id         ON yc_tkt_mgmt.users(position_id);

-- 4. Create-ticket dropdown data (categories / priorities / statuses)
-- These must match app/seed-enterprise.js exactly -- the frontend Create
-- Ticket form hardcodes these labels/icons for display.
INSERT INTO yc_tkt_mgmt.categories (id, label, icon, sort_order) VALUES
  ('it',         'IT Support',               '💻', 1),
  ('hr',         'HR & Payroll',             '👥', 2),
  ('facilities', 'Facilities & Maintenance', '🔧', 3),
  ('care',       'Care Coordination',        '🤝', 4),
  ('clinical',   'Clinical / Compliance',    '🩺', 5),
  ('finance',    'Finance',                  '💰', 6),
  ('general',    'General Enquiry',          '💬', 7)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order;

INSERT INTO yc_tkt_mgmt.priorities (id, label, sla_hours, sort_order) VALUES
  ('critical', 'Critical', 2,  1),
  ('high',     'High',     8,  2),
  ('medium',   'Medium',   24, 3),
  ('low',      'Low',      72, 4)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, sla_hours = EXCLUDED.sla_hours, sort_order = EXCLUDED.sort_order;

INSERT INTO yc_tkt_mgmt.statuses (id, label, sort_order, is_closed) VALUES
  ('new',         'New',                  1, FALSE),
  ('assigned',    'Assigned',             2, FALSE),
  ('in_progress', 'In Progress',          3, FALSE),
  ('waiting',     'Waiting on Requester', 4, FALSE),
  ('resolved',    'Resolved',             5, TRUE),
  ('closed',      'Closed',               6, TRUE)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, is_closed = EXCLUDED.is_closed, sort_order = EXCLUDED.sort_order;

SELECT 'POST_RESET_RECOVERY complete.' AS result,
       (SELECT count(*) FROM yc_tkt_mgmt.categories) AS categories,
       (SELECT count(*) FROM yc_tkt_mgmt.priorities) AS priorities,
       (SELECT count(*) FROM yc_tkt_mgmt.statuses)   AS statuses;

-- 5. Org Chart page columns (GET /org/chart was crashing with a 500 --
--    "column does not exist" -- confirmed 2026-07-03 by the empty response
--    body from a fresh, cache-busted fetch, then root-caused by diffing the
--    query in org.routes.ts against live information_schema.columns).
-- users.profile_photo_url / avatar_initials / designation are selected by
-- GET /org/chart and referenced by POST /users, but were missing entirely.
ALTER TABLE yc_tkt_mgmt.users
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS avatar_initials   TEXT,
  ADD COLUMN IF NOT EXISTS designation       TEXT;

UPDATE yc_tkt_mgmt.users
SET avatar_initials = UPPER(LEFT(split_part(name, ' ', 1), 1) || COALESCE(LEFT(split_part(name, ' ', 2), 1), ''))
WHERE avatar_initials IS NULL;

-- departments.parent_dept_id / sort_order are selected by GET /org/chart
-- and GET/POST /org/departments, but were also missing.
ALTER TABLE yc_tkt_mgmt.departments
  ADD COLUMN IF NOT EXISTS parent_dept_id INTEGER REFERENCES yc_tkt_mgmt.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order     INTEGER DEFAULT 0;

-- 6. Orphaned staff_positions rows (referencing users deleted before the
--    2026-07-02/03 incident) were causing positions to render more than
--    once on the org chart / position list. Safe to delete: they can never
--    resolve to a valid user again.
DELETE FROM yc_tkt_mgmt.staff_positions sp
WHERE NOT EXISTS (SELECT 1 FROM yc_tkt_mgmt.users u WHERE u.id = sp.user_id);

UPDATE yc_tkt_mgmt.positions p
SET is_vacant = NOT EXISTS (
  SELECT 1 FROM yc_tkt_mgmt.staff_positions sp2
  JOIN yc_tkt_mgmt.users u2 ON u2.id = sp2.user_id AND u2.is_active = TRUE
  WHERE sp2.position_id = p.id
);
