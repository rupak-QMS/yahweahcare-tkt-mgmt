// ============================================================
// PostgreSQL pool — auto-selects driver
// ============================================================
//
// - On Vercel / serverless / Neon URL: use @neondatabase/serverless
//   (WebSocket-pooled, fast cold starts).
// - On long-running servers / non-Neon URLs: use the regular `pg` Pool
//   (faster for sustained traffic).
//
// Both packages export a Pool with a compatible interface, so we type
// the export as `pg.Pool` (Neon's matches that shape).

import { Pool as PgPool } from 'pg';
import { env } from '../config/env';

const isNeonHost = /\.neon\.tech/i.test(env.DATABASE_URL || '');
const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const useNeonDriver = isServerless || isNeonHost || process.env.DRIVER === 'neon';

let pool: PgPool;

if (useNeonDriver) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const neon = require('@neondatabase/serverless');
  // Polyfill WebSocket for Node runtime (Vercel functions need this)
  if (typeof WebSocket === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    neon.neonConfig.webSocketConstructor = require('ws');
  }
  neon.neonConfig.poolQueryViaFetch = true;
  pool = new neon.Pool({ connectionString: env.DATABASE_URL }) as unknown as PgPool;
  console.log('[db] Using @neondatabase/serverless driver');
} else {
  pool = new PgPool({ connectionString: env.DATABASE_URL, max: 10 });
  pool.on('connect', (client) => {
    client.query('SET search_path TO yc_tkt_mgmt, public').catch(() => {});
  });
  pool.on('error', (err) => console.error('[pool] idle client error', err));
  console.log('[db] Using regular pg Pool');
}

export { pool };
