// ============================================================
// Yahweahcare — Demo data seeder (PostgreSQL)
// Usage: npm run seed
// ============================================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('connect', (client) => { client.query('SET search_path TO yc_tkt_mgmt, public'); });

const PASSWORD = 'Yahweycare2026!';
const hash = bcrypt.hashSync(PASSWORD, 10);

const USERS = [
  { email: 'ron@wmxsolutions.com.au',     name: 'Ron Mitchell',  role: 'manager', department: 'Operations',         job_title: 'Operations Manager',   site: 'Parramatta', avatar_initials: 'RM' },
  { email: 'aisha.p@yahweycare.com.au',   name: 'Aisha Patel',   role: 'agent',   department: 'IT Service Desk',    job_title: 'Senior IT Analyst',    site: 'Parramatta', avatar_initials: 'AP' },
  { email: 'liam.o@yahweycare.com.au',    name: "Liam O'Brien",  role: 'agent',   department: 'Facilities',         job_title: 'Facilities Coordinator', site: 'Blacktown', avatar_initials: 'LO' },
  { email: 'mei.t@yahweycare.com.au',     name: 'Mei Tanaka',    role: 'agent',   department: 'HR & Payroll',       job_title: 'HR Business Partner',  site: 'Parramatta', avatar_initials: 'MT' },
  { email: 'jack.w@yahweycare.com.au',    name: 'Jack Williams', role: 'staff',   department: 'Clinical Care',      job_title: 'Registered Nurse',     site: 'Liverpool',  avatar_initials: 'JW' },
  { email: 'priya.s@yahweycare.com.au',   name: 'Priya Sharma',  role: 'staff',   department: 'Community Services', job_title: 'Care Coordinator',     site: 'Penrith',    avatar_initials: 'PS' },
  { email: 'noah.b@yahweycare.com.au',    name: 'Noah Brown',    role: 'staff',   department: 'Allied Health',      job_title: 'Physiotherapist',      site: 'Blacktown',  avatar_initials: 'NB' },
];

const slaHours = (p) => ({ critical: 2, high: 8, medium: 24, low: 72 })[p];
const offset = (h) => new Date(Date.now() - h * 3600000);
const ticketNum = (n) => 'YAH-' + String(n).padStart(6, '0');

const TICKETS = [
  { title: 'Outlook keeps crashing on shared workstation', description: 'The shared workstation at the Parramatta site nurses\' station has Outlook crashing every time staff try to open calendar invites. Affecting 4 staff across shifts.', category: 'it', priority: 'high', status: 'in_progress', site: 'Parramatta', requesterEmail: 'jack.w@yahweycare.com.au', assigneeEmail: 'aisha.p@yahweycare.com.au', hoursAgo: 1.5,
    comments: [{ authorEmail: 'aisha.p@yahweycare.com.au', body: 'Logged in remotely — looks like an Outlook profile corruption. Recreating profile now.', hoursAgo: 0.5 }] },
  { title: 'Medication fridge alarm at Blacktown site', description: 'Vaccine fridge alarm has been going off since 5:45am. Temperature reading 9.4°C. Need urgent maintenance.', category: 'facilities', priority: 'critical', status: 'assigned', site: 'Blacktown', requesterEmail: 'noah.b@yahweycare.com.au', assigneeEmail: 'liam.o@yahweycare.com.au', hoursAgo: 0.3 },
  { title: 'Payslip discrepancy — overtime not paid', description: 'My last fortnight payslip is missing 6.5 hours of overtime worked on the night shift roster (Easter weekend).', category: 'hr', priority: 'medium', status: 'waiting', site: 'Penrith', requesterEmail: 'priya.s@yahweycare.com.au', assigneeEmail: 'mei.t@yahweycare.com.au', hoursAgo: 20,
    comments: [{ authorEmail: 'mei.t@yahweycare.com.au', body: 'Hi Priya, could you please send through your timesheet screenshots for that fortnight?', hoursAgo: 8 }] },
  { title: 'New starter onboarding — IT setup needed', description: 'Starting Monday: Elena Vasquez, RN, joining Allied Health team. Needs laptop, MS365, badge, and access to ClinicalConnect.', category: 'it', priority: 'medium', status: 'resolved', site: 'Blacktown', requesterEmail: 'noah.b@yahweycare.com.au', assigneeEmail: 'aisha.p@yahweycare.com.au', hoursAgo: 48, resolvedHoursAgo: 6 },
  { title: 'NDIS compliance documentation — quarterly audit', description: 'Quarterly NDIS compliance pack needs sign-off before 31st of this month. Need ops manager review.', category: 'clinical', priority: 'medium', status: 'closed', site: 'Parramatta', requesterEmail: 'jack.w@yahweycare.com.au', assigneeEmail: 'ron@wmxsolutions.com.au', hoursAgo: 72, resolvedHoursAgo: 12 },
  { title: 'Office air-conditioning not working — Penrith hub', description: 'AC out since this morning, offices at 28°C. Staff working from break room.', category: 'facilities', priority: 'high', status: 'new', site: 'Penrith', requesterEmail: 'priya.s@yahweycare.com.au', assigneeEmail: null, hoursAgo: 4 },
  { title: 'Cannot log in to ClinicalConnect', description: 'Getting "Account locked" message. Tried password reset twice. Urgent — need to access patient notes for AM rounds.', category: 'it', priority: 'critical', status: 'new', site: 'Liverpool', requesterEmail: 'jack.w@yahweycare.com.au', assigneeEmail: null, hoursAgo: 0.1 },
  { title: 'Request: ergonomic chair assessment', description: 'Experiencing back pain at desk. Would like to request an ergonomic chair assessment.', category: 'hr', priority: 'low', status: 'in_progress', site: 'Blacktown', requesterEmail: 'noah.b@yahweycare.com.au', assigneeEmail: 'mei.t@yahweycare.com.au', hoursAgo: 36 },
  { title: 'Care plan transfer for new client (P. Anderson)', description: 'New client transferring from Mercy Home Care. Need help coordinating care plan import and scheduling intake meeting.', category: 'care', priority: 'high', status: 'in_progress', site: 'Penrith', requesterEmail: 'priya.s@yahweycare.com.au', assigneeEmail: 'ron@wmxsolutions.com.au', hoursAgo: 10 },
  { title: 'Petty cash reconciliation — March', description: 'March petty cash reconciliation needs review. Variance of $48.20 — receipts attached.', category: 'finance', priority: 'low', status: 'resolved', site: 'Liverpool', requesterEmail: 'jack.w@yahweycare.com.au', assigneeEmail: 'ron@wmxsolutions.com.au', hoursAgo: 96, resolvedHoursAgo: 24 },
  { title: 'Phone line down at Liverpool office', description: 'Main reception phone line not connecting. Going to voicemail instantly. Mobile redirect set up temporarily.', category: 'it', priority: 'high', status: 'assigned', site: 'Liverpool', requesterEmail: 'noah.b@yahweycare.com.au', assigneeEmail: 'aisha.p@yahweycare.com.au', hoursAgo: 2 },
  { title: 'Annual leave dispute — accrual calculation', description: 'My accrued leave balance looks wrong. Should be 18.5 days but showing 12.3 days.', category: 'hr', priority: 'medium', status: 'new', site: 'Liverpool', requesterEmail: 'jack.w@yahweycare.com.au', assigneeEmail: null, hoursAgo: 60 },
];

(async () => {
  const client = await pool.connect();
  try {
    console.log('Seeding users...');
    const userIds = {};
    for (const u of USERS) {
      const r = await client.query(
        `INSERT INTO yc_tkt_mgmt.users (email, name, password_hash, role, department, job_title, site, avatar_initials)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [u.email, u.name, hash, u.role, u.department, u.job_title, u.site, u.avatar_initials]
      );
      userIds[u.email] = r.rows[0].id;
    }
    console.log(`✓ ${USERS.length} users created (password: ${PASSWORD})`);

    console.log('Seeding tickets...');
    let seq = 1000;
    for (const t of TICKETS) {
      seq += 1;
      const createdAt = offset(t.hoursAgo);
      const dueAt = new Date(createdAt.getTime() + slaHours(t.priority) * 3600000);
      const resolvedAt = t.resolvedHoursAgo ? offset(t.resolvedHoursAgo) : null;
      const closedAt = t.status === 'closed' ? resolvedAt : null;
      const breached = resolvedAt ? resolvedAt > dueAt : false;

      const r = await client.query(
        `INSERT INTO yc_tkt_mgmt.tickets (ticket_number, title, description, category_id, priority_id, status_id,
          requester_id, assignee_id, site, source, due_at, resolved_at, closed_at, sla_breached, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'web',$10,$11,$12,$13,$14,$15) RETURNING id`,
        [ticketNum(seq), t.title, t.description, t.category, t.priority, t.status,
         userIds[t.requesterEmail], t.assigneeEmail ? userIds[t.assigneeEmail] : null,
         t.site, dueAt, resolvedAt, closedAt, breached, createdAt, resolvedAt || createdAt]
      );
      const ticketId = r.rows[0].id;

      await client.query(
        `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, to_value, created_at)
         VALUES ($1, $2, 'created', 'new', $3)`,
        [ticketId, userIds[t.requesterEmail], createdAt]
      );
      if (t.assigneeEmail) {
        await client.query(
          `INSERT INTO yc_tkt_mgmt.activity (ticket_id, actor_id, action_type, to_value, created_at)
           VALUES ($1, $2, 'assigned', $3, $4)`,
          [ticketId, userIds[t.assigneeEmail], t.assigneeEmail, createdAt]
        );
      }
      for (const c of (t.comments || [])) {
        await client.query(
          `INSERT INTO yc_tkt_mgmt.comments (ticket_id, author_id, body, created_at) VALUES ($1, $2, $3, $4)`,
          [ticketId, userIds[c.authorEmail], c.body, offset(c.hoursAgo)]
        );
      }
    }
    console.log(`✓ ${TICKETS.length} tickets created`);
    console.log('\nSeed complete!');
    console.log(`  Demo login: ron@wmxsolutions.com.au / ${PASSWORD}`);
  } catch (err) {
    console.error('✗ Error seeding:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
