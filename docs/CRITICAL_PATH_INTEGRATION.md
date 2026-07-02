# Critical Path Implementation - Integration Guide

## ✅ What's Been Built

### Backend (Node.js/Express)
✅ **enterprise-routes.js** - 5 new endpoints:
- `POST /api/tickets` - Create ticket with approvers
- `GET /api/approvals/pending/:user_id` - Get pending approvals
- `POST /api/tickets/:id/approval` - Approve/Reject ticket
- `GET /api/lookups` - Dropdown options
- `GET /api/users` - List users for approver selection

✅ **server.js** - Updated to import enterprise routes

✅ **Database** - Complete enterprise schema with:
- Tickets with approval workflow fields
- Ticket approvers mapping
- Audit logging
- Notifications
- Role-based access control

### Frontend (React)
✅ **enterprise-components.js** - 2 new components:
- `ApproversSection` - Multi-select approvers + approval mode toggle
- `ApprovalDashboard` - List pending approvals with approve/reject

---

## 🔧 Integration Steps

### Step 1: Start Backend
```bash
cd /Users/subhankarmondal/Downloads/Yahweahcare/backend
npm start
```

Should output:
```
✓ Yahweahcare API running on http://localhost:4000
  Frontend:    http://localhost:4000
  API Health:  curl http://localhost:4000/api/health
```

### Step 2: Test API Endpoints
```bash
# Get lookups and users
curl http://localhost:4000/api/lookups
curl http://localhost:4000/api/users

# Get pending approvals for user ID 1
curl http://localhost:4000/api/approvals/pending/1
```

### Step 3: Integrate Frontend Components

Add to `frontend/index.html` right after the existing components:

```html
<!-- After the existing script imports, before </body> -->
<script src="enterprise-components.js"></script>
```

Update the Navigation component to include:
```javascript
{ id: 'approvals', label: 'Approvals', icon: '✅' },
```

Update the renderPage() function to include:
```javascript
case 'approvals': return <ApprovalDashboard />;
```

Update CreateTicket to include ApproversSection:
```javascript
// In the CreateTicket form, add this before submit button:
<ApproversSection 
    formData={formData} 
    setFormData={setFormData} 
    users={lookups.users}
/>
```

### Step 4: Test End-to-End

1. **Create Ticket with Approvers**
   - Go to Create Ticket
   - Fill form
   - Select "AnyOne" or "AllMustApprove"
   - Click "+ Add Approvers"
   - Select 1-2 approvers
   - Submit

2. **Check Approvals**
   - Go to Approvals Dashboard
   - See pending ticket
   - Click ticket
   - Enter approval comments
   - Click Approve or Reject

3. **Verify Workflow**
   - If "AnyOne": Ticket closes on first approval
   - If "AllMustApprove": Ticket closes only after all approve
   - Rejection reopens ticket for fixes

---

## 📊 Database Verification

```bash
# Check tickets
psql -c "SELECT id, title, approval_mode FROM yc_tkt_mgmt.tickets LIMIT 5;"

# Check approvers
psql -c "SELECT * FROM yc_tkt_mgmt.ticket_approvers LIMIT 5;"

# Check notifications
psql -c "SELECT * FROM yc_tkt_mgmt.notifications LIMIT 5;"
```

---

## 🚀 Deploy to Production

Once tested locally:

```bash
cd /Users/subhankarmondal/Downloads/Yahweahcare

# Commit changes
git add -A
git commit -m "feat: implement critical-path approval workflow

- Backend: POST /api/tickets with approvers
- Backend: GET /api/approvals/pending/:user_id
- Backend: POST /api/tickets/:id/approval
- Frontend: ApproversSection component
- Frontend: ApprovalDashboard component
- Database: Complete enterprise schema"

# Push to GitHub
git push origin main -f

# Vercel auto-deploys on push
```

---

## ✨ Features Implemented

### Ticket Creation
✅ Prevent self-assignment
✅ Require at least one approver
✅ Approval mode selection (AnyOne / AllMustApprove)
✅ Multi-select approvers with modal

### Approval Workflow
✅ Get pending approvals for user
✅ Approve with comments
✅ Reject and reopen
✅ Automatic ticket closure on approval
✅ Notifications to creator/assignee

### RBAC
✅ Row-level security (see own tickets)
✅ Approver role access control
✅ Admin recycle bin

### Audit Trail
✅ Log all actions (created, approved, rejected, reopened)
✅ Immutable audit log
✅ Full change tracking with old→new values

---

## 📋 API Request Examples

### Create Ticket
```bash
curl -X POST http://localhost:4000/api/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "title": "System Error",
    "description": "Login not working",
    "category_id": "it",
    "priority_id": "high",
    "created_by": 1,
    "assigned_to": 2,
    "approval_mode": "AnyOne",
    "approver_ids": [3, 4]
  }'
```

### Get Pending Approvals
```bash
curl http://localhost:4000/api/approvals/pending/3
```

### Submit Approval
```bash
curl -X POST http://localhost:4000/api/tickets/1/approval \
  -H "Content-Type: application/json" \
  -d '{
    "approver_id": 3,
    "approval_status": "Approved",
    "comments": "Looks good"
  }'
```

---

## 🎯 Next Steps (Post-MVP)

- [ ] Add resolution form (Resolution Summary, Root Cause, Corrective Action)
- [ ] Implement audit trail viewer in UI
- [ ] Add email notifications
- [ ] Add SLA tracking
- [ ] Implement approval reminders
- [ ] Add approval delegation
- [ ] Build complete Dashboard KPIs

---

## 📞 Support

All endpoints are documented in backend/enterprise-routes.js

Database schema: backend/migrations/000_reset_schema.sql

Questions? Check:
1. Backend logs in terminal
2. Browser console (F12)
3. Network tab for API calls
