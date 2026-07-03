-- ============================================================
-- DANGER — DO NOT RUN THIS AGAINST PRODUCTION
-- ============================================================
-- This is a full schema reset: it drops users, tickets, departments,
-- roles, positions, comments, activity, notifications, and every
-- other core table with CASCADE, then rebuilds them empty.
--
-- This exact file caused a real production data-loss incident on
-- 2026-07-02/03: it was previously named '000_reset_schema.sql' and
-- included in run-migrations.js's automatic migration list, so it
-- silently re-ran and wiped all staff and ticket data. It has since
-- been removed from that list and renamed so it can never be picked
-- up automatically again — see run-migrations.js for details.
--
-- Only run this file manually, by hand, against a database you
-- explicitly intend to wipe (e.g. a fresh local/dev environment
-- with no real data). Never run it against production.
-- ============================================================
--
-- Migration 000: Complete Schema Reset
-- Description: Drop all existing tables and rebuild from scratch
-- Author: Enterprise System
-- Date: 2026-06-04
-- WARNING: This will DELETE all existing data!

BEGIN;

-- Drop all existing views
DROP VIEW IF EXISTS yc_tkt_mgmt.v_unread_notifications_count CASCADE;
DROP VIEW IF EXISTS yc_tkt_mgmt.v_deleted_tickets CASCADE;
DROP VIEW IF EXISTS yc_tkt_mgmt.v_closed_tickets_recent CASCADE;
DROP VIEW IF EXISTS yc_tkt_mgmt.v_pending_approvals CASCADE;
DROP VIEW IF EXISTS yc_tkt_mgmt.v_accessible_tickets CASCADE;
DROP VIEW IF EXISTS yc_tkt_mgmt.v_ticket_audit_trail CASCADE;

-- Drop all existing tables
DROP TABLE IF EXISTS yc_tkt_mgmt.user_roles CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.roles CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.notifications CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.ticket_audit_log CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.ticket_approvers CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.comments CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.activity CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.tickets CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.statuses CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.priorities CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.categories CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.users CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.positions CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.departments CASCADE;

-- Create departments table
CREATE TABLE yc_tkt_mgmt.departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create positions table
CREATE TABLE yc_tkt_mgmt.positions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    department_id INTEGER REFERENCES yc_tkt_mgmt.departments(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create users table
CREATE TABLE yc_tkt_mgmt.users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    department_id INTEGER REFERENCES yc_tkt_mgmt.departments(id),
    position_id INTEGER REFERENCES yc_tkt_mgmt.positions(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create categories table
CREATE TABLE yc_tkt_mgmt.categories (
    id VARCHAR(50) PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    icon VARCHAR(10),
    sort_order INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create priorities table
CREATE TABLE yc_tkt_mgmt.priorities (
    id VARCHAR(50) PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    sla_hours INTEGER,
    sort_order INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create statuses table
CREATE TABLE yc_tkt_mgmt.statuses (
    id VARCHAR(50) PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    sort_order INTEGER,
    is_closed BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create tickets table (ENTERPRISE EDITION)
CREATE TABLE yc_tkt_mgmt.tickets (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category_id VARCHAR(50) REFERENCES yc_tkt_mgmt.categories(id),
    priority_id VARCHAR(50) REFERENCES yc_tkt_mgmt.priorities(id),
    status VARCHAR(50) DEFAULT 'new',

    -- Approval Workflow Fields
    created_by INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    assigned_to INTEGER REFERENCES yc_tkt_mgmt.users(id),
    due_date TIMESTAMP,
    approver_required BOOLEAN DEFAULT true,
    approval_mode VARCHAR(20) DEFAULT 'AnyOne' CHECK (approval_mode IN ('AnyOne', 'AllMustApprove')),

    -- Resolution Fields
    resolution_summary TEXT,
    root_cause TEXT,
    corrective_action TEXT,
    closure_remarks TEXT,
    closed_date TIMESTAMP,

    -- Soft Delete Fields
    is_deleted BOOLEAN DEFAULT false,
    deleted_by INTEGER REFERENCES yc_tkt_mgmt.users(id),
    deleted_date TIMESTAMP,
    delete_reason TEXT,

    -- Audit Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sort_order INTEGER
);

-- Create ticket_approvers table
CREATE TABLE yc_tkt_mgmt.ticket_approvers (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
    approver_user_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    approval_status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (approval_status IN ('Pending', 'Approved', 'Rejected', 'Reopened')),
    approval_date TIMESTAMP,
    comments TEXT,
    action_taken_by INTEGER REFERENCES yc_tkt_mgmt.users(id),
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ticket_id, approver_user_id)
);

-- Create ticket_audit_log table (Immutable)
CREATE TABLE yc_tkt_mgmt.ticket_audit_log (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL CHECK (action_type IN (
        'Created', 'Updated', 'Assigned', 'Reassigned', 'StatusChanged',
        'Approved', 'Rejected', 'Reopened', 'Closed', 'Deleted', 'Restored',
        'CommentAdded', 'AttachmentAdded'
    )),
    old_value JSONB,
    new_value JSONB,
    changed_by INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    changed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    browser_info TEXT
);

-- Create notifications table
CREATE TABLE yc_tkt_mgmt.notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id) ON DELETE CASCADE,
    ticket_id INTEGER REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN (
        'TicketCreated', 'TicketAssigned', 'TicketReassigned',
        'TicketResolved', 'TicketApproved', 'TicketRejected',
        'TicketReopened', 'TicketClosed', 'ApprovalRequested',
        'CommentAdded', 'MentionedInComment', 'SLAWarning', 'SLABreached'
    )),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_date TIMESTAMP,
    email_sent BOOLEAN DEFAULT false,
    teams_sent BOOLEAN DEFAULT false,
    push_sent BOOLEAN DEFAULT false,
    related_user_id INTEGER REFERENCES yc_tkt_mgmt.users(id)
);

-- Create roles table
CREATE TABLE yc_tkt_mgmt.roles (
    id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create user_roles table
CREATE TABLE yc_tkt_mgmt.user_roles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.roles(id) ON DELETE CASCADE,
    assigned_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, role_id)
);

-- Create comments table (for ticket discussions)
CREATE TABLE yc_tkt_mgmt.comments (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create activity table (for ticket activity log)
CREATE TABLE yc_tkt_mgmt.activity (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    action VARCHAR(100) NOT NULL,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- CREATE INDEXES
-- ============================================================

-- Tickets indexes
CREATE INDEX idx_tickets_created_by ON yc_tkt_mgmt.tickets(created_by);
CREATE INDEX idx_tickets_assigned_to ON yc_tkt_mgmt.tickets(assigned_to);
CREATE INDEX idx_tickets_is_deleted ON yc_tkt_mgmt.tickets(is_deleted);
CREATE INDEX idx_tickets_due_date ON yc_tkt_mgmt.tickets(due_date);
CREATE INDEX idx_tickets_approver_required ON yc_tkt_mgmt.tickets(approver_required);

-- Approvers indexes
CREATE INDEX idx_ticket_approvers_ticket_id ON yc_tkt_mgmt.ticket_approvers(ticket_id);
CREATE INDEX idx_ticket_approvers_approver_id ON yc_tkt_mgmt.ticket_approvers(approver_user_id);
CREATE INDEX idx_ticket_approvers_pending ON yc_tkt_mgmt.ticket_approvers(approver_user_id, approval_status) WHERE approval_status = 'Pending';

-- Audit log indexes
CREATE INDEX idx_ticket_audit_ticket_id ON yc_tkt_mgmt.ticket_audit_log(ticket_id);
CREATE INDEX idx_ticket_audit_changed_by ON yc_tkt_mgmt.ticket_audit_log(changed_by);
CREATE INDEX idx_ticket_audit_date ON yc_tkt_mgmt.ticket_audit_log(changed_date DESC);

-- Notifications indexes
CREATE INDEX idx_notifications_user_id ON yc_tkt_mgmt.notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON yc_tkt_mgmt.notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_created_date ON yc_tkt_mgmt.notifications(created_date DESC);

-- Comments and activity indexes
CREATE INDEX idx_comments_ticket_id ON yc_tkt_mgmt.comments(ticket_id);
CREATE INDEX idx_activity_ticket_id ON yc_tkt_mgmt.activity(ticket_id);

COMMIT;
