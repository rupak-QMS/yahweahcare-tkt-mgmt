// ============================================================
// PostgreSQL pool — uses standard pg driver with Neon pooler
// ============================================================
//
// @neondatabase/serverless v0.10+ is ESM-only and cannot be require()'d
// in a CommonJS Vercel function. Since the DATABASE_URL already targets
// Neon's built-in PgBouncer (-pooler endpoint), the standard `pg` Pool
// works correctly for serverless with no extra config needed.

import { Pool } from 'pg';
import { env } from '../config/env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('connect', (client) => {
  client.query('SET search_path TO yc_tkt_mgmt, public').catch(() => {});
});
pool.on('error', (err) => console.error('[pool] idle client error', err));
console.log('[db] Using pg Pool (Neon pooler endpoint)');
