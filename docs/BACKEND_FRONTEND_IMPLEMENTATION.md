# Enterprise Backend + Frontend Implementation Guide

## Phase Summary

This implementation adds complete approval workflow, RBAC, and audit features to both backend and frontend.

### Backend Work (Node.js/Express)
1. ✅ Database schema created
2. ⏳ **New enterprise API endpoints** (approval, audit, RBAC)
3. ⏳ Approval workflow logic
4. ⏳ Audit logging service
5. ⏳ Notification service

### Frontend Work (React)
1. ✅ Create Ticket form basic structure
2. ⏳ **Enhanced with approver selection**
3. ⏳ **Approver Dashboard**
4. ⏳ **Ticket Detail with approval UI**
5. ⏳ **Audit Trail viewer**
6. ⏳ **Dashboard KPIs**

---

## Backend Implementation

### New API Endpoints

**Tickets**
```
POST   /api/tickets                    - Create with approvers
GET    /api/tickets                    - List (with RLS)
GET    /api/tickets/:id                - Detail with approvers
POST   /api/tickets/:id/resolve        - Mark resolved
DELETE /api/tickets/:id                - Soft delete
```

**Approval Workflow**
```
GET    /api/approvals/pending/:user_id - Get pending approvals
POST   /api/tickets/:id/approval       - Approve/Reject
```

**Audit & Admin**
```
GET    /api/tickets/:id/audit-log      - Audit trail
GET    /api/admin/deleted-tickets      - Recycle bin
```

**Lookups**
```
GET    /api/lookups                    - Categories, priorities, etc.
GET    /api/users                      - Active users for approver selection
```

---

## Frontend Implementation

### New Components

**1. CreateTicket (Enhanced)**
```
- Form sections: Ticket Details, Reporter Info, Classification, Assignment
- NEW: Approvers multi-select
- Validation: Prevent self-assignment
- Validation: Require at least one approver
- Submit: POST /api/tickets with all data
```

**2. ApprovalDashboard (New)**
```
- List pending approvals
- Show: Ticket#, Title, Creator, Assignee, Priority, Status
- Actions: Approve button, Reject button
- Modal for approval comments
```

**3. TicketDetail (New)**
```
- Full ticket information
- Timeline of approvals
- Approval status per approver
- Action buttons based on role & status
- Comments section
- Audit trail accordion
```

**4. AuditTrail (New)**
```
- Read-only log of all changes
- Show: Action, User, Timestamp, Changes (old → new)
- Immutable (no editing)
```

**5. Dashboard KPIs (Enhanced)**
```
- Open Tickets
- Assigned to You
- Pending Your Approval
- Reopened Tickets
- Closed (This Month)
- SLA Breached
```

---

## Implementation Timeline

### Backend (Phase 1: 2-3 hours)
- [ ] Add enterprise endpoints to server.js
- [ ] Implement approval workflow logic
- [ ] Create audit logging service
- [ ] Test with Postman

### Frontend (Phase 2: 2-3 hours)
- [ ] Enhance CreateTicket form
- [ ] Build ApprovalDashboard
- [ ] Build TicketDetail with approval UI
- [ ] Add AuditTrail viewer
- [ ] Update Dashboard KPIs

### Testing (Phase 3: 1 hour)
- [ ] End-to-end workflow testing
- [ ] Role-based access testing
- [ ] Audit logging verification
- [ ] Deploy to Vercel

---

## File Structure

```
backend/
├── server.js                    (existing - will extend)
├── middleware/
│   └── rbac-middleware.js      (new)
├── services/
│   ├── approval-service.js     (new)
│   ├── audit-service.js        (new)
│   └── notification-service.js (new)
└── routes/
    ├── tickets.js              (new - enterprise)
    ├── approvals.js            (new)
    └── audit.js                (new)

frontend/
├── index.html                  (existing - will enhance)
├── components/
│   ├── CreateTicket.jsx        (enhanced)
│   ├── ApprovalDashboard.jsx   (new)
│   ├── TicketDetail.jsx        (new)
│   ├── AuditTrail.jsx          (new)
│   └── Dashboard.jsx           (enhanced)
```

---

## Next Steps

1. Create backend service files
2. Extend server.js with new routes
3. Create frontend components
4. Test and deploy

Ready to start? 🚀
