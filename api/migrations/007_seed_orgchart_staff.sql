-- Migration 007: Seed all staff from the Yahweh Care Org Chart
-- Idempotent — safe to run multiple times
-- Date: 2026-06-04

BEGIN;

SET search_path TO yc_tkt_mgmt, public;

-- ============================================================
-- 1. Ensure departments exist
-- ============================================================
INSERT INTO yc_tkt_mgmt.departments (name, description) VALUES
  ('Director Level',                           'Executive leadership'),
  ('Operations',                               'Day-to-day operations and support'),
  ('Finance',                                  'Financial management and planning'),
  ('Strategic Development & Client Relations', 'Strategic initiatives and client management')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 2. Upsert all staff from org chart
-- ============================================================
INSERT INTO yc_tkt_mgmt.users
  (name, email, auth_provider, is_bootstrap_admin, employment_type, is_active, department_id)
VALUES
  ('Alex',              'alex@yahwehpc.com.au',   'local',    TRUE,  'full_time', TRUE,
     (SELECT id FROM yc_tkt_mgmt.departments WHERE name='Director Level')),
  ('Ron Costa',         'it@yahwehcare.com.au',   'local',    TRUE,  'full_time', TRUE,
     (SELECT id FROM yc_tkt_mgmt.departments WHERE name='Director Level')),
  ('Suganty P',          'suganty@yahwehpc.com.au',   'azure_ad', FALSE, 'full_time', TRUE,
     (SELECT id FROM yc_tkt_mgmt.departments WHERE name='Operations')),
  ('Sunita Maharjan',    'sunny@yahwehcare.com.au',    'azure_ad', FALSE, 'full_time', TRUE,
     (SELECT id FROM yc_tkt_mgmt.departments WHERE name='Operations')),
  ('Elenor Elia',        'elenor@yahwehcare.com.au',   'azure_ad', FALSE, 'full_time', TRUE,
     (SELECT id FROM yc_tkt_mgmt.departments WHERE name='Operations')),
  ('Saloni',             'saloni@yahwehcare.com.au',   'azure_ad', FALSE, 'full_time', TRUE,
     (SELECT id FROM yc_tkt_mgmt.departments WHERE name='Operations')),
  ('James Baskaran',     'james@yahwehcare.com.au',    'azure_ad', FALSE, 'full_time', TRUE,
     (SELECT id FROM yc_tkt_mgmt.departments WHERE name='Operations')),
  ('Miejkyla',           'miejkyla@yahwehcare.com.au', 'azure_ad', FALSE, 'full_time', TRUE,
     (SELECT id FROM yc_tkt_mgmt.departments WHERE name='Operations')),
  ('Venujah Arudselvam', 'venujah@yahwehcare.com.au',  'azure_ad', FALSE, 'full_time', TRUE,
     (SELECT id FROM yc_tkt_mgmt.departments WHERE name='Operations')),
  ('Akila Nanayakkara',  'akila@yahwehcare.com.au',    'azure_ad', FALSE, 'full_time', TRUE,
     (SELECT id FROM yc_tkt_mgmt.departments WHERE name='Finance'))
ON CONFLICT (email) DO UPDATE SET
  name               = EXCLUDED.name,
  auth_provider      = EXCLUDED.auth_provider,
  is_bootstrap_admin = EXCLUDED.is_bootstrap_admin,
  employment_type    = EXCLUDED.employment_type,
  is_active          = TRUE,
  department_id      = EXCLUDED.department_id;

-- ============================================================
-- 3. Assign org chart positions to staff
--    Clears existing assignments first to avoid stale data
-- ============================================================
DO $$
DECLARE
  u_alex     INTEGER; u_suganty  INTEGER; u_sunita   INTEGER;
  u_elenor   INTEGER; u_saloni   INTEGER; u_james    INTEGER;
  u_miejkyla INTEGER; u_venujah  INTEGER; u_akila    INTEGER;

  p_dir  INTEGER; p_ops  INTEGER; p_sdm  INTEGER; p_rc  INTEGER;
  p_scl  INTEGER; p_scs  INTEGER; p_hro  INTEGER; p_dco INTEGER;
  p_fin  INTEGER; p_pm   INTEGER; p_str  INTEGER;
BEGIN
  -- Get user IDs
  SELECT id INTO u_alex     FROM yc_tkt_mgmt.users WHERE email='alex@yahwehpc.com.au';
  SELECT id INTO u_suganty  FROM yc_tkt_mgmt.users WHERE email='suganty@yahwehpc.com.au';
  SELECT id INTO u_sunita   FROM yc_tkt_mgmt.users WHERE email='sunny@yahwehcare.com.au';
  SELECT id INTO u_elenor   FROM yc_tkt_mgmt.users WHERE email='elenor@yahwehcare.com.au';
  SELECT id INTO u_saloni   FROM yc_tkt_mgmt.users WHERE email='saloni@yahwehcare.com.au';
  SELECT id INTO u_james    FROM yc_tkt_mgmt.users WHERE email='james@yahwehcare.com.au';
  SELECT id INTO u_miejkyla FROM yc_tkt_mgmt.users WHERE email='miejkyla@yahwehcare.com.au';
  SELECT id INTO u_venujah  FROM yc_tkt_mgmt.users WHERE email='venujah@yahwehcare.com.au';
  SELECT id INTO u_akila    FROM yc_tkt_mgmt.users WHERE email='akila@yahwehcare.com.au';

  -- Get position IDs
  SELECT id INTO p_dir  FROM yc_tkt_mgmt.positions WHERE title='Director';
  SELECT id INTO p_ops  FROM yc_tkt_mgmt.positions WHERE title='Operations Manager';
  SELECT id INTO p_sdm  FROM yc_tkt_mgmt.positions WHERE title='Service Delivery Manager';
  SELECT id INTO p_rc   FROM yc_tkt_mgmt.positions WHERE title='Roster Coordinator';
  SELECT id INTO p_scl  FROM yc_tkt_mgmt.positions WHERE title='Support Coordination Lead';
  SELECT id INTO p_scs  FROM yc_tkt_mgmt.positions WHERE title='Support Coordination Staff';
  SELECT id INTO p_hro  FROM yc_tkt_mgmt.positions WHERE title='HR / Admin Officer';
  SELECT id INTO p_dco  FROM yc_tkt_mgmt.positions WHERE title='Day Centre Officer';
  SELECT id INTO p_fin  FROM yc_tkt_mgmt.positions WHERE title='Finance Manager';
  SELECT id INTO p_pm   FROM yc_tkt_mgmt.positions WHERE title='Plan Manager';
  SELECT id INTO p_str  FROM yc_tkt_mgmt.positions WHERE title='Strategic Dev / Client Relationship Manager';

  -- Clear existing position assignments for these users only
  DELETE FROM yc_tkt_mgmt.staff_positions
  WHERE user_id IN (u_alex,u_suganty,u_sunita,u_elenor,u_saloni,u_james,u_miejkyla,u_venujah,u_akila);

  -- Assign positions (first listed = primary)
  -- Alex: Director (primary) + Strategic Dev Manager (secondary — holds both)
  IF u_alex IS NOT NULL AND p_dir IS NOT NULL THEN
    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES (u_alex, p_dir, TRUE);
  END IF;
  IF u_alex IS NOT NULL AND p_str IS NOT NULL THEN
    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES (u_alex, p_str, FALSE);
  END IF;

  -- Suganty P: Operations Manager
  IF u_suganty IS NOT NULL AND p_ops IS NOT NULL THEN
    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES (u_suganty, p_ops, TRUE);
  END IF;

  -- Sunita Maharjan: Service Delivery Manager
  IF u_sunita IS NOT NULL AND p_sdm IS NOT NULL THEN
    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES (u_sunita, p_sdm, TRUE);
  END IF;

  -- Elenor Elia: Roster Coordinator
  IF u_elenor IS NOT NULL AND p_rc IS NOT NULL THEN
    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES (u_elenor, p_rc, TRUE);
  END IF;

  -- Saloni: Support Coordination Lead
  IF u_saloni IS NOT NULL AND p_scl IS NOT NULL THEN
    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES (u_saloni, p_scl, TRUE);
  END IF;

  -- James Baskaran: Support Coordination Staff
  IF u_james IS NOT NULL AND p_scs IS NOT NULL THEN
    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES (u_james, p_scs, TRUE);
  END IF;

  -- Miejkyla: HR / Admin Officer
  IF u_miejkyla IS NOT NULL AND p_hro IS NOT NULL THEN
    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES (u_miejkyla, p_hro, TRUE);
  END IF;

  -- Venujah Arudselvam: Day Centre Officer
  IF u_venujah IS NOT NULL AND p_dco IS NOT NULL THEN
    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES (u_venujah, p_dco, TRUE);
  END IF;

  -- Akila Nanayakkara: Finance Manager (primary) + Plan Manager (secondary — holds both)
  IF u_akila IS NOT NULL AND p_fin IS NOT NULL THEN
    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES (u_akila, p_fin, TRUE);
  END IF;
  IF u_akila IS NOT NULL AND p_pm IS NOT NULL THEN
    INSERT INTO yc_tkt_mgmt.staff_positions (user_id, position_id, is_primary) VALUES (u_akila, p_pm, FALSE);
  END IF;

  RAISE NOTICE 'Staff positions assigned successfully';
END $$;

-- ============================================================
-- 4. Verify — show what was seeded
-- ============================================================
SELECT
  u.name,
  u.email,
  u.auth_provider,
  u.is_bootstrap_admin,
  STRING_AGG(p.title, ', ' ORDER BY sp.is_primary DESC) AS positions
FROM yc_tkt_mgmt.users u
LEFT JOIN yc_tkt_mgmt.staff_positions sp ON sp.user_id = u.id
LEFT JOIN yc_tkt_mgmt.positions p ON p.id = sp.position_id
WHERE u.email IN (
  'alex@yahwehpc.com.au','it@yahwehcare.com.au','suganty@yahwehpc.com.au',
  'sunny@yahwehcare.com.au','elenor@yahwehcare.com.au','saloni@yahwehcare.com.au',
  'james@yahwehcare.com.au','miejkyla@yahwehcare.com.au','venujah@yahwehcare.com.au',
  'akila@yahwehcare.com.au'
)
GROUP BY u.id, u.name, u.email, u.auth_provider, u.is_bootstrap_admin
ORDER BY u.name;

COMMIT;
