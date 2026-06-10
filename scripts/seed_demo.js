// Run: node scripts/seed_demo.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://neondb_owner:npg_yGDK7rPbU1St@ep-hidden-hat-a78c5hgh-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Connected to Neon DB');

    // ── Ensure columns exist ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.ticket_approvers (
        id                SERIAL PRIMARY KEY,
        ticket_id         INTEGER NOT NULL REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE CASCADE,
        approver_user_id  INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id),
        approval_status   TEXT NOT NULL DEFAULT 'Pending',
        comments          TEXT,
        approval_date     TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(ticket_id, approver_user_id)
      )
    `);
    await client.query(`
      ALTER TABLE yc_tkt_mgmt.tickets
        ADD COLUMN IF NOT EXISTS resolution_note      TEXT,
        ADD COLUMN IF NOT EXISTS title_type           TEXT,
        ADD COLUMN IF NOT EXISTS subtitle             TEXT,
        ADD COLUMN IF NOT EXISTS subcategory          TEXT,
        ADD COLUMN IF NOT EXISTS pending_approval_at  TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS attachments          JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    console.log('Schema OK');

    // ── Demo 1: In Progress — Yahweh qms assigned, needs to resolve ──
    const d1 = await client.query(`
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
    `);
    const id1 = d1.rows[0].id;
    await client.query(
      `INSERT INTO yc_tkt_mgmt.ticket_approvers (ticket_id, approver_user_id, approval_status)
       VALUES ($1,25,'Pending'),($1,23,'Pending') ON CONFLICT DO NOTHING`, [id1]
    );
    console.log(`Demo 1 created: TKT-${String(id1).padStart(6,'0')} (In Progress, approvers: Saloni + Sunita)`);

    // ── Demo 2: Pending Approval — Saloni resolved, approvers must act ──
    const d2 = await client.query(`
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
    `);
    const id2 = d2.rows[0].id;
    await client.query(
      `INSERT INTO yc_tkt_mgmt.ticket_approvers (ticket_id, approver_user_id, approval_status)
       VALUES ($1,22,'Pending'),($1,29,'Pending') ON CONFLICT DO NOTHING`, [id2]
    );
    console.log(`Demo 2 created: TKT-${String(id2).padStart(6,'0')} (Pending Approval, approvers: Suganty + Akila)`);

    // ── Demo 3: Rejected — Venujah needs to resubmit ──────────────
    const d3 = await client.query(`
      INSERT INTO yc_tkt_mgmt.tickets
        (title, title_type, subtitle, description, category_id, priority_id, status,
         created_by, assigned_to, due_date, expected_completion, resolution_note,
         attachments)
      VALUES (
        'Care Coordination — Day centre booking conflict for 3 clients',
        'Care Coordination', 'Day centre booking conflict for 3 clients',
        'Three clients have been double-booked for the same time slot at the Parramatta day centre on 12 June. Support workers are unavailable to cover both groups simultaneously.',
        'care', 'critical', 'in_progress',
        30, 28, NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day',
        'Contacted the day centre and rescheduled one group to the afternoon session. Clients and families have been notified.',
        '[]'
      )
      RETURNING id
    `);
    const id3 = d3.rows[0].id;
    await client.query(
      `INSERT INTO yc_tkt_mgmt.ticket_approvers
         (ticket_id, approver_user_id, approval_status, comments, approval_date)
       VALUES ($1, 23, 'Rejected',
         'The resolution is incomplete — two of the three clients have not been notified. Please provide confirmation from all families.',
         NOW() - INTERVAL '1 hour')
       ON CONFLICT DO NOTHING`, [id3]
    );
    console.log(`Demo 3 created: TKT-${String(id3).padStart(6,'0')} (Rejected/Reopened, approver: Sunita)`);

    // ── Demo 4: Fully Resolved — all approved ─────────────────────
    const d4 = await client.query(`
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
        'Onboarding checklist updated to include: NDIS Worker Screening requirements, updated Privacy Act obligations, new incident reporting procedure, and digital timesheet training. Saved to SharePoint.',
        NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day', '[]'
      )
      RETURNING id
    `);
    const id4 = d4.rows[0].id;
    await client.query(
      `INSERT INTO yc_tkt_mgmt.ticket_approvers
         (ticket_id, approver_user_id, approval_status, approval_date)
       VALUES ($1,22,'Approved',NOW()-INTERVAL '1 day'),
              ($1,30,'Approved',NOW()-INTERVAL '1 day')
       ON CONFLICT DO NOTHING`, [id4]
    );
    console.log(`Demo 4 created: TKT-${String(id4).padStart(6,'0')} (Resolved, both approvers approved)`);

    // ── Demo 5: New + Unassigned — test full creation flow ───────
    const d5 = await client.query(`
      INSERT INTO yc_tkt_mgmt.tickets
        (title, title_type, subtitle, description, category_id, priority_id, status,
         created_by, assigned_to, due_date, expected_completion, attachments)
      VALUES (
        'Facilities & Maintenance — Air conditioning fault in Group Room 2',
        'Facilities & Maintenance', 'Air conditioning fault in Group Room 2',
        'Ducted AC unit in Group Room 2 at Blacktown site has stopped working. Room temperature is uncomfortable for clients during day centre activities.',
        'facilities', 'medium', 'new',
        30, NULL, NOW() + INTERVAL '7 days', NOW() + INTERVAL '7 days', '[]'
      )
      RETURNING id
    `);
    console.log(`Demo 5 created: TKT-${String(d5.rows[0].id).padStart(6,'0')} (New, unassigned — add approvers via UI)`);

    // ── Demo 6: Waiting — James assigned, Saloni approver ────────
    const d6 = await client.query(`
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
    `);
    const id6 = d6.rows[0].id;
    await client.query(
      `INSERT INTO yc_tkt_mgmt.ticket_approvers (ticket_id, approver_user_id, approval_status)
       VALUES ($1,25,'Pending') ON CONFLICT DO NOTHING`, [id6]
    );
    console.log(`Demo 6 created: TKT-${String(id6).padStart(6,'0')} (Waiting, approver: Saloni)`);

    console.log('\n✅ All 6 demo tickets seeded successfully!');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
