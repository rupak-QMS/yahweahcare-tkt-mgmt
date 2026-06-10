-- ============================================================
-- Yahweahcare Demo Tickets Seed
-- Run this in DBeaver or psql against your Neon DB
-- ============================================================
-- Users reference (active):
--   id=30  Ron Costa       (Director / Bootstrap Admin)
--   id=21  Alex            (Director / Bootstrap Admin)
--   id=41  Yahweh qms      (Strategic, assignee test user)
--   id=22  Suganty P       (Operations Manager)
--   id=23  Sunita Maharjan (Service Delivery Manager)
--   id=24  Elenor Elia     (Operations)
--   id=25  Saloni          (Support Coordination Lead)
--   id=26  James Baskaran  (Operations)
--   id=27  Miejkyla        (HR / Admin)
--   id=28  Venujah         (Day Centre Officer)
--   id=29  Akila           (Finance Manager)
-- ============================================================

-- Ensure ticket_approvers table exists
CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.ticket_approvers (
    id                SERIAL PRIMARY KEY,
    ticket_id         INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
    approver_user_id  INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
    approval_status   TEXT NOT NULL DEFAULT 'Pending',
    comments          TEXT,
    approval_date     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(ticket_id, approver_user_id)
);

ALTER TABLE yc_tkt_mgmt.tickets
    ADD COLUMN IF NOT EXISTS resolution_note TEXT,
    ADD COLUMN IF NOT EXISTS title_type TEXT,
    ADD COLUMN IF NOT EXISTS subtitle TEXT,
    ADD COLUMN IF NOT EXISTS subcategory TEXT,
    ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS pending_approval_at TIMESTAMPTZ;

-- ============================================================
-- DEMO 1: In Progress — ready for assignee to mark complete
-- Assigned to: Yahweh qms (41)   Approvers: Saloni (25) + Sunita (23)
-- Purpose: test "Mark as Complete" → submit resolution → approvers see it
-- ============================================================
WITH ins AS (
  INSERT INTO yc_tkt_mgmt.tickets
    (title, title_type, subtitle, description, category_id, priority_id, status,
     created_by, assigned_to, due_date, expected_completion, attachments)
  VALUES (
    'IT Support — Laptop cannot connect to VPN',
    'IT Support', 'Laptop cannot connect to VPN',
    'Staff member is unable to connect to the company VPN from home. Error: authentication timeout. Affects ability to access NDIS records remotely.',
    'it', 'high', 'in_progress',
    30, 41, NOW() + INTERVAL '3 days', NOW() + INTERVAL '3 days', '[]'
  )
  RETURNING id
)
INSERT INTO yc_tkt_mgmt.ticket_approvers (ticket_id, approver_user_id, approval_status)
SELECT ins.id, uid, 'Pending'
FROM ins, (VALUES (25), (23)) AS approvers(uid)
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO 2: Pending Approval — assignee submitted resolution, waiting for approval
-- Assigned to: Saloni (25)   Approvers: Suganty (22) + Akila (29)
-- Purpose: test approver "Approve" / "Reject" buttons
-- ============================================================
WITH ins AS (
  INSERT INTO yc_tkt_mgmt.tickets
    (title, title_type, subtitle, description, category_id, priority_id, status,
     created_by, assigned_to, due_date, expected_completion, resolution_note,
     pending_approval_at, attachments)
  VALUES (
    'HR & Payroll — Incorrect superannuation deduction for June',
    'HR & Payroll', 'Incorrect superannuation deduction for June',
    'Support worker Elenor reported her June payslip shows an incorrect super deduction. Expected 11% but only 9.5% was applied. Requires payroll correction and confirmation from finance.',
    'hr', 'medium', 'pending_approval',
    30, 25, NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days',
    'Reviewed payroll records and corrected the super rate to 11% as per ATO guidelines. A revised payslip will be issued within 24 hours. Finance has been notified for EOM reconciliation.',
    NOW() - INTERVAL '2 hours', '[]'
  )
  RETURNING id
)
INSERT INTO yc_tkt_mgmt.ticket_approvers (ticket_id, approver_user_id, approval_status)
SELECT ins.id, uid, 'Pending'
FROM ins, (VALUES (22), (29)) AS approvers(uid)
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO 3: Reopened (Rejected) — approver rejected, assignee must resubmit
-- Assigned to: Venujah (28)   Approvers: Sunita (23)
-- Purpose: test "Resubmit Revised Resolution" flow
-- ============================================================
WITH ins AS (
  INSERT INTO yc_tkt_mgmt.tickets
    (title, title_type, subtitle, description, category_id, priority_id, status,
     created_by, assigned_to, due_date, expected_completion, resolution_note,
     attachments)
  VALUES (
    'Care Coordination — Day centre booking conflict for 3 clients',
    'Care Coordination', 'Day centre booking conflict for 3 clients',
    'Three clients have been double-booked for the same time slot at the Parramatta day centre on 12 June. Support workers are unavailable to cover both groups simultaneously. Urgent rescheduling required.',
    'care', 'critical', 'in_progress',
    30, 28, NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day',
    'Contacted the day centre and rescheduled one group to the afternoon session. Clients and families have been notified.',
    '[]'
  )
  RETURNING id
)
INSERT INTO yc_tkt_mgmt.ticket_approvers
  (ticket_id, approver_user_id, approval_status, comments, approval_date)
SELECT ins.id, 23, 'Rejected',
  'The resolution is incomplete — two of the three clients have not been notified. Please provide confirmation from all families before this can be approved.',
  NOW() - INTERVAL '1 hour'
FROM ins
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO 4: Fully Approved → Resolved
-- Assigned to: Miejkyla (27)   Approvers: Suganty (22) approved, Ron (30) approved
-- Purpose: show a completed approval cycle
-- ============================================================
WITH ins AS (
  INSERT INTO yc_tkt_mgmt.tickets
    (title, title_type, subtitle, description, category_id, priority_id, status,
     created_by, assigned_to, due_date, expected_completion, resolution_note,
     pending_approval_at, closed_date, attachments)
  VALUES (
    'General Enquiry — Staff onboarding checklist update',
    'General Enquiry', 'Staff onboarding checklist update',
    'The current staff onboarding checklist is outdated (last updated 2023). New NDIS requirements and internal policy changes need to be incorporated before the next intake in July.',
    'general', 'low', 'resolved',
    30, 27, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days',
    'Onboarding checklist has been updated to include: NDIS Worker Screening requirements, updated Privacy Act obligations, new incident reporting procedure, and digital timesheet training. Document saved to SharePoint and shared with HR.',
    NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day', '[]'
  )
  RETURNING id
)
INSERT INTO yc_tkt_mgmt.ticket_approvers
  (ticket_id, approver_user_id, approval_status, approval_date)
SELECT ins.id, uid, 'Approved', NOW() - INTERVAL '1 day'
FROM ins, (VALUES (22), (30)) AS approvers(uid)
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO 5: New + Unassigned — to test assignment + approver selection
-- Created by Ron (30), no assignee, no approvers yet
-- ============================================================
INSERT INTO yc_tkt_mgmt.tickets
  (title, title_type, subtitle, description, category_id, priority_id, status,
   created_by, assigned_to, due_date, expected_completion, attachments)
VALUES (
  'Facilities & Maintenance — Air conditioning fault in Group Room 2',
  'Facilities & Maintenance', 'Air conditioning fault in Group Room 2',
  'The ducted air conditioning unit in Group Room 2 at the Blacktown site has stopped working. Room temperature is uncomfortable for clients during day centre activities. Maintenance contractor needs to be contacted.',
  'facilities', 'medium', 'new',
  30, NULL, NOW() + INTERVAL '7 days', NOW() + INTERVAL '7 days', '[]'
);

-- ============================================================
-- DEMO 6: IT ticket — assigned to James (26), waiting for external info
-- Approvers: Saloni (25)
-- Purpose: test "Waiting on Requester" status visibility
-- ============================================================
WITH ins AS (
  INSERT INTO yc_tkt_mgmt.tickets
    (title, title_type, subtitle, description, category_id, priority_id, status,
     created_by, assigned_to, due_date, expected_completion, attachments)
  VALUES (
    'IT Support — SharePoint permissions for new staff',
    'IT Support', 'SharePoint permissions for new staff',
    'New staff member Elenor Elia does not have access to the Operations SharePoint folder. Awaiting confirmation from her manager on which sub-folders she should have access to.',
    'it', 'low', 'waiting',
    30, 26, NOW() + INTERVAL '4 days', NOW() + INTERVAL '4 days', '[]'
  )
  RETURNING id
)
INSERT INTO yc_tkt_mgmt.ticket_approvers (ticket_id, approver_user_id, approval_status)
SELECT ins.id, 25, 'Pending'
FROM ins
ON CONFLICT DO NOTHING;

SELECT 'Demo tickets inserted successfully.' AS result;
