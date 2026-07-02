-- Migration 001: Add new fields to tickets table
-- Description: Add approval workflow, soft delete, and closure fields
-- Author: Enterprise System
-- Date: 2026-06-04

BEGIN;

-- Add new columns to tickets table
ALTER TABLE yc_tkt_mgmt.tickets
ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES yc_tkt_mgmt.users(id),
ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES yc_tkt_mgmt.users(id),
ADD COLUMN IF NOT EXISTS due_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS approver_required BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS approval_mode VARCHAR(20) DEFAULT 'AnyOne'
    CHECK (approval_mode IN ('AnyOne', 'AllMustApprove')),
ADD COLUMN IF NOT EXISTS resolution_summary TEXT,
ADD COLUMN IF NOT EXISTS root_cause TEXT,
ADD COLUMN IF NOT EXISTS corrective_action TEXT,
ADD COLUMN IF NOT EXISTS closure_remarks TEXT,
ADD COLUMN IF NOT EXISTS closed_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES yc_tkt_mgmt.users(id),
ADD COLUMN IF NOT EXISTS deleted_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS delete_reason TEXT;

-- Create index on created_by for faster queries
CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON yc_tkt_mgmt.tickets(created_by);

-- Create index on assigned_to for faster queries
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON yc_tkt_mgmt.tickets(assigned_to);

-- Create index on deleted flag for soft delete queries
CREATE INDEX IF NOT EXISTS idx_tickets_is_deleted ON yc_tkt_mgmt.tickets(is_deleted);

-- Create index on due_date for SLA tracking
CREATE INDEX IF NOT EXISTS idx_tickets_due_date ON yc_tkt_mgmt.tickets(due_date);

-- Create index on approval status
CREATE INDEX IF NOT EXISTS idx_tickets_approver_required ON yc_tkt_mgmt.tickets(approver_required);

COMMIT;
