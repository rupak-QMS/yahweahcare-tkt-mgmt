-- ============================================================
-- Scheduled Reports table migration
-- Run once to add the table to the existing DB
-- ============================================================

CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.scheduled_reports (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  frequency       TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  day_of_week     TEXT,           -- 'Monday'..'Sunday' for weekly
  day_of_month    INTEGER,        -- 1..28 for monthly
  time            TEXT NOT NULL,  -- 'HH:MM'
  report_types    TEXT[] NOT NULL DEFAULT '{}',
  recipient_ids   INTEGER[] NOT NULL DEFAULT '{}',
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  last_sent_at    TIMESTAMPTZ,
  created_by      INTEGER REFERENCES yc_tkt_mgmt.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_created_by ON yc_tkt_mgmt.scheduled_reports(created_by);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_active     ON yc_tkt_mgmt.scheduled_reports(active);
