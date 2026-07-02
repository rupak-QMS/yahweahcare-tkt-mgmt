# Ticket Resolution Approval Workflow - May 24, 2026

## Overview

This feature implements a **ticket approval workflow** that ensures proper governance over ticket closure. When an assignee completes their work on a ticket, the requester must review and approve the resolution before the ticket is fully closed.

## Workflow Steps

### 1️⃣ Assignee Marks Ticket as Complete

- Navigate to the ticket detail view
- Click the **"Mark Complete"** button in the ticket actions
- Status changes from `open/in_progress/escalated` → `pending_approval`
- The assignee can add comments with resolution details

### 2️⃣ Requester Receives Notification

The ticket requester (person who created the ticket) receives:

✉️ **Email Notification**
- Subject: "Ticket awaiting your approval"
- Body: "[Assignee Name] marked the ticket as complete. Please review and approve, or reopen with feedback."
- Includes ticket number and assignee information

🔔 **Push Notification**
- Real-time alert: "Ticket awaiting your approval"
- Can be acted upon immediately

### 3️⃣ Dashboard "Pending Approvals" Section

The requester sees a new **"Pending Approvals"** section on the Dashboard showing:

- **Ticket Number** - Reference identifier
- **Title** - Ticket description
- **Assignee** - Who completed the work
- **Latest Comment** - Resolution provided by assignee (first 200 characters)
- **Two Action Buttons:**
  - ✓ **Approve & Close** - Accepts resolution, closes ticket
  - ↻ **Request More Work** - Opens dialog for feedback

### 4️⃣ Requester Approves Resolution

**Option A: Accept the Resolution**
- Click **"✓ Approve & Close"**
- Status changes: `pending_approval` → `closed`
- Ticket is archived
- Assignee receives notification: "Your resolution was approved. Ticket is now closed."

**Option B: Request More Work**
- Click **"↻ Request More Work"**
- Modal appears asking for feedback
- Provide clear instructions on what needs to be done
- Status changes: `pending_approval` → `open`
- Ticket reopens with:
  - Comment from requester: "🔄 Reopened: [feedback message]"
  - Activity log: "Reopened with feedback"
  - Assignee is notified: "[Requester Name] reopened this ticket. Feedback: [your message]"

## Status Flow Diagram

```
open / in_progress / escalated
        ↓
    [Mark Complete]
        ↓
pending_approval ← (Awaiting Requester Review)
    ↙          ↘
[Approve]    [Request More Work]
  ↓                ↓
closed          open  (with feedback)
(Final)         (resumes work)
```

## Key Features

### ✅ Full Governance
- No ticket closes without requester approval
- Maintains accountability trail
- Only authorized person can close

### 📧 Smart Notifications
- Email with details of resolution
- Push notification for immediate action
- Activity log captures all actions
- Feedback is preserved in comments

### 🔍 Clear Resolution Details
- Pending approvals section shows:
  - Latest comment/resolution provided
  - Assignee information
  - Ticket context (title, number)

### ↩️ Flexible Reopening
- Requester can request changes with specific feedback
- Feedback becomes a comment on the ticket
- Clear communication loop

## User Roles & Permissions

| Role | Can Mark Complete | Can Approve | Can Reopen |
|---|---|---|---|
| Assignee | ✅ Yes | ❌ No | ❌ No |
| Requester | ❌ No | ✅ Yes | ✅ Yes |
| Manager | ✅ Yes | ✅ Yes | ✅ Yes |
| Super Admin | ✅ Yes | ✅ Yes | ✅ Yes |

## Notification Details

### Email Format (Pending Approval)
```
Subject: [Yahweh Care] Ticket awaiting your approval

Body:
"[Assignee Name] marked YPC-TKT-XXXX as complete and is awaiting your approval.

Ticket: [Ticket Title]
Assignee: [Name]
Status: Pending Approval

Latest Resolution: [First 200 chars of comment]

Action Required: Please review the resolution and either:
1. Approve and close the ticket
2. Request more work with specific feedback"
```

### Push Notification
```
Title: "Ticket awaiting your approval"
Body: "[Assignee Name] marked YPC-TKT-XXXX as complete"
Action: Open Dashboard or Ticket Detail
```

## Activity Log Entries

Each action creates an audit trail:

- ✏️ Assignee action: `"Marked complete — awaiting approval"`
- ✅ Requester approval: `"Approved and closed"`
- 🔄 Requester reopening: `"Reopened with feedback"`

## Feedback Example

When requesting more work:

```
Modal Title: "Request More Work on Ticket"
Prompt: "What else needs to be done?"

Example Feedback:
"The authentication module needs to be tested 
against the new security requirements. Please 
run through the OWASP checklist and report 
any vulnerabilities found."
```

This feedback becomes:
- A comment on the ticket: "🔄 Reopened: [your feedback]"
- Visible to assignee in activity log
- Part of permanent ticket history

## Testing the Workflow

### Prerequisites
- Two different users
- A ticket assigned to one user

### Test Steps
1. **User A (Assignee):**
   - Open a ticket assigned to them
   - Click "Mark Complete" button
   - (Optional) Add comment with resolution details
   - Ticket status → `pending_approval`

2. **User B (Requester):**
   - Go to Dashboard
   - Look for "Pending Approvals" section
   - Review the ticket details
   - Click "✓ Approve & Close" or "↻ Request More Work"

3. **If Approved:**
   - User A receives email: "Your resolution was approved"
   - Ticket status → `closed`
   - Ticket appears in "Resolved" stat card

4. **If Reopened:**
   - Modal appears for feedback
   - Enter: "Please add unit tests for edge cases"
   - Ticket status → `open`
   - User A sees comment: "🔄 Reopened: Please add unit tests..."
   - User A receives email with feedback
   - Workflow can repeat

## Integration Points

### Affected Components
- ✅ Dashboard: New "Pending Approvals" section
- ✅ Notifications: Email + Push for pending approvals
- ✅ Ticket Detail: "Mark Complete" button triggers workflow
- ✅ Status Flow: `pending_approval` status added
- ✅ Activity Log: Tracks all approval/rejection actions
- ✅ Comments: Resolution notes preserved

### Database Fields
- `status`: Updated to include `pending_approval`
- `resolvedAt`: Set when marked complete
- `comments`: Stores resolution and feedback
- `activity`: Logs approval/rejection actions

## Best Practices

### For Assignees
1. ✏️ Add a detailed comment explaining the resolution
2. 📝 Include any test results or validation done
3. 🔗 Reference documentation or commits if applicable
4. ⏱️ Keep feedback concise but thorough

### For Requesters
1. 👀 Review the resolution promptly
2. 💬 Provide specific feedback if reopening
3. 📋 Reference requirements if more work is needed
4. ✅ Approve promptly if satisfied with resolution

## Limitations & Future Enhancements

### Current
- Simple approval (approve/reject binary choice)
- Single-level approval (only requester approves)
- Text-based feedback only

### Potential Enhancements
1. **Multi-level Approvals** - Manager approval before final closure
2. **Approval Templates** - Pre-defined feedback messages
3. **SLA Tracking** - Track approval time as part of SLA
4. **Partial Approval** - Approve with conditions
5. **Bulk Actions** - Approve multiple tickets at once
6. **Approval History** - View past approval decisions

---

**Status**: Live & Operational
**Date Implemented**: 24 May 2026
**Last Updated**: 24 May 2026
