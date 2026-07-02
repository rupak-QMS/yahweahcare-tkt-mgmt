-- ============================================================
-- Yahweahcare Ticket Management — PostgreSQL Schema
-- All tables live in the YC_TKT_MGMT schema (namespace)
-- e.g.  yc_tkt_mgmt.users, yc_tkt_mgmt.tickets, ...
-- ============================================================

-- ------------------------------------------------------------
-- Clean up: drop any legacy artefacts from old runs
-- ------------------------------------------------------------
-- Old unprefixed tables in public
DROP VIEW  IF EXISTS public.v_open_tickets         CASCADE;
DROP VIEW  IF EXISTS public.v_sla_summary          CASCADE;
DROP TABLE IF EXISTS public.notifications          CASCADE;
DROP TABLE IF EXISTS public.attachments            CASCADE;
DROP TABLE IF EXISTS public.activity               CASCADE;
DROP TABLE IF EXISTS public.comments               CASCADE;
DROP TABLE IF EXISTS public.tickets                CASCADE;
DROP TABLE IF EXISTS public.users                  CASCADE;
DROP TABLE IF EXISTS public.categories             CASCADE;
DROP TABLE IF EXISTS public.priorities             CASCADE;
DROP TABLE IF EXISTS public.statuses               CASCADE;
DROP TABLE IF EXISTS public.sla_policies           CASCADE;
DROP TABLE IF EXISTS public.sessions               CASCADE;
DROP TABLE IF EXISTS public.scheduled_reports      CASCADE;

-- Old prefixed tables (intermediate naming)
DROP VIEW  IF EXISTS public.yc_tkt_mgmt_v_open_tickets   CASCADE;
DROP TABLE IF EXISTS public.yc_tkt_mgmt_notifications    CASCADE;
DROP TABLE IF EXISTS public.yc_tkt_mgmt_attachments      CASCADE;
DROP TABLE IF EXISTS public.yc_tkt_mgmt_activity         CASCADE;
DROP TABLE IF EXISTS public.yc_tkt_mgmt_comments         CASCADE;
DROP TABLE IF EXISTS public.yc_tkt_mgmt_tickets          CASCADE;
DROP TABLE IF EXISTS public.yc_tkt_mgmt_users            CASCADE;
DROP TABLE IF EXISTS public.yc_tkt_mgmt_categories       CASCADE;
DROP TABLE IF EXISTS public.yc_tkt_mgmt_priorities       CASCADE;
DROP TABLE IF EXISTS public.yc_tkt_mgmt_statuses         CASCADE;
DROP TABLE IF EXISTS public.yc_tkt_mgmt_scheduled_reports CASCADE;

-- Drop the schema if it exists (CASCADE removes all its tables)
DROP SCHEMA IF EXISTS yc_tkt_mgmt CASCADE;

-- ------------------------------------------------------------
-- Create the schema and set it as the default search path
-- ------------------------------------------------------------
CREATE SCHEMA yc_tkt_mgmt;
SET search_path TO yc_tkt_mgmt, public;

-- ------------------------------------------------------------
-- Lookup tables
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.categories (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  icon        TEXT,
  sort_order  INTEGER DEFAULT 0
);

CREATE TABLE yc_tkt_mgmt.priorities (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  sla_hours   INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL
);

CREATE TABLE yc_tkt_mgmt.statuses (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  is_closed   BOOLEAN DEFAULT FALSE
);

-- ------------------------------------------------------------
-- Users
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.users (
  id              SERIAL PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  password_hash   TEXT,
  role            TEXT NOT NULL CHECK (role IN ('super_admin','manager','user','staff','agent','admin')),
  department      TEXT,
  job_title       TEXT,
  site            TEXT,
  avatar_initials TEXT,
  is_admin        BOOLEAN DEFAULT FALSE,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON yc_tkt_mgmt.users(email);
CREATE INDEX idx_users_role  ON yc_tkt_mgmt.users(role);
CREATE INDEX idx_users_dept  ON yc_tkt_mgmt.users(department);

-- ------------------------------------------------------------
-- Tickets
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.tickets (
  id             SERIAL PRIMARY KEY,
  ticket_number  TEXT UNIQUE NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  category_id    TEXT NOT NULL REFERENCES yc_tkt_mgmt.categories(id),
  priority_id    TEXT NOT NULL REFERENCES yc_tkt_mgmt.priorities(id),
  status_id      TEXT NOT NULL REFERENCES yc_tkt_mgmt.statuses(id) DEFAULT 'new',
  requester_id   INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
  assignee_id    INTEGER REFERENCES yc_tkt_mgmt.users(id),
  site           TEXT,
  source         TEXT DEFAULT 'web',
  due_at         TIMESTAMPTZ NOT NULL,
  resolved_at    TIMESTAMPTZ,
  closed_at      TIMESTAMPTZ,
  sla_breached   BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tickets_status     ON yc_tkt_mgmt.tickets(status_id);
CREATE INDEX idx_tickets_priority   ON yc_tkt_mgmt.tickets(priority_id);
CREATE INDEX idx_tickets_assignee   ON yc_tkt_mgmt.tickets(assignee_id);
CREATE INDEX idx_tickets_requester  ON yc_tkt_mgmt.tickets(requester_id);
CREATE INDEX idx_tickets_due_at     ON yc_tkt_mgmt.tickets(due_at);

-- ------------------------------------------------------------
-- Comments
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.comments (
  id           SERIAL PRIMARY KEY,
  ticket_id    INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
  author_id    INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
  body         TEXT NOT NULL,
  is_internal  BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_ticket ON yc_tkt_mgmt.comments(ticket_id);

-- ------------------------------------------------------------
-- Activity audit log
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.activity (
  id           SERIAL PRIMARY KEY,
  ticket_id    INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
  actor_id     INTEGER REFERENCES yc_tkt_mgmt.users(id),
  action_type  TEXT NOT NULL,
  from_value   TEXT,
  to_value     TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_ticket ON yc_tkt_mgmt.activity(ticket_id);

-- ------------------------------------------------------------
-- Notifications queue
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.notifications (
  id              SERIAL PRIMARY KEY,
  recipient_id    INTEGER REFERENCES yc_tkt_mgmt.users(id),
  recipient_email TEXT,
  ticket_id       INTEGER REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('email','teams','sms','push')),
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','read')),
  sent_at         TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON yc_tkt_mgmt.notifications(recipient_id);
CREATE INDEX idx_notifications_status    ON yc_tkt_mgmt.notifications(status);

-- ------------------------------------------------------------
-- Attachments
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.attachments (
  id            SERIAL PRIMARY KEY,
  ticket_id     INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
  uploader_id   INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
  filename      TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    BIGINT,
  storage_path  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Scheduled reports
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.scheduled_reports (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  frequency       TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  day_of_week     TEXT,
  day_of_month    INTEGER,
  time_of_day     TEXT NOT NULL,
  report_types    TEXT[] NOT NULL,
  recipient_ids   INTEGER[] NOT NULL,
  active          BOOLEAN DEFAULT TRUE,
  created_by      INTEGER REFERENCES yc_tkt_mgmt.users(id),
  last_sent_at    TIMESTAMPTZ,
  sent_count      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scheduled_active ON yc_tkt_mgmt.scheduled_reports(active);

-- ------------------------------------------------------------
-- View: open tickets enriched
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW yc_tkt_mgmt.v_open_tickets AS
SELECT t.*,
  c.label AS category_label, c.icon AS category_icon,
  p.label AS priority_label, p.sla_hours,
  s.label AS status_label, s.is_closed,
  u_req.name AS requester_name, u_req.email AS requester_email,
  u_asn.name AS assignee_name, u_asn.email AS assignee_email
FROM yc_tkt_mgmt.tickets t
JOIN yc_tkt_mgmt.categories c ON c.id = t.category_id
JOIN yc_tkt_mgmt.priorities p ON p.id = t.priority_id
JOIN yc_tkt_mgmt.statuses   s ON s.id = t.status_id
JOIN yc_tkt_mgmt.users   u_req ON u_req.id = t.requester_id
LEFT JOIN yc_tkt_mgmt.users u_asn ON u_asn.id = t.assignee_id
WHERE s.is_closed = FALSE;
