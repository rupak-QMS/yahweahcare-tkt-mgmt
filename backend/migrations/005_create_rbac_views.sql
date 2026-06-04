-- Migration 005: Create Role-Based Access Control views
-- Description: Views for row-level security and role-based filtering
-- Author: Enterprise System
-- Date: 2026-06-04

BEGIN;

-- Create roles table (if not exists)
CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default roles
INSERT INTO yc_tkt_mgmt.roles (role_name, description) VALUES
    ('BootstrapAdmin', 'Full system access, can delete and restore tickets'),
    ('Manager', 'Can view and manage team tickets, approve tickets'),
    ('Assignee', 'Can update assigned tickets, add notes and attachments'),
    ('Approver', 'Can review and approve/reject tickets'),
    ('Creator', 'Can create and view own tickets'),
    ('User', 'Basic user role')
ON CONFLICT (role_name) DO NOTHING;

-- Create user_roles junction table
CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.user_roles (
    user_role_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.roles(role_id) ON DELETE CASCADE,
    assigned_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON yc_tkt_mgmt.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON yc_tkt_mgmt.user_roles(role_id);

-- Create view: Tickets visible to a user based on their role
CREATE OR REPLACE VIEW yc_tkt_mgmt.v_accessible_tickets AS
SELECT DISTINCT
    t.id,
    t.title,
    t.description,
    t.category_id,
    t.priority_id,
    t.created_by,
    t.assigned_to,
    t.due_date,
    t.approval_mode,
    t.approver_required,
    t.resolution_summary,
    t.closed_date,
    t.is_deleted
FROM yc_tkt_mgmt.tickets t
WHERE t.is_deleted = false;

-- Create view: Tickets pending approval for a user
CREATE OR REPLACE VIEW yc_tkt_mgmt.v_pending_approvals AS
SELECT
    t.id as ticket_id,
    t.title as ticket_title,
    u_creator.name as created_by_name,
    u_assignee.name as assigned_to_name,
    t.priority_id,
    t.resolution_summary,
    ta.created_date as approval_due_date,
    ta.approval_status
FROM yc_tkt_mgmt.tickets t
JOIN yc_tkt_mgmt.ticket_approvers ta ON t.id = ta.ticket_id
LEFT JOIN yc_tkt_mgmt.users u_creator ON t.created_by = u_creator.id
LEFT JOIN yc_tkt_mgmt.users u_assignee ON t.assigned_to = u_assignee.id
WHERE ta.approval_status = 'Pending'
    AND t.is_deleted = false
ORDER BY ta.created_date ASC;

-- Create view: Tickets closed in last 30 days
CREATE OR REPLACE VIEW yc_tkt_mgmt.v_closed_tickets_recent AS
SELECT
    t.id,
    t.title,
    u_creator.name as created_by,
    u_assignee.name as assigned_to,
    t.priority_id,
    t.closed_date,
    EXTRACT(DAY FROM CURRENT_TIMESTAMP - t.closed_date) as days_since_closure
FROM yc_tkt_mgmt.tickets t
LEFT JOIN yc_tkt_mgmt.users u_creator ON t.created_by = u_creator.id
LEFT JOIN yc_tkt_mgmt.users u_assignee ON t.assigned_to = u_assignee.id
WHERE t.is_deleted = false
    AND t.closed_date IS NOT NULL
    AND t.closed_date >= CURRENT_TIMESTAMP - INTERVAL '30 days'
ORDER BY t.closed_date DESC;

-- Create view: Deleted tickets (recycle bin)
CREATE OR REPLACE VIEW yc_tkt_mgmt.v_deleted_tickets AS
SELECT
    t.id,
    t.title,
    u_creator.name as created_by,
    u_deleter.name as deleted_by,
    t.deleted_date,
    t.delete_reason,
    EXTRACT(DAY FROM CURRENT_TIMESTAMP - t.deleted_date) as days_since_deletion
FROM yc_tkt_mgmt.tickets t
LEFT JOIN yc_tkt_mgmt.users u_creator ON t.created_by = u_creator.id
LEFT JOIN yc_tkt_mgmt.users u_deleter ON t.deleted_by = u_deleter.id
WHERE t.is_deleted = true
ORDER BY t.deleted_date DESC;

-- Create view: Unread notifications count per user
CREATE OR REPLACE VIEW yc_tkt_mgmt.v_unread_notifications_count AS
SELECT
    user_id,
    COUNT(*) as unread_count,
    MAX(created_date) as latest_notification_date
FROM yc_tkt_mgmt.notifications
WHERE is_read = false
GROUP BY user_id;

COMMIT;
