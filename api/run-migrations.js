#!/usr/bin/env node

/**
 * Database Migration Runner
 * Executes all SQL migration files in the correct order
 * Usage: npm run migrate
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Migration files in order.
//
// IMPORTANT: '000_reset_schema.sql' is DELIBERATELY EXCLUDED from this list.
// That file drops and rebuilds every core table (users, tickets, departments,
// roles, positions, etc.) and is NOT idempotent — re-running it destroys all
// production data. It caused a real data-loss incident on 2026-07-02/03 when
// this runner re-executed it as part of a routine migration fix. It must only
// ever be run manually, by a human, on purpose, against a database that is
// meant to be wiped (e.g. a fresh local/dev environment) — never via this
// script and never against production.
const migrations = [
    '001_add_ticket_fields.sql',  // Add ticket approval fields
    '002_create_ticket_approvers_table.sql',
    '003_create_ticket_audit_log_table.sql',
    '004_create_notifications_table.sql',
    '005_create_rbac_views.sql',
    '006_staff_management.sql',   // Add azure_oid, auth_provider, org hierarchy
    '007_seed_orgchart_staff.sql',
    '008_bootstrap_admin.sql',
];

const migrationsDir = path.join(__dirname, 'migrations');

async function runMigrations() {
    const client = await pool.connect();
    try {
        console.log('🔄 Starting database migrations...\n');

        // Track which migrations have already been applied so re-running this
        // script (e.g. on a redeploy) never re-executes a migration twice.
        // Idempotent migrations (CREATE TABLE IF NOT EXISTS, ON CONFLICT ...)
        // would tolerate a re-run anyway, but this keeps runs fast and the
        // history auditable, and is a safety net if a future migration file
        // is written without idempotency guards.
        await client.query(`
            CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.schema_migrations (
                name        TEXT PRIMARY KEY,
                applied_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        const { rows: appliedRows } = await client.query(
            `SELECT name FROM yc_tkt_mgmt.schema_migrations`
        );
        const applied = new Set(appliedRows.map(r => r.name));

        for (const migration of migrations) {
            if (applied.has(migration)) {
                console.log(`⏭️  Skipping (already applied): ${migration}`);
                continue;
            }

            const migrationPath = path.join(migrationsDir, migration);

            if (!fs.existsSync(migrationPath)) {
                console.error(`❌ Migration file not found: ${migration}`);
                continue;
            }

            console.log(`📝 Running: ${migration}`);
            const sql = fs.readFileSync(migrationPath, 'utf8');

            try {
                await client.query(sql);
                await client.query(
                    `INSERT INTO yc_tkt_mgmt.schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
                    [migration]
                );
                console.log(`✅ Completed: ${migration}\n`);
            } catch (error) {
                console.error(`❌ Error in ${migration}:`);
                console.error(error.message);
                console.error('\n');
                throw error;
            }
        }

        console.log('✨ All migrations completed successfully!');

    } catch (error) {
        console.error('\n❌ Migration failed!');
        console.error(error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run migrations
runMigrations().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
