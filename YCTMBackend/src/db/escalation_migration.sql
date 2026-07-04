-- ============================================================
-- Escalation Migration
-- Run once against the Neon DB
-- ============================================================
SET search_path TO yc_tkt_mgmt, public;

-- Add escalation columns to tickets
ALTER TABLE yc_tkt_mgmt.tickets
  ADD COLUMN IF NOT EXISTS is_escalated       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS escalated_to       INTEGER REFERENCES yc_tkt_mgmt.users(id),
  ADD COLUMN IF NOT EXISTS escalated_by       INTEGER REFERENCES yc_tkt_mgmt.users(id),
  ADD COLUMN IF NOT EXISTS escalated_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_reason  TEXT;

-- Escalation history table (full trail)
CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.ticket_escalations (
  id               SERIAL PRIMARY KEY,
  ticket_id        INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
  escalated_by     INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
  escalated_to     INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
  reason           TEXT NOT NULL,
  previous_assignee INTEGER REFERENCES yc_tkt_mgmt.users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalations_ticket ON yc_tkt_mgmt.ticket_escalations(ticket_id);
