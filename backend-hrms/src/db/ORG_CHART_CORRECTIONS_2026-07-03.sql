-- ============================================================
-- Org chart corrections to match the authoritative chart Ron provided
-- on 2026-07-03. This is a one-time DATA correction (not a schema
-- migration) -- re-running it is safe (idempotent) but it should not
-- need to run again unless the org structure is reset.
-- ============================================================

SET search_path TO yc_tkt_mgmt, public;

-- Sunita Maharjan does not appear in the authoritative chart and Service
-- Delivery Manager should be vacant, not held by her. Unassign her from
-- that position; her user account remains active, just without an org
-- position (same pattern as Ron Costa -- system user, not in the chart).
DELETE FROM yc_tkt_mgmt.staff_positions WHERE user_id = 6 AND position_id = 5;
UPDATE yc_tkt_mgmt.users SET position_id = NULL WHERE id = 6 AND position_id = 5;

-- Vacant positions shown on the authoritative chart that didn't exist yet.
INSERT INTO yc_tkt_mgmt.positions (title, parent_position_id, position_type, sort_order, is_active, is_vacant)
VALUES ('External Consultant', 3, 'external', 3, TRUE, TRUE)
ON CONFLICT (title) DO NOTHING;

INSERT INTO yc_tkt_mgmt.positions (title, parent_position_id, position_type, sort_order, is_active, is_vacant)
VALUES ('Business Development Officer', 4, 'strategic', 4, TRUE, TRUE)
ON CONFLICT (title) DO NOTHING;

INSERT INTO yc_tkt_mgmt.positions (title, parent_position_id, position_type, sort_order, is_active, is_vacant)
VALUES ('Client Relationship Officer', 4, 'strategic', 5, TRUE, TRUE)
ON CONFLICT (title) DO NOTHING;

INSERT INTO yc_tkt_mgmt.positions (title, parent_position_id, position_type, sort_order, is_active, is_vacant)
VALUES ('External Marketing Consultant',
        (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Business Development Officer' LIMIT 1),
        'strategic', 1, TRUE, TRUE)
ON CONFLICT (title) DO NOTHING;

INSERT INTO yc_tkt_mgmt.positions (title, parent_position_id, position_type, sort_order, is_active, is_vacant)
VALUES ('Support Workers', 9, 'staff', 1, TRUE, TRUE)
ON CONFLICT (title) DO NOTHING;

-- Note: positions.title has a UNIQUE constraint, so the second "External
-- Consultant" branch (under Support Coordination Staff, distinct from the
-- one under Finance Manager) is stored with a disambiguating title.
INSERT INTO yc_tkt_mgmt.positions (title, parent_position_id, position_type, sort_order, is_active, is_vacant)
VALUES ('External Consultant (Support Coordination)', 10, 'external', 1, TRUE, TRUE)
ON CONFLICT (title) DO NOTHING;

-- Recompute vacancy flags for every position.
UPDATE yc_tkt_mgmt.positions p
SET is_vacant = NOT EXISTS (
  SELECT 1 FROM yc_tkt_mgmt.staff_positions sp2
  JOIN yc_tkt_mgmt.users u2 ON u2.id = sp2.user_id AND u2.is_active = TRUE
  WHERE sp2.position_id = p.id
),
updated_at = NOW();
