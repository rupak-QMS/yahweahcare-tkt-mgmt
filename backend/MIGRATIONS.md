# Database Migrations - Enterprise Ticket Management System

## Overview
This document describes all database migrations for the enterprise ticket management system. Migrations are designed to be idempotent and safe to run multiple times.

## Migration Files

### 001_add_ticket_fields.sql
**Purpose**: Add approval workflow and soft delete fields to the tickets table

**Changes**:
- `created_by` (UUID) - References user who created the ticket
- `assigned_to` (UUID) - References user assigned to the ticket
- `due_date` (TIMESTAMP) - Ticket due date for SLA tracking
- `approver_required` (BOOLEAN) - Whether approval is required
- `approval_mode` (VARCHAR) - 'AnyOne' or 'AllMustApprove'
- `resolution_summary` (TEXT) - Summary of resolution
- `root_cause` (TEXT) - Root cause analysis
- `corrective_action` (TEXT) - Corrective action taken
- `closure_remarks` (TEXT) - Remarks on closure
- `closed_date` (TIMESTAMP) - When ticket was closed
- `is_deleted` (BOOLEAN) - Soft delete flag
- `deleted_by` (UUID) - User who deleted the ticket
- `deleted_date` (TIMESTAMP) - When ticket was deleted
- `delete_reason` (TEXT) - Reason for deletion

**Indexes Created**:
- `idx_tickets_created_by` - For user's created tickets
- `idx_tickets_assigned_to` - For user's assigned tickets
- `idx_tickets_is_deleted` - For soft delete queries
- `idx_tickets_due_date` - For SLA tracking
- `idx_tickets_status_deleted` - Composite index for common queries

---

### 002_create_ticket_approvers_table.sql
**Purpose**: Create mapping table for ticket approvers

**Table**: `ticket_approvers`

**Columns**:
- `ticket_approver_id` (UUID) - Primary key
- `ticket_id` (UUID) - Foreign key to tickets
- `approver_user_id` (UUID) - Foreign key to users (the approver)
- `approval_status` (VARCHAR) - Pending/Approved/Rejected/Reopened
- `approval_date` (TIMESTAMP) - When approval was given
- `comments` (TEXT) - Approver's comments
- `action_taken_by` (UUID) - User who performed the action
- `created_date` (TIMESTAMP) - When record was created
- `updated_date` (TIMESTAMP) - Auto-updated on changes

**Features**:
- UNIQUE constraint: One approver per ticket
- Automatic timestamp trigger for `updated_date`
- Cascade delete when ticket is deleted

**Indexes**:
- `idx_ticket_approvers_ticket_id` - Query approvers by ticket
- `idx_ticket_approvers_approver_id` - Query tickets by approver
- `idx_ticket_approvers_status` - Filter by approval status
- `idx_ticket_approvers_pending` - Fast query for pending approvals

---

### 003_create_ticket_audit_log_table.sql
**Purpose**: Create immutable audit trail for all ticket actions

**Table**: `ticket_audit_log`

**Columns**:
- `audit_id` (UUID) - Primary key
- `ticket_id` (UUID) - Foreign key to tickets
- `action_type` (VARCHAR) - Type of action (Created, Updated, Approved, etc.)
- `old_value` (JSONB) - Previous field values
- `new_value` (JSONB) - New field values
- `changed_by` (UUID) - User who made the change
- `changed_date` (TIMESTAMP) - When change occurred
- `ip_address` (VARCHAR) - IP address of the user
- `browser_info` (TEXT) - Browser/device info

**Allowed Action Types**:
- Created
- Updated
- Assigned
- Reassigned
- StatusChanged
- Approved
- Rejected
- Reopened
- Closed
- Deleted
- Restored
- CommentAdded
- AttachmentAdded

**Features**:
- Immutable records (trigger prevents UPDATE/DELETE)
- JSONB storage for flexible before/after values
- Comprehensive audit trail for compliance

**Indexes**:
- `idx_ticket_audit_ticket_id` - Query audit by ticket
- `idx_ticket_audit_changed_by` - Query by user
- `idx_ticket_audit_date` - Query by date (descending)
- `idx_ticket_audit_action` - Filter by action type
- `idx_ticket_audit_composite` - Optimized for ticket history

**Views**:
- `v_ticket_audit_trail` - Read-only audit trail view

---

### 004_create_notifications_table.sql
**Purpose**: Create in-app notification system

**Table**: `notifications`

**Columns**:
- `notification_id` (UUID) - Primary key
- `user_id` (UUID) - Foreign key to user receiving notification
- `ticket_id` (UUID) - Related ticket (optional)
- `notification_type` (VARCHAR) - Type of notification
- `title` (VARCHAR) - Notification title
- `message` (TEXT) - Notification message
- `is_read` (BOOLEAN) - Read status
- `created_date` (TIMESTAMP) - When created
- `read_date` (TIMESTAMP) - When read
- `email_sent` (BOOLEAN) - Email sent flag
- `teams_sent` (BOOLEAN) - Teams sent flag
- `push_sent` (BOOLEAN) - Push notification sent flag
- `related_user_id` (UUID) - User who triggered the notification

**Notification Types**:
- TicketCreated
- TicketAssigned
- TicketReassigned
- TicketResolved
- TicketApproved
- TicketRejected
- TicketReopened
- TicketClosed
- ApprovalRequested
- CommentAdded
- MentionedInComment
- SLAWarning
- SLABreached

**Functions**:
- `mark_notification_read(notification_id)` - Mark as read
- `create_notification(...)` - Create new notification

**Views**:
- `v_unread_notifications_count` - Count unread per user

**Indexes**:
- `idx_notifications_user_id` - Query by user
- `idx_notifications_ticket_id` - Query by ticket
- `idx_notifications_is_read` - Filter by read status
- `idx_notifications_user_unread` - Fast unread count
- `idx_notifications_created_date` - Sort by date
- `idx_notifications_type` - Filter by type

---

### 005_create_rbac_views.sql
**Purpose**: Create role-based access control infrastructure

**Tables Created**:
- `roles` - System roles
- `user_roles` - User-to-role mapping

**Default Roles**:
- BootstrapAdmin - Full system access
- Manager - Team management and approval
- Assignee - Can update assigned tickets
- Approver - Can approve/reject tickets
- Creator - Can create and view own tickets
- User - Basic user role

**Security Functions**:
- `can_view_ticket(user_id, ticket_id)` - Check if user can view ticket

**Access Rules**:
- **BootstrapAdmin**: All tickets (including deleted)
- **Creator**: Own tickets only
- **Assignee**: Assigned tickets only
- **Approver**: Tickets they're assigned to approve
- **Manager**: Team tickets
- **User**: Own tickets and assigned tickets

**Views Created**:
- `v_accessible_tickets` - Tickets user can access
- `v_pending_approvals` - Tickets pending user's approval
- `v_closed_tickets_recent` - Closed tickets (last 30 days)
- `v_deleted_tickets` - Deleted tickets (recycle bin)

---

## Running Migrations

### Prerequisites
```bash
# Install dependencies
npm install

# Set DATABASE_URL in .env
DATABASE_URL=postgresql://user:password@host:port/database
```

### Execute All Migrations
```bash
npm run migrate
```

### Manual Execution
```bash
# Run individual migration
psql -U user -d database -f migrations/001_add_ticket_fields.sql

# Or from Node.js
node run-migrations.js
```

---

## Rollback Strategy

Since migrations use `IF NOT EXISTS` and `IF EXISTS`, they are idempotent and safe to re-run.

**To rollback**:
1. Manually remove the created tables/columns
2. Or create a separate rollback script (recommended for production)

Example rollback:
```sql
-- Rollback 005
DROP VIEW IF EXISTS v_deleted_tickets CASCADE;
DROP VIEW IF EXISTS v_closed_tickets_recent CASCADE;
DROP VIEW IF EXISTS v_pending_approvals CASCADE;
DROP VIEW IF EXISTS v_accessible_tickets CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- Rollback 004
DROP VIEW IF EXISTS v_unread_notifications_count CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;

-- Rollback 003
DROP TRIGGER IF EXISTS trigger_prevent_audit_update ON ticket_audit_log;
DROP VIEW IF EXISTS v_ticket_audit_trail CASCADE;
DROP TABLE IF EXISTS ticket_audit_log CASCADE;

-- Rollback 002
DROP TRIGGER IF EXISTS trigger_update_ticket_approvers_timestamp ON ticket_approvers;
DROP TABLE IF EXISTS ticket_approvers CASCADE;

-- Rollback 001
DROP INDEX IF EXISTS idx_tickets_status_deleted;
DROP INDEX IF EXISTS idx_tickets_due_date;
DROP INDEX IF EXISTS idx_tickets_is_deleted;
DROP INDEX IF EXISTS idx_tickets_assigned_to;
DROP INDEX IF EXISTS idx_tickets_created_by;
```

---

## Testing Migrations

```sql
-- Test 001: Check new columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name='tickets' AND column_name IN (
    'created_by', 'assigned_to', 'approval_mode', 'is_deleted'
);

-- Test 002: Check ticket_approvers table
SELECT * FROM information_schema.tables
WHERE table_name='ticket_approvers';

-- Test 003: Check audit log exists
SELECT * FROM information_schema.tables
WHERE table_name='ticket_audit_log';

-- Test 004: Check notifications table
SELECT * FROM information_schema.tables
WHERE table_name='notifications';

-- Test 005: Check RBAC views
SELECT * FROM information_schema.views
WHERE table_schema='yc_tkt_mgmt' AND table_name LIKE 'v_%';
```

---

## Performance Considerations

- All indexes are created for optimal query performance
- JSONB storage in audit log allows flexible tracking
- Views are optimized for common queries
- Triggers for automatic timestamp updates
- Cascade deletes for referential integrity

---

## Compliance & Audit

✅ Immutable audit trail (can't edit/delete logs)  
✅ All changes tracked with user, timestamp, IP, browser  
✅ Soft delete with recycle bin for admins  
✅ Role-based access control enforced  
✅ Complete action history  
✅ GDPR-compliant data retention  

---

## Support

For issues or questions:
1. Check the migration logs
2. Verify PostgreSQL version (11+)
3. Ensure DATABASE_URL is correct
4. Check user permissions on schema
