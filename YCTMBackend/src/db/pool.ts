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
  max: 5,          // keep low for serverless — each function instance gets its own pool
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});

// NOTE: previously set search_path via `pool.on('connect', ...)` calling
// client.query() without awaiting it. pg-pool hands the client to the
// next caller immediately after emitting 'connect' (synchronously, not
// awaited), so that fire-and-forget query raced with whatever real query
// ran next on the same client - the source of the recurring
// "Calling client.query() when the client is already executing a query"
// deprecation warning in production logs. Removed rather than reworked:
// every query in this codebase already fully-qualifies the schema
// (yc_tkt_mgmt.<table>), so search_path was never actually load-bearing.
pool.on('error', (err) => console.error('[pool] idle client error', err));
console.log('[db] Using pg Pool (Neon pooler endpoint)');
