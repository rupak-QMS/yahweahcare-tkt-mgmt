-- ============================================================
-- Performance indexes migration
-- Run once against NeonDB: psql $DATABASE_URL -f migrate_indexes.sql
-- All statements use IF NOT EXISTS so they are safe to re-run.
-- ============================================================

-- ── Tickets table ────────────────────────────────────────────
-- created_at DESC is the primary sort used in every ticket list query
CREATE INDEX IF NOT EXISTS idx_tickets_created_at    ON yc_tkt_mgmt.tickets(created_at DESC);
-- status is filtered in nearly every query (open vs resolved, scope filters)
CREATE INDEX IF NOT EXISTS idx_tickets_status        ON yc_tkt_mgmt.tickets(status);
-- assignee and creator are used in scope=mine and scope=dept filters
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to   ON yc_tkt_mgmt.tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by    ON yc_tkt_mgmt.tickets(created_by);
-- category and priority used in filter dropdowns and analytics group-by
CREATE INDEX IF NOT EXISTS idx_tickets_category_id   ON yc_tkt_mgmt.tickets(category_id);
CREATE INDEX IF NOT EXISTS idx_tickets_priority_id   ON yc_tkt_mgmt.tickets(priority_id);
-- due_date used in overdue detection
CREATE INDEX IF NOT EXISTS idx_tickets_due_date      ON yc_tkt_mgmt.tickets(due_date);
-- composite: covers the most common open-ticket list pattern
CREATE INDEX IF NOT EXISTS idx_tickets_status_created ON yc_tkt_mgmt.tickets(status, created_at DESC);

-- ── Activity table ───────────────────────────────────────────
-- ticket_id = ANY($ids) batched fetch used in every ticket list response
CREATE INDEX IF NOT EXISTS idx_activity_ticket_id    ON yc_tkt_mgmt.activity(ticket_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_at   ON yc_tkt_mgmt.activity(created_at DESC);

-- ── Comments table ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_comments_ticket_id    ON yc_tkt_mgmt.comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at   ON yc_tkt_mgmt.comments(created_at ASC);

-- ── Users table (department filter in scope=dept queries) ────
CREATE INDEX IF NOT EXISTS idx_users_department_id   ON yc_tkt_mgmt.users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_active          ON yc_tkt_mgmt.users(active, role_id);

-- ── Ticket approvers ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_approvers_ticket_id   ON yc_tkt_mgmt.ticket_approvers(ticket_id);
CREATE INDEX IF NOT EXISTS idx_approvers_user_id     ON yc_tkt_mgmt.ticket_approvers(approver_user_id);
