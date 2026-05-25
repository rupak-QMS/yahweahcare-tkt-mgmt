// ============================================================
// Yahweahcare — Database initialiser (PostgreSQL)
// Creates all tables and populates lookup data.
// Usage: npm run init-db
// ============================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

(async () => {
  const client = await pool.connect();
  try {
    console.log('Connecting to PostgreSQL...');
    console.log(`Applying schema from ${SCHEMA_PATH}...`);
    await client.query(schema);
    console.log('✓ Schema applied');

    // Insert lookup data
    const categories = [
      ['it',         'IT Support',                '💻', 1],
      ['hr',         'HR & Payroll',              '👥', 2],
      ['facilities', 'Facilities & Maintenance',  '🔧', 3],
      ['care',       'Care Coordination',         '🤝', 4],
      ['clinical',   'Clinical / Compliance',     '🩺', 5],
      ['finance',    'Finance',                   '💰', 6],
      ['general',    'General Enquiry',           '💬', 7],
    ];
    for (const [id, label, icon, sort] of categories) {
      await client.query(
        'INSERT INTO yc_tkt_mgmt.categories (id, label, icon, sort_order) VALUES ($1, $2, $3, $4)',
        [id, label, icon, sort]
      );
    }

    const priorities = [
      ['critical', 'Critical',  2, 1],
      ['high',     'High',      8, 2],
      ['medium',   'Medium',   24, 3],
      ['low',      'Low',      72, 4],
    ];
    for (const [id, label, sla, sort] of priorities) {
      await client.query(
        'INSERT INTO yc_tkt_mgmt.priorities (id, label, sla_hours, sort_order) VALUES ($1, $2, $3, $4)',
        [id, label, sla, sort]
      );
    }

    const statuses = [
      ['new',         'New',                  1, false],
      ['assigned',    'Assigned',             2, false],
      ['in_progress', 'In Progress',          3, false],
      ['waiting',     'Waiting on Requester', 4, false],
      ['resolved',    'Resolved',             5, true],
      ['closed',      'Closed',               6, true],
    ];
    for (const [id, label, sort, closed] of statuses) {
      await client.query(
        'INSERT INTO yc_tkt_mgmt.statuses (id, label, sort_order, is_closed) VALUES ($1, $2, $3, $4)',
        [id, label, sort, closed]
      );
    }

    console.log('✓ Lookup tables populated (7 categories, 4 priorities, 6 statuses)');
    console.log('\nNext: run `npm run seed` to insert demo users and tickets.');
  } catch (err) {
    console.error('✗ Error initialising database:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
