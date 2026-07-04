// ============================================================
// Auto-migration: creates activity_log_archives if it doesn't
// already exist. Called once at server startup from api/index.ts,
// and defensively re-checked (cheap no-op once created) from
// audit.routes.ts before any archive-related query.
// ============================================================

import { pool } from '../../db/pool';

let migrationDone = false;

export async function ensureArchiveTable(): Promise<void> {
  if (migrationDone) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.activity_log_archives (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        fy_year          INTEGER     NOT NULL,
        quarter          INTEGER     NOT NULL CHECK (quarter BETWEEN 1 AND 4),
        period_start     TIMESTAMPTZ NOT NULL,
        period_end       TIMESTAMPTZ NOT NULL,
        filename         TEXT        NOT NULL,
        record_count     INTEGER     NOT NULL DEFAULT 0,
        zip_data         BYTEA       NOT NULL,
        generated_by     INTEGER     REFERENCES yc_tkt_mgmt.users(id) ON DELETE SET NULL,
        generated_by_email TEXT,
        generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        emailed_at       TIMESTAMPTZ,
        emailed_by       INTEGER     REFERENCES yc_tkt_mgmt.users(id) ON DELETE SET NULL,
        email_status     TEXT        CHECK (email_status IN ('sent','failed')),
        email_error      TEXT,
        email_recipients JSONB       DEFAULT '[]',
        truncated_at     TIMESTAMPTZ,
        truncated_by     INTEGER     REFERENCES yc_tkt_mgmt.users(id) ON DELETE SET NULL,
        truncated_count  INTEGER
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS activity_log_archives_fy_quarter_idx
        ON yc_tkt_mgmt.activity_log_archives (fy_year, quarter)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS activity_log_archives_generated_at_idx
        ON yc_tkt_mgmt.activity_log_archives (generated_at DESC)
    `);

    migrationDone = true;
  } catch (e) {
    // Non-fatal — the rest of the app still works; archive routes will
    // simply fail until this succeeds (e.g. transient DB unavailability).
    console.error('[archive] ensureArchiveTable failed:', e);
  }
}
