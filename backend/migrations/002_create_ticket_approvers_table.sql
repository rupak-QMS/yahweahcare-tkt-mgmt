-- Migration 002: Create ticket_approvers table
-- Description: Mapping table for ticket approvers and their approval status
-- Author: Enterprise System
-- Date: 2026-06-04

BEGIN;

-- Create ticket_approvers table
CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.ticket_approvers (
    ticket_approver_id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
    approver_user_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    approval_status VARCHAR(20) NOT NULL DEFAULT 'Pending'
        CHECK (approval_status IN ('Pending', 'Approved', 'Rejected', 'Reopened')),
    approval_date TIMESTAMP,
    comments TEXT,
    action_taken_by INTEGER REFERENCES yc_tkt_mgmt.users(id),
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ticket_id, approver_user_id)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_ticket_approvers_ticket_id
    ON yc_tkt_mgmt.ticket_approvers(ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_approvers_approver_id
    ON yc_tkt_mgmt.ticket_approvers(approver_user_id);

CREATE INDEX IF NOT EXISTS idx_ticket_approvers_status
    ON yc_tkt_mgmt.ticket_approvers(approval_status);

CREATE INDEX IF NOT EXISTS idx_ticket_approvers_pending
    ON yc_tkt_mgmt.ticket_approvers(approver_user_id, approval_status)
    WHERE approval_status = 'Pending';

COMMIT;
