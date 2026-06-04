-- ============================================================
-- Approval Workflow Migration
-- Run once against the Neon DB
-- ============================================================
SET search_path TO yc_tkt_mgmt, public;

-- Add expected_completion and pending_approval_at to tickets
ALTER TABLE yc_tkt_mgmt.tickets
  ADD COLUMN IF NOT EXISTS expected_completion DATE,
  ADD COLUMN IF NOT EXISTS pending_approval_at TIMESTAMPTZ;

-- Ticket approvers table
CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.ticket_approvers (
  id            SERIAL PRIMARY KEY,
  ticket_id     INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  justification TEXT,
  responded_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticket_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_approvers_ticket ON yc_tkt_mgmt.ticket_approvers(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_approvers_user   ON yc_tkt_mgmt.ticket_approvers(user_id);

-- Ensure pending_approval status exists
INSERT INTO yc_tkt_mgmt.statuses (id, label, sort_order, is_closed)
VALUES ('pending_approval', 'Pending Approval', 4, FALSE)
ON CONFLICT (id) DO NOTHING;
