/**
 * seed-tickets.js  — run: node seed-tickets.js
 * Deletes all tickets, creates 30 realistic ones across your staff.
 */
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_yGDK7rPbU1St@ep-hidden-hat-a78c5hgh-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false },
});
const S = 'yc_tkt_mgmt';

async function main() {
  const client = await pool.connect();
  try {
    const { rows: users }      = await client.query(`SELECT id, name FROM ${S}.users WHERE is_active=TRUE ORDER BY id`);
    const { rows: categories } = await client.query(`SELECT id, label FROM ${S}.categories ORDER BY sort_order`);
    const { rows: priorities } = await client.query(`SELECT id, label, sla_hours FROM ${S}.priorities ORDER BY sort_order`);

    console.log('Users:', users.map(u=>`[${u.id}] ${u.name}`).join(', '));
    console.log('Categories:', categories.map(c=>c.id).join(', '));
    console.log('Priorities:', priorities.map(p=>p.id).join(', '));

    if (!users.length) { console.error('No active users!'); return; }

    // Helpers
    const cat  = l => categories.find(c=>c.label.toLowerCase().includes(l.toLowerCase()))?.id || categories[0].id;
    const pri  = l => priorities.find(p=>p.label.toLowerCase().includes(l.toLowerCase()))?.id || priorities[0].id;
    const sla  = id => priorities.find(p=>p.id===id)?.sla_hours || 24;
    const now  = Date.now();
    const ago  = d => new Date(now - d*86400000).toISOString();
    const hagoStr = h => new Date(now - h*3600000).toISOString();
    const fut  = d => new Date(now + d*86400000).toISOString().split('T')[0];

    // Status values — tickets.status is a plain text column
    const ST = {
      new:      'new',
      assigned: 'assigned',
      inprog:   'in_progress',
      waiting:  'waiting',
      pendapp:  'pending_approval',
      resolved: 'resolved',
      closed:   'closed',
    };

    // Spread users across positions
    const u = i => users[i % users.length].id;
    const approver = () => users[0].id;

    // Delete all old data
    console.log('\nDeleting old tickets…');
    await client.query(`DELETE FROM ${S}.ticket_approvers`);
    await client.query(`DELETE FROM ${S}.activity`);
    await client.query(`DELETE FROM ${S}.comments`);
    await client.query(`DELETE FROM ${S}.tickets`);
    console.log('Done.\n');

    const tickets = [
      // ── RESOLVED / CLOSED — good SLA ──────────────────────────────
      { title:'IT — Laptop VPN not connecting',           desc:'Unable to connect to company VPN from home after OS update.',           cat:cat('IT'),       pri:pri('high'),   status:ST.resolved, assignTo:u(0), created:ago(10), closed:hagoStr(9*24-6),  dueDate:fut(2) },
      { title:'HR — Leave balance incorrect',             desc:'Annual leave showing 5 days less than approved after May payroll run.',  cat:cat('HR'),       pri:pri('medium'), status:ST.resolved, assignTo:u(1), created:ago(8),  closed:hagoStr(7*24-4),  dueDate:fut(3) },
      { title:'Facilities — AC unit not working Room 204',desc:'Air conditioning faulty in room 204 for two days.',                     cat:cat('Facilit'),  pri:pri('medium'), status:ST.resolved, assignTo:u(2), created:ago(7),  closed:hagoStr(6*24-8),  dueDate:fut(4) },
      { title:'Care — Participant roster update',         desc:'Three participant rosters need updating after schedule changes.',         cat:cat('Care'),     pri:pri('low'),    status:ST.closed,   assignTo:u(1), created:ago(12), closed:hagoStr(11*24-2), dueDate:fut(5) },
      { title:'IT — Printer offline admin office',        desc:'Main admin printer showing offline. Tried restarting.',                  cat:cat('IT'),       pri:pri('low'),    status:ST.closed,   assignTo:u(0), created:ago(6),  closed:hagoStr(5*24-3),  dueDate:fut(3) },
      { title:'Finance — Invoice approval backlog',       desc:'Five supplier invoices past their 48h approval window.',                 cat:cat('Finance'),  pri:pri('high'),   status:ST.resolved, assignTo:u(3), created:ago(5),  closed:hagoStr(4*24-1),  dueDate:fut(2) },
      { title:'Clinical — Policy review sign-off',        desc:'Updated infection control policy requires clinical lead sign-off.',      cat:cat('Clinical'), pri:pri('medium'), status:ST.resolved, assignTo:u(2), created:ago(9),  closed:hagoStr(8*24-5),  dueDate:fut(3) },
      { title:'HR — New staff onboarding checklist',      desc:'Onboarding checklist for two new support workers starting Monday.',      cat:cat('HR'),       pri:pri('medium'), status:ST.closed,   assignTo:u(4), created:ago(14), closed:hagoStr(13*24),   dueDate:fut(4) },
      { title:'General — Staff ID cards not printing',    desc:'ID card printer showing error E05. New staff unable to get cards.',      cat:cat('General'),  pri:pri('medium'), status:ST.resolved, assignTo:u(5), created:ago(3),  closed:hagoStr(2*24-6),  dueDate:fut(2) },
      { title:'Care — Shift handover documentation gap',  desc:'Missing handover notes for Tuesday night shift identified.',             cat:cat('Care'),     pri:pri('medium'), status:ST.closed,   assignTo:u(2), created:ago(5),  closed:hagoStr(4*24-3),  dueDate:fut(3) },
      { title:'Facilities — Hot water system fault',      desc:'Hot water unavailable in bathroom block. Plumber contacted.',           cat:cat('Facilit'),  pri:pri('high'),   status:ST.resolved, assignTo:u(5), created:ago(4),  closed:hagoStr(3*24-4),  dueDate:fut(2) },

      // ── RESOLVED — SLA BREACHED ────────────────────────────────────
      { title:'IT — Server backup failure (3 nights)',    desc:'Nightly backup job failed three consecutive nights. Disk space issues.',  cat:cat('IT'),      pri:pri('critical'),status:ST.resolved,assignTo:u(0), created:ago(5),  closed:hagoStr(3*24-2),  dueDate:ago(4),  slaBreach:true, escalated:true, escBy:u(1), escTo:u(0) },
      { title:'Care — Incident report not submitted',     desc:'Support worker missed mandatory incident submission window.',             cat:cat('Care'),    pri:pri('high'),   status:ST.resolved,assignTo:u(1), created:ago(4),  closed:hagoStr(2*24-1),  dueDate:ago(3),  slaBreach:true },
      { title:'Finance — Payroll run $2,400 discrepancy', desc:'May payroll shows $2,400 discrepancy vs approved budget.',               cat:cat('Finance'), pri:pri('critical'),status:ST.resolved,assignTo:u(3), created:ago(7),  closed:hagoStr(5*24),    dueDate:ago(6),  slaBreach:true, escalated:true, escBy:u(3), escTo:u(1) },
      { title:'IT — Network outage building B',           desc:'Complete network outage affecting 8 workstations since 9am.',            cat:cat('IT'),      pri:pri('critical'),status:ST.closed,  assignTo:u(0), created:ago(6),  closed:hagoStr(5*24-1),  dueDate:ago(5),  slaBreach:false, escalated:true, escBy:u(1), escTo:u(0) },

      // ── IN PROGRESS ───────────────────────────────────────────────
      { title:'IT — Email account migration to O365',     desc:'Migrating three staff email accounts to Microsoft 365.',                 cat:cat('IT'),      pri:pri('high'),   status:ST.inprog,  assignTo:u(0), created:ago(3),  dueDate:fut(2) },
      { title:'Facilities — Wheelchair ramp maintenance', desc:'Annual inspection found minor wear on ramp surface near entrance.',      cat:cat('Facilit'), pri:pri('medium'), status:ST.inprog,  assignTo:u(5), created:ago(2),  dueDate:fut(5) },
      { title:'HR — Performance review cycle setup Q2',   desc:'Setting up Q2 review templates and scheduling sessions for all staff.', cat:cat('HR'),      pri:pri('low'),    status:ST.inprog,  assignTo:u(4), created:ago(4),  dueDate:fut(7) },
      { title:'Care — Three client support plan updates', desc:'Three participant support plans require quarterly review.',              cat:cat('Care'),    pri:pri('medium'), status:ST.inprog,  assignTo:u(2), created:ago(1),  dueDate:fut(4) },
      { title:'Clinical — Staff medication competency',   desc:'Medication competency sign-offs due for renewal for four workers.',      cat:cat('Clinical'),pri:pri('high'),   status:ST.inprog,  assignTo:u(6), created:ago(2),  dueDate:fut(3) },

      // ── PENDING APPROVAL ──────────────────────────────────────────
      { title:'Finance — Budget reallocation $8,500',     desc:'Requesting $8,500 reallocation from training to equipment budget.',     cat:cat('Finance'), pri:pri('high'),   status:ST.pendapp, assignTo:u(3), created:ago(2),  dueDate:fut(3) },
      { title:'HR — Contract extension three casuals',    desc:'Three casual staff contracts up for 6-month extension.',               cat:cat('HR'),      pri:pri('medium'), status:ST.pendapp, assignTo:u(4), created:ago(1),  dueDate:fut(5) },

      // ── OPEN ──────────────────────────────────────────────────────
      { title:'General — Staff kitchen microwave broken', desc:'Microwave stopped working. Requesting replacement.',                    cat:cat('General'), pri:pri('low'),    status:ST.new,     assignTo:u(5), created:ago(1),  dueDate:fut(7) },
      { title:'IT — New staff laptop setup x2',           desc:'Two new support workers starting Monday need laptops configured.',      cat:cat('IT'),      pri:pri('medium'), status:ST.assigned,assignTo:u(0), created:hagoStr(5), dueDate:fut(3) },
      { title:'Care — Transport coordination participant', desc:'Participant needs modified transport for upcoming specialist appointment.',cat:cat('Care'), pri:pri('medium'), status:ST.new,     assignTo:u(1), created:hagoStr(3), dueDate:fut(4) },
      { title:'Facilities — Safety audit follow-up x6',   desc:'Six corrective actions from safety audit due for completion.',          cat:cat('Facilit'), pri:pri('high'),   status:ST.assigned,assignTo:u(5), created:ago(2),  dueDate:fut(2) },

      // ── OVERDUE (open, past due) ──────────────────────────────────
      { title:'IT — CCTV system not recording',           desc:'CCTV at rear entrance not recording for 72 hours. Urgent fix.',         cat:cat('IT'),      pri:pri('critical'),status:ST.assigned,assignTo:u(0), created:ago(5),  dueDate:ago(2), escalated:true, escBy:u(1), escTo:u(0) },
      { title:'Clinical — NDIS audit documentation OD',   desc:'NDIS compliance documentation pack due for submission last Friday.',    cat:cat('Clinical'),pri:pri('critical'),status:ST.inprog,  assignTo:u(6), created:ago(8),  dueDate:ago(3), escalated:true, escBy:u(1), escTo:u(6) },
      { title:'HR — Workplace incident investigation',    desc:'Incident from two weeks ago requires full investigation report.',       cat:cat('HR'),      pri:pri('high'),   status:ST.inprog,  assignTo:u(4), created:ago(14), dueDate:ago(1) },
      { title:'Finance — Supplier invoice past due 10d',  desc:'Utility invoice overdue 10 days — penalty fees will apply today.',     cat:cat('Finance'), pri:pri('high'),   status:ST.new,     assignTo:u(3), created:ago(12), dueDate:ago(2) },
    ];

    let inserted = 0;
    for (const t of tickets) {
      const dueDate  = t.dueDate || fut(sla(t.pri)/24 + 1);
      const createdAt = t.created || ago(1);

      const dueDateOnly = typeof dueDate === 'string' && dueDate.length > 10
        ? dueDate.split('T')[0]
        : dueDate;
      const { rows: [row] } = await client.query(
        `INSERT INTO ${S}.tickets
           (title, description, category_id, priority_id, status,
            created_by, assigned_to, due_date, expected_completion,
            closed_date, is_escalated, escalated_to, escalated_by, escalated_at,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
         RETURNING id`,
        [
          t.title, t.desc, t.cat, t.pri, t.status,
          t.assignTo, t.assignTo,
          dueDateOnly,
          dueDateOnly,
          t.closed || null,
          !!(t.escalated),
          t.escTo   || null,
          t.escBy   || null,
          t.escalated ? createdAt : null,
          createdAt,
        ]
      );
      const ticketId = row.id;

      // Approver
      await client.query(
        `INSERT INTO ${S}.ticket_approvers (ticket_id, approver_user_id, approval_status) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [ticketId, approver(), (t.status===ST.closed||t.status===ST.resolved) ? 'Approved' : 'Pending']
      );

      // Activity: created
      await client.query(
        `INSERT INTO ${S}.activity (ticket_id, user_id, action, created_at) VALUES ($1,$2,'created',$3)`,
        [ticketId, t.assignTo, createdAt]
      );
      // Activity: resolved
      if (t.closed) {
        await client.query(
          `INSERT INTO ${S}.activity (ticket_id, user_id, action, details, created_at) VALUES ($1,$2,'resolved',$3,$4)`,
          [ticketId, t.assignTo, JSON.stringify({ to: 'completed' }), t.closed]
        );
      }
      // Activity: escalated
      if (t.escalated) {
        await client.query(
          `INSERT INTO ${S}.activity (ticket_id, user_id, action, details, created_at) VALUES ($1,$2,'escalated',$3,$4)`,
          [ticketId, t.escBy, JSON.stringify({ to: String(t.escTo) }), createdAt]
        );
      }

      console.log(`  ✅ [${ticketId}] ${t.title.substring(0,60)}`);
      inserted++;
    }

    console.log(`\n🎉 ${inserted} tickets created. Refresh Staff Performance page to see metrics.\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
