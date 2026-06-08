-- Migration 008: Add is_bootstrap_admin flag to users table
-- Bootstrap admins (Alex and Ron) cannot be deactivated or deleted by anyone.
-- Director is a separate concept — it is a position held by Alex, not a flag.

BEGIN;

-- Add column if it doesn't already exist
ALTER TABLE yc_tkt_mgmt.users
  ADD COLUMN IF NOT EXISTS is_bootstrap_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Mark bootstrap admins by email
UPDATE yc_tkt_mgmt.users
SET is_bootstrap_admin = TRUE
WHERE email IN ('alex@yahwehpc.com.au', 'it@yahwehcare.com.au');

COMMIT;
