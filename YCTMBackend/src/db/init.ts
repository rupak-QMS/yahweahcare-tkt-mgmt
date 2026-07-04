// ============================================================
// Apply schema.sql to the configured database
// Usage: npm run init-db
// ============================================================

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pool } from './pool';

async function main() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  console.log('Applying HRMS schema...');

  // Split by semicolon and execute each statement separately
  // (Neon serverless doesn't support multiple statements in one query)
  const statements = sql
    .split(';')
    .map(s => {
      // Remove SQL comments (lines starting with --)
      return s
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .trim();
    })
    .filter(s => s.length > 0);

  console.log(`Found ${statements.length} SQL statements to execute...`);

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    try {
      await pool.query(statement);
      console.log(`✓ Statement ${i + 1}/${statements.length}`);
    } catch (e: any) {
      // Ignore certain non-critical errors like duplicate constraints
      const errorCode = e.code;
      if (errorCode === '42710' || errorCode === '42P07') { // duplicate object
        console.log(`⊘ Statement ${i + 1}/${statements.length} (skipped, already exists)`);
      } else {
        console.error(`✗ Error on statement ${i + 1}:`, statement.substring(0, 80) + '...');
        throw e;
      }
    }
  }

  console.log('✅ Schema applied.');
  await pool.end();
}

main().catch((e) => {
  console.error('✗ init-db failed:', e);
  process.exit(1);
});
