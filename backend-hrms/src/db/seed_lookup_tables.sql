-- ============================================================
-- Seed categories, priorities, and statuses lookup tables
-- Safe to re-run — uses ON CONFLICT DO NOTHING
-- ============================================================

SET search_path = yc_tkt_mgmt;

-- Categories
INSERT INTO categories (id, label, icon, sort_order) VALUES
  ('client',    'Client Issue',     'user',      1),
  ('account',   'Account Issue',    'key',       2),
  ('hr',        'HR Issue',         'users',     3),
  ('cleaning',  'Cleaning Quality', 'star',      4),
  ('safety',    'Safety Concern',   'shield',    5),
  ('equipment', 'Equipment Issue',  'tool',      6),
  ('ndis',      'NDIS Compliance',  'clipboard', 7)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Priorities
INSERT INTO priorities (id, label, sla_hours, sort_order) VALUES
  ('urgent', 'Urgent', 2,  1),
  ('high',   'High',   8,  2),
  ('medium', 'Medium', 24, 3),
  ('low',    'Low',    72, 4)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, sla_hours = EXCLUDED.sla_hours;

-- Statuses
INSERT INTO statuses (id, label, sort_order, is_closed) VALUES
  ('open',             'Open',             1, FALSE),
  ('in_progress',      'In Progress',      2, FALSE),
  ('escalated',        'Escalated',        3, FALSE),
  ('pending_approval', 'Pending Approval', 4, FALSE),
  ('resolved',         'Resolved',         5, FALSE),
  ('closed',           'Closed',           6, TRUE)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, is_closed = EXCLUDED.is_closed;

SELECT 'Done — categories, priorities, and statuses seeded.' AS result;
