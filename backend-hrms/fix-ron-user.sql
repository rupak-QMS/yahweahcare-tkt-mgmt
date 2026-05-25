-- ============================================================
-- Fix: Upsert Ron Costa with correct email + super_admin role
-- Run this once against the Neon database:
--   psql "$DATABASE_URL" -f fix-ron-user.sql
-- Or paste into the Neon SQL editor in the dashboard.
-- ============================================================

SET search_path TO yc_tkt_mgmt, public;

-- Step 1: Make sure the super_admin role row exists and get its id
DO $$
DECLARE
  v_role_id   INTEGER;
  v_old_email TEXT := 'it@yahwehcare.com.au';
  v_new_email TEXT := 'ron@wmxsolutions.com.au';
BEGIN

  SELECT id INTO v_role_id FROM yc_tkt_mgmt.roles WHERE name = 'super_admin';
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'super_admin role not found — run the full seed first (npm run seed)';
  END IF;

  -- Step 2: If a record with the OLD placeholder email still exists, update it in place
  UPDATE yc_tkt_mgmt.users
  SET
    email           = v_new_email,
    role            = 'super_admin',
    role_id         = v_role_id,
    system_created  = TRUE,
    bootstrap_admin = TRUE,
    auth_provider   = 'microsoft',
    active          = TRUE,
    updated_at      = NOW()
  WHERE LOWER(email) = LOWER(v_old_email);

  -- Step 3: If the record doesn't exist at all (neither old nor new email),
  --         insert it fresh so Ron can log in immediately.
  INSERT INTO yc_tkt_mgmt.users
    (email, name, role, department, designation, avatar_initials,
     role_id, system_created, bootstrap_admin, auth_provider, active)
  SELECT
    v_new_email, 'Ron Costa', 'super_admin', 'Management', 'Operations Manager', 'RC',
    v_role_id, TRUE, TRUE, 'microsoft', TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM yc_tkt_mgmt.users WHERE LOWER(email) = LOWER(v_new_email)
  );

  RAISE NOTICE 'Done — ron@wmxsolutions.com.au is now a bootstrap super_admin.';
END;
$$;
