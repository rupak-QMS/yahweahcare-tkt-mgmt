// ============================================================
// Auto-migration: creates email_logs and notification_queue
// if they don't already exist.
// Called once at server startup from api/index.ts.
// ============================================================

import { pool } from '../../db/pool';

export async function ensureEmailTables(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.email_logs (
        id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id          INTEGER     REFERENCES yc_tkt_mgmt.tickets(id) ON DELETE SET NULL,
        queue_id           UUID,
        recipient_email    TEXT        NOT NULL,
        subject            TEXT        NOT NULL,
        resend_message_id  TEXT,
        status             TEXT        NOT NULL CHECK (status IN ('sent','failed','skipped')),
        error_message      TEXT,
        sent_at            TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS email_logs_ticket_id_idx
        ON yc_tkt_mgmt.email_logs (ticket_id)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS email_logs_created_at_idx
        ON yc_tkt_mgmt.email_logs (created_at DESC)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.notification_queue (
        id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        event_name        TEXT        NOT NULL,
        recipients        JSONB       NOT NULL DEFAULT '[]',
        payload           JSONB       NOT NULL DEFAULT '{}',
        status            TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','processing','sent','failed','permanently_failed')),
        retry_count       INTEGER     NOT NULL DEFAULT 0,
        next_retry_at     TIMESTAMPTZ,
        last_error        TEXT,
        sent_at           TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS notification_queue_status_retry_idx
        ON yc_tkt_mgmt.notification_queue (status, next_retry_at)
        WHERE status IN ('pending','failed')
    `);

    console.log('[email] tables ready');
  } catch (e) {
    // Non-fatal — app still works; just logs won't persist
    console.error('[email] ensureEmailTables failed:', e);
  }
}
