# Enterprise Ticket Management System - Implementation Plan

## Phase 1: Database Schema Enhancement

### 1.1 New Ticket Fields
```sql
ALTER TABLE yc_tkt_mgmt.tickets ADD COLUMN (
    created_by UUID NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    assigned_to UUID REFERENCES yc_tkt_mgmt.users(id),
    due_date TIMESTAMP,
    approver_required BOOLEAN DEFAULT true,
    approval_mode VARCHAR(20) CHECK (approval_mode IN ('AnyOne', 'AllMustApprove')),
    resolution_summary TEXT,
    root_cause TEXT,
    corrective_action TEXT,
    closure_remarks TEXT,
    closed_date TIMESTAMP,
    is_deleted BOOLEAN DEFAULT false,
    deleted_by UUID REFERENCES yc_tkt_mgmt.users(id),
    deleted_date TIMESTAMP,
    delete_reason TEXT
);
```

### 1.2 TicketApprovers Table
```sql
CREATE TABLE yc_tkt_mgmt.ticket_approvers (
    ticket_approver_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
    approver_user_id UUID NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    approval_status VARCHAR(20) DEFAULT 'Pending' CHECK (approval_status IN ('Pending', 'Approved', 'Rejected', 'Reopened')),
    approval_date TIMESTAMP,
    comments TEXT,
    action_taken_by UUID REFERENCES yc_tkt_mgmt.users(id),
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ticket_id, approver_user_id)
);
```

### 1.3 TicketAuditLog Table
```sql
CREATE TABLE yc_tkt_mgmt.ticket_audit_log (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    changed_by UUID NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    changed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    browser_info TEXT,
    INDEX idx_ticket_audit (ticket_id),
    INDEX idx_audit_date (changed_date)
);
```

### 1.4 Notification Queue Table
```sql
CREATE TABLE yc_tkt_mgmt.notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    ticket_id UUID REFERENCES yc_tkt_mgmt.tickets(id),
    notification_type VARCHAR(50),
    message TEXT,
    is_read BOOLEAN DEFAULT false,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_date TIMESTAMP,
    email_sent BOOLEAN DEFAULT false,
    teams_sent BOOLEAN DEFAULT false,
    INDEX idx_user_notifications (user_id, is_read)
);
```

## Phase 2: Backend API Endpoints

### 2.1 Ticket Management
- `POST /api/tickets` - Create ticket (with approvers)
- `PUT /api/tickets/:id` - Update ticket
- `GET /api/tickets/:id` - Get ticket details
- `GET /api/tickets` - List tickets (with row-level security)
- `DELETE /api/tickets/:id` - Soft delete (admin only)
- `POST /api/tickets/:id/restore` - Restore deleted ticket (admin only)

### 2.2 Approval Workflow
- `POST /api/tickets/:id/resolve` - Mark as resolved
- `GET /api/tickets/:id/approvers` - Get approvers
- `POST /api/tickets/:id/approval` - Submit approval
- `POST /api/tickets/:id/reject` - Reject and reopen
- `GET /api/approvals/pending` - Get approver dashboard

### 2.3 Audit & History
- `GET /api/tickets/:id/audit-log` - Get audit trail
- `GET /api/tickets/:id/activity` - Get activity feed
- `GET /api/admin/deleted-tickets` - Recycle bin (admin only)

## Phase 3: Frontend Components

### 3.1 Create Ticket Form Enhanced
- Add "Select Approvers" multi-select
- Add "Approval Mode" toggle (AnyOne / AllMustApprove)
- Validation: Prevent self-assignment
- Validation: Require at least one approver

### 3.2 Approver Dashboard
- List pending approvals
- Show resolution summary, root cause, corrective action
- Approve/Reject buttons with comments
- Timeline view of approval process

### 3.3 Ticket Detail View
- Show ticket lifecycle timeline
- Show approval status
- Show audit trail
- Show activity feed
- Action buttons based on role & status

### 3.4 Dashboard KPIs
- Open Tickets count
- Assigned Tickets count
- In Progress count
- Pending Approval count
- Reopened count
- Closed count
- SLA Breached count

## Phase 4: Security & RBAC

### 4.1 Role Definitions
```
- Bootstrap Admin: All permissions
- Manager: View team tickets, approve
- Assignee: Update assigned tickets, add notes
- Approver: Review and approve tickets
- Creator: View own tickets
```

### 4.2 Row-Level Security Rules
- Creator: Can view own tickets only
- Assignee: Can view assigned tickets
- Approver: Can view tickets where assigned as approver
- Manager: Can view team tickets
- Bootstrap Admin: Can view all tickets

### 4.3 Audit Logging
- Log all actions with user, timestamp, IP, browser info
- Store old/new values in JSONB
- Make audit log immutable (read-only)

## Phase 5: Implementation Order

1. ✅ Database migrations (schema changes)
2. ✅ Backend API endpoints
3. ✅ Approval workflow logic
4. ✅ RBAC & row-level security
5. ✅ Audit logging system
6. ✅ Notification system
7. ✅ Frontend forms & components
8. ✅ Dashboard enhancements
9. ✅ Testing & deployment

## Phase 6: Deliverables

### Database Files
- `migration_001_add_ticket_fields.sql`
- `migration_002_create_approvers_table.sql`
- `migration_003_create_audit_log_table.sql`
- `migration_004_create_notifications_table.sql`

### Backend Files
- Updated `server.js` with new endpoints
- `approval-controller.js` - Approval logic
- `audit-service.js` - Audit logging
- `notification-service.js` - Notifications
- `rbac-middleware.js` - Role-based access control

### Frontend Files
- Enhanced `CreateTicket` component
- New `ApprovalDashboard` component
- New `TicketDetail` component
- New `AuditTrail` component
- Enhanced `Dashboard` with KPIs

## Estimated Timeline
- Database: 2 hours
- Backend: 4-6 hours
- Frontend: 4-6 hours
- Testing: 2-3 hours
- **Total: 12-17 hours**

## Success Criteria
✅ All tickets have approval workflow
✅ Role-based access control working
✅ Audit trail logs all actions
✅ Approvers can approve/reject
✅ Soft delete with recycle bin
✅ All new fields in database
✅ UI matches Power Apps design
✅ Full audit compliance

---

**Ready to implement?** Reply with:
- **"Start with Database"** → Create all migration scripts
- **"Start with Backend"** → Create API endpoints & logic
- **"Start with Frontend"** → Create React components
- **"Full Implementation"** → Do everything at once
