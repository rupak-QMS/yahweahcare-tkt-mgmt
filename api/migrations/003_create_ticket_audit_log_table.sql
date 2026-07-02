-- Migration 003: Create ticket_audit_log table
-- Description: Immutable audit trail for all ticket actions
-- Author: Enterprise System
-- Date: 2026-06-04

BEGIN;

-- Create ticket_audit_log table
CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.ticket_audit_log (
    audit_id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    changed_by INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    changed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    browser_info TEXT,
    CHECK (action_type IN (
        'Created', 'Updated', 'Assigned', 'Reassigned', 'StatusChanged',
        'Approved', 'Rejected', 'Reopened', 'Closed', 'Deleted', 'Restored',
        'CommentAdded', 'AttachmentAdded'
    ))
);

-- Create indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_ticket_audit_ticket_id
    ON yc_tkt_mgmt.ticket_audit_log(ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_audit_changed_by
    ON yc_tkt_mgmt.ticket_audit_log(changed_by);

CREATE INDEX IF NOT EXISTS idx_ticket_audit_date
    ON yc_tkt_mgmt.ticket_audit_log(changed_date DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_audit_action
    ON yc_tkt_mgmt.ticket_audit_log(action_type);

CREATE INDEX IF NOT EXISTS idx_ticket_audit_composite
    ON yc_tkt_mgmt.ticket_audit_log(ticket_id, changed_date DESC);

COMMIT;
