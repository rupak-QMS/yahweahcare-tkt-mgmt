// ============================================================
// Demo Ticket Seeder
// Run: node scripts/seed-demo-tickets.mjs
// ============================================================

import pg from 'pg';
const { Client } = pg;

const DB_URL =
  'postgresql://neondb_owner:npg_yGDK7rPbU1St@ep-hidden-hat-a78c5hgh-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require';

const client = new Client({ connectionString: DB_URL });
await client.connect();
console.log('✅ Connected to Neon DB');

// ── Load lookup data ──────────────────────────────────────
const { rows: cats }  = await client.query(`SELECT id, name FROM yc_tkt_mgmt.categories ORDER BY id`);
const { rows: pris }  = await client.query(`SELECT id, label, sla_hours FROM yc_tkt_mgmt.priorities ORDER BY id`);
const { rows: users } = await client.query(`SELECT id, name FROM yc_tkt_mgmt.users WHERE is_active = TRUE ORDER BY id`);

if (!cats.length)  throw new Error('No categories found — run migrations first.');
if (!pris.length)  throw new Error('No priorities found — run migrations first.');
if (!users.length) throw new Error('No active users found.');

console.log(`📂 Categories: ${cats.map(c => c.name).join(', ')}`);
console.log(`🎯 Priorities: ${pris.map(p => p.label).join(', ')}`);
console.log(`👥 Users: ${users.map(u => u.name).join(', ')}`);

// ── Helpers ───────────────────────────────────────────────
const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
const daysFromNow = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

// Map priority label → SLA hours (fallback)
const slaMap = {};
pris.forEach(p => { slaMap[p.label.toLowerCase()] = p.sla_hours || 48; });

// ── Demo ticket definitions ──────────────────────────────
// Each entry: { title, desc, status, priority, category, createdDaysAgo, dueDaysFromCreated, resolved, ndis, escalated }
const TICKETS = [
  // ── Open / In Progress ──
  { title:'IT equipment request — new laptop for onboarding', category:'it', priority:'medium',    status:'open',            daysAgo:2,  dueDays:5,  ndis:false, escalated:false },
  { title:'NDIS participant care plan update required',        category:'care',priority:'high',     status:'in_progress',     daysAgo:5,  dueDays:3,  ndis:true,  escalated:false },
  { title:'HR policy clarification — annual leave entitlement',category:'hr',  priority:'low',      status:'open',            daysAgo:1,  dueDays:10, ndis:false, escalated:false },
  { title:'Finance invoice discrepancy — supplier overpayment',category:'finance',priority:'urgent', status:'in_progress',    daysAgo:3,  dueDays:2,  ndis:false, escalated:false },
  { title:'Facilities maintenance — broken air conditioning',  category:'facilities',priority:'high',status:'open',           daysAgo:4,  dueDays:2,  ndis:false, escalated:false },
  { title:'Clinical documentation audit — missing records',    category:'clinical',priority:'critical',status:'in_progress',  daysAgo:6,  dueDays:1,  ndis:true,  escalated:true  },
  { title:'Staff IT access request — new team member',         category:'it',  priority:'medium',   status:'open',            daysAgo:1,  dueDays:7,  ndis:false, escalated:false },
  { title:'NDIS support coordination plan review',             category:'care',priority:'high',     status:'in_progress',     daysAgo:8,  dueDays:2,  ndis:true,  escalated:false },
  { title:'Payroll discrepancy — overtime not processed',      category:'finance',priority:'high',  status:'open',            daysAgo:2,  dueDays:3,  ndis:false, escalated:false },
  { title:'Safety incident report — slip and fall',            category:'general',priority:'critical',status:'in_progress',   daysAgo:1,  dueDays:1,  ndis:false, escalated:true  },

  // ── Pending Approval ──
  { title:'Budget approval request — Q3 equipment upgrade',   category:'finance',priority:'medium', status:'pending_approval',daysAgo:7,  dueDays:14, ndis:false, escalated:false },
  { title:'New staff position creation — care coordinator',    category:'hr',  priority:'medium',   status:'pending_approval', daysAgo:5,  dueDays:10, ndis:false, escalated:false },
  { title:'NDIS plan implementation approval',                 category:'care',priority:'high',     status:'pending_approval', daysAgo:3,  dueDays:5,  ndis:true,  escalated:false },
  { title:'Facilities renovation sign-off — break room',       category:'facilities',priority:'low',status:'pending_approval', daysAgo:10, dueDays:20, ndis:false, escalated:false },

  // ── Resolved (recent) ──
  { title:'IT server maintenance — scheduled downtime',        category:'it',  priority:'high',     status:'resolved',         daysAgo:10, dueDays:3,  ndis:false, escalated:false, resolvedDaysAgo:7  },
  { title:'Clinical compliance report — monthly submission',   category:'clinical',priority:'high', status:'resolved',         daysAgo:14, dueDays:5,  ndis:true,  escalated:false, resolvedDaysAgo:9  },
  { title:'HR recruitment process — three candidates shortlisted',category:'hr',priority:'medium',  status:'resolved',         daysAgo:20, dueDays:10, ndis:false, escalated:false, resolvedDaysAgo:12 },
  { title:'Finance expense claim — team offsite',              category:'finance',priority:'low',   status:'resolved',         daysAgo:8,  dueDays:5,  ndis:false, escalated:false, resolvedDaysAgo:5  },
  { title:'NDIS participant transport arrangement',             category:'care',priority:'medium',  status:'resolved',         daysAgo:12, dueDays:4,  ndis:true,  escalated:false, resolvedDaysAgo:8  },
  { title:'IT network outage — branch office',                 category:'it',  priority:'critical', status:'resolved',         daysAgo:7,  dueDays:1,  ndis:false, escalated:true,  resolvedDaysAgo:6  },
  { title:'Facilities fire safety inspection follow-up',       category:'facilities',priority:'high',status:'resolved',        daysAgo:15, dueDays:5,  ndis:false, escalated:false, resolvedDaysAgo:11 },
  { title:'General admin — update contact directory',          category:'general',priority:'low',   status:'resolved',         daysAgo:9,  dueDays:7,  ndis:false, escalated:false, resolvedDaysAgo:6  },
  { title:'HR onboarding package — new care support worker',   category:'hr',  priority:'medium',   status:'resolved',         daysAgo:18, dueDays:7,  ndis:false, escalated:false, resolvedDaysAgo:14 },
  { title:'Clinical medication administration protocol update',category:'clinical',priority:'critical',status:'resolved',      daysAgo:22, dueDays:3,  ndis:true,  escalated:false, resolvedDaysAgo:19 },
  { title:'NDIS behaviour support plan — urgent review',       category:'care',priority:'urgent',   status:'resolved',         daysAgo:11, dueDays:2,  ndis:true,  escalated:true,  resolvedDaysAgo:9  },

  // ── Closed (older) ──
  { title:'IT upgrade — workstation replacements',             category:'it',  priority:'medium',   status:'closed',           daysAgo:45, dueDays:14, ndis:false, escalated:false, resolvedDaysAgo:30 },
  { title:'Finance annual audit preparation',                  category:'finance',priority:'high',  status:'closed',           daysAgo:60, dueDays:20, ndis:false, escalated:false, resolvedDaysAgo:40 },
  { title:'NDIS registration renewal documentation',           category:'care',priority:'high',     status:'closed',           daysAgo:50, dueDays:10, ndis:true,  escalated:false, resolvedDaysAgo:38 },
  { title:'HR performance review cycle — mid-year',            category:'hr',  priority:'medium',   status:'closed',           daysAgo:90, dueDays:30, ndis:false, escalated:false, resolvedDaysAgo:60 },
  { title:'Facilities lease renewal negotiation',              category:'facilities',priority:'medium',status:'closed',         daysAgo:75, dueDays:30, ndis:false, escalated:false, resolvedDaysAgo:55 },
  { title:'Clinical incident report — Q1 summary',            category:'clinical',priority:'high',  status:'closed',           daysAgo:100,dueDays:14, ndis:false, escalated:false, resolvedDaysAgo:85 },
  { title:'IT cyber security awareness training rollout',      category:'it',  priority:'high',     status:'closed',           daysAgo:55, dueDays:21, ndis:false, escalated:false, resolvedDaysAgo:42 },
  { title:'General — update emergency contact procedures',     category:'general',priority:'medium', status:'closed',           daysAgo:80, dueDays:20, ndis:false, escalated:false, resolvedDaysAgo:65 },

  // ── Overdue (open past due date) ──
  { title:'Clinical supervision schedule overdue review',      category:'clinical',priority:'high', status:'open',             daysAgo:14, dueDays:-7, ndis:true,  escalated:false },
  { title:'Finance quarterly reconciliation — outstanding',    category:'finance',priority:'urgent',status:'in_progress',      daysAgo:20, dueDays:-5, ndis:false, escalated:true  },
  { title:'IT disaster recovery plan — annual update',         category:'it',  priority:'high',     status:'open',             daysAgo:30, dueDays:-10,ndis:false, escalated:false },
  { title:'NDIS compliance audit — action items outstanding',  category:'care',priority:'critical', status:'in_progress',      daysAgo:25, dueDays:-3, ndis:true,  escalated:true  },
  { title:'HR policy manual — 2026 revision overdue',         category:'hr',  priority:'medium',   status:'open',             daysAgo:45, dueDays:-15,ndis:false, escalated:false },
  { title:'Facilities OH&S risk assessment overdue',           category:'facilities',priority:'high',status:'open',            daysAgo:18, dueDays:-8, ndis:false, escalated:false },

  // ── Escalated ──
  { title:'Critical NDIS safeguarding concern — immediate action',category:'care',priority:'critical',status:'in_progress',   daysAgo:2,  dueDays:1,  ndis:true,  escalated:true  },
  { title:'Urgent IT security breach — investigation required', category:'it',  priority:'critical', status:'in_progress',    daysAgo:1,  dueDays:1,  ndis:false, escalated:true  },
  { title:'Finance fraud allegation — board notification',     category:'finance',priority:'critical',status:'pending_approval',daysAgo:3, dueDays:2,  ndis:false, escalated:true  },
];

// ── Category + Priority lookup maps ──────────────────────
const catMap = {};
cats.forEach(c => { catMap[c.name.toLowerCase()] = c.id; });

const priMap = {};
pris.forEach(p => { priMap[p.label.toLowerCase()] = p.id; });

// Attempt to map common category keywords
function findCat(keyword) {
  const k = keyword.toLowerCase();
  if (catMap[k]) return catMap[k];
  // Fuzzy match
  for (const [name, id] of Object.entries(catMap)) {
    if (name.includes(k) || k.includes(name)) return id;
  }
  return cats[0].id; // fallback to first category
}

function findPri(keyword) {
  const k = keyword.toLowerCase();
  if (priMap[k]) return priMap[k];
  for (const [label, id] of Object.entries(priMap)) {
    if (label.includes(k)) return id;
  }
  return pris.find(p => p.label.toLowerCase() === 'medium')?.id || pris[0].id;
}

// ── Insert tickets ────────────────────────────────────────
let inserted = 0;
const userIds = users.map(u => u.id);

for (const t of TICKETS) {
  const catId = findCat(t.category);
  const priId = findPri(t.priority);
  const creator  = pick(userIds);
  const assignee = pick(userIds);
  const createdAt = daysAgo(t.daysAgo);
  const due = new Date(createdAt);
  due.setDate(due.getDate() + t.dueDays);
  const dueDate = due.toISOString();

  let closedDate = null;
  if (t.resolvedDaysAgo !== undefined) {
    closedDate = daysAgo(t.resolvedDaysAgo);
  }

  // SLA breached if resolved after due date
  const slaBreached = closedDate ? new Date(closedDate) > new Date(dueDate) : false;

  try {
    await client.query(
      `INSERT INTO yc_tkt_mgmt.tickets
         (title, description, status, category_id, priority_id,
          created_by, assigned_to, due_date, closed_date,
          is_escalated, ndis_related, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        t.title,
        `Demo ticket: ${t.title}. Created for dashboard and report demonstration purposes.`,
        t.status,
        catId,
        priId,
        creator,
        assignee,
        dueDate,
        closedDate,
        t.escalated,
        t.ndis,
        createdAt,
        createdAt,
      ]
    );
    inserted++;
    process.stdout.write('.');
  } catch (err) {
    console.error(`\n❌ Failed to insert "${t.title}":`, err.message);
  }
}

console.log(`\n\n✅ Inserted ${inserted}/${TICKETS.length} demo tickets.`);

// ── Summary ───────────────────────────────────────────────
const { rows: summary } = await client.query(`
  SELECT status, COUNT(*) as count
  FROM yc_tkt_mgmt.tickets
  GROUP BY status ORDER BY count DESC
`);
console.log('\n📊 Current ticket counts by status:');
summary.forEach(r => console.log(`   ${r.status.padEnd(20)} ${r.count}`));

const { rows: total } = await client.query(`SELECT COUNT(*) FROM yc_tkt_mgmt.tickets`);
console.log(`\n🎫 Total tickets in DB: ${total[0].count}`);

await client.end();
console.log('\n🚀 Done! Refresh your app to see the data.');
