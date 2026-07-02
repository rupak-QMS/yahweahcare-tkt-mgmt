# User & Ticket Audit Report - May 24, 2026

## Demo Users in System

| ID | Name | Email | Role | Department |
|---|---|---|---|---|
| u1 | Ron Costa | ron@wmxsolutions.com.au | super_admin | Management |
| u2 | Alex | alex@yahwehpc.com.au | super_admin | Management |
| u3 | Liam O'Brien | liam@yahwehcare.com.au | manager | Facilities |
| u4 | Mei Tanaka | mei@yahwehcare.com.au | manager | HR |
| u5 | Jack Williams | jack@yahwehcare.com.au | user | Clinical Care |
| u6 | Priya Sharma | priya@yahwehpc.com.au | user | Community Services |
| u7 | Noah Brown | noah@yahwehpc.com.au | user | Allied Health |
| u8 | Yara Ahmed | yara@yahwehcare.com.au | user | Operations |
| u9 | Sarah Chen | sarah@yahwehcare.com.au | manager | Clinical Care |
| u10 | David Park | david@yahwehcare.com.au | manager | Operations |
| u11 | Aisha Patel | aisha@yahwehcare.com.au | manager | IT Service Desk |

## Tickets by User (Current State)

### U1 (Ron Costa) - YOUR ACCOUNT
**Email:** ron@wmxsolutions.com.au

#### Issued by Ron (Requester):
1. T#YPC-TKT-2026-2001 - "testing" - Assigned to u2 - Status: open
2. T#YPC-TKT-2026-2003 - "Safety check" - Assigned to u3 - Status: open
3. T#YPC-TKT-2026-2006 - "Compliance form" - Assigned to u4 - Status: open

**Total Issued: 3**

#### Assigned to Ron (Assignee):
1. T#YPC-TKT-2026-2000 - "test" - From u8 - Status: open - Priority: urgent
2. T#YPC-TKT-2026-2008 - "Client complaint" - From u6 - Status: open - Priority: high
3. T#YPC-TKT-2026-2013 - "Care plan import" - From u6 - Status: in_progress - Priority: high
4. T#YPC-TKT-2026-2017 - "NDIS quarterly pack" - From u5 - Status: in_progress - Priority: medium
5. T#YPC-TKT-2026-2030 - "Incident report" - From u5 - Status: escalated - Priority: urgent
6. T#YPC-TKT-2026-2780 - "Complaint" - From u5 - Status: closed - Priority: low

**Total Assigned: 6**

### Summary for U1 (Ron Costa):
- **Total Tickets:** 9
- **Active (Open + In Progress + Escalated):** 8
- **Inactive (Closed + Resolved):** 1
- **Status Breakdown (Active):**
  - Open: 5
  - In Progress: 2
  - Escalated: 1
  - Closed: 1
- **Priority Breakdown:**
  - Urgent: 3
  - High: 2
  - Medium: 2
  - Low: 1

## Expected Badge Count
When logged in as Ron Costa (u1) and clicking "My Tickets":
- **Badge should show: 8** (active tickets, excluding closed/resolved)
- **Stat cards should show:**
  - Total: 9
  - Open: 5
  - In Progress: 2
  - Resolved: 1 (closed status)
  - Escalated: 1
  - Urgent: 3 (overlaps with above)

## Current Issue
- **Expected badge count:** 8
- **Actual badge count:** 25 (showing ALL tickets instead of just Ron's)
- **Root cause:** User ID matching is failing

### Why Matching Fails:
1. ❌ Email match failed (Microsoft login email doesn't match demo user email)
2. ❌ Name match failed (Microsoft login name doesn't match)
3. ❌ ID match failed (Microsoft ID doesn't match demo user ID)
4. **Result:** System uses Microsoft ID instead of u1, so filters don't find any tickets

## Solutions

### Option 1: Fix User ID Matching (Recommended)
- ✓ User email already updated to ron@wmxsolutions.com.au
- Need to verify Microsoft login is returning the correct email
- Debug panel shows what email the system actually receives

### Option 2: Clean Rebuild Seed Data
- Delete all old tickets
- Create fresh set with clear assignments
- Ensure data consistency

### Option 3: Manual Demo User Assignment
- Allow user to manually select which demo user they're logged in as
- Override automatic email matching

## Verification Steps
1. Open debug panel on Dashboard
2. Check "Logged In User" email value
3. Compare with Ron Costa's email (ron@wmxsolutions.com.au)
4. If different, that's the issue
5. Update Microsoft/Azure configuration accordingly

---
**Status:** Investigation Required
**Next Step:** Check actual login email returned by Microsoft Entra
