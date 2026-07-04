-- Add assignable column to users table
-- Managers and admins are assignable by default; regular users are not
ALTER TABLE yc_tkt_mgmt.users
  ADD COLUMN IF NOT EXISTS assignable boolean NOT NULL DEFAULT FALSE;

-- Seed sensible defaults based on existing roles
UPDATE yc_tkt_mgmt.users u
SET assignable = TRUE
FROM yc_tkt_mgmt.roles r
WHERE r.id = u.role_id
  AND r.name IN ('super_admin', 'manager');
