// ============================================================
// One-shot Neon setup — runs schema.sql + seeds bootstrap data
// Usage: DATABASE_URL=postgres://... npx ts-node src/db/neon-setup.ts
// ============================================================

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pool } from './pool';

async function main() {
  console.log('Connecting to Neon Postgres...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Neon doesn't allow multiple statements in one query through the HTTP driver,
  // so we split on semicolons that are followed by a newline (heuristic — safe for our schema)
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`Applying ${statements.length} schema statements...`);
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (err: unknown) {
      const msg = (err as Error).message || '';
      // Ignore "already exists" errors for idempotency
      if (msg.includes('already exists') || msg.includes('does not exist')) continue;
      console.error(`Failed: ${stmt.slice(0, 80)}...`);
      throw err;
    }
  }
  console.log('✓ Schema applied');

  // Verify
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'yc_tkt_mgmt' ORDER BY table_name`
  );
  console.log('Tables in yc_tkt_mgmt schema:');
  rows.forEach(r => console.log(`  - ${r.table_name}`));

  console.log('\n→ Now run: npm run seed');
  await pool.end();
}

main().catch(e => { console.error('✗ Setup failed:', e); process.exit(1); });
