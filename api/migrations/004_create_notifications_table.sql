-- Migration 004: Create notifications table
-- Description: In-app notification system for ticket events
-- Author: Enterprise System
-- Date: 2026-06-04

BEGIN;

-- Create notifications table
CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.notifications (
    notification_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id) ON DELETE CASCADE,
    ticket_id INTEGER REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_date TIMESTAMP,
    email_sent BOOLEAN DEFAULT false,
    teams_sent BOOLEAN DEFAULT false,
    push_sent BOOLEAN DEFAULT false,
    related_user_id INTEGER REFERENCES yc_tkt_mgmt.users(id),
    CHECK (notification_type IN (
        'TicketCreated', 'TicketAssigned', 'TicketReassigned',
        'TicketResolved', 'TicketApproved', 'TicketRejected',
        'TicketReopened', 'TicketClosed', 'ApprovalRequested',
        'CommentAdded', 'MentionedInComment', 'SLAWarning', 'SLABreached'
    ))
);

-- Create indexes for notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON yc_tkt_mgmt.notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_ticket_id
    ON yc_tkt_mgmt.notifications(ticket_id);

CREATE INDEX IF NOT EXISTS idx_notifications_is_read
    ON yc_tkt_mgmt.notifications(is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON yc_tkt_mgmt.notifications(user_id, is_read)
    WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_created_date
    ON yc_tkt_mgmt.notifications(created_date DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_type
    ON yc_tkt_mgmt.notifications(notification_type);

COMMIT;
