-- ============================================================
-- Approval Workflow Migration (fix — matches existing ticket_approvers schema)
-- Run once against the Neon DB
-- ============================================================
SET search_path TO yc_tkt_mgmt, public;

-- Add expected_completion and pending_approval_at to tickets (idempotent)
ALTER TABLE yc_tkt_mgmt.tickets
  ADD COLUMN IF NOT EXISTS expected_completion DATE,
  ADD COLUMN IF NOT EXISTS pending_approval_at TIMESTAMPTZ;

-- Fix missing index that failed previously (column is approver_user_id, not user_id)
CREATE INDEX IF NOT EXISTS idx_ticket_approvers_approver
  ON yc_tkt_mgmt.ticket_approvers(approver_user_id);

-- Ensure pending_approval status exists in statuses lookup table
INSERT INTO yc_tkt_mgmt.statuses (id, label, sort_order, is_closed)
VALUES ('pending_approval', 'Pending Approval', 4, FALSE)
ON CONFLICT (id) DO NOTHING;
