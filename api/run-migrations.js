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

// Migration files in order
const migrations = [
    '000_reset_schema.sql',       // Drop all and start fresh
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

        for (const migration of migrations) {
            const migrationPath = path.join(migrationsDir, migration);

            if (!fs.existsSync(migrationPath)) {
                console.error(`❌ Migration file not found: ${migration}`);
                continue;
            }

            console.log(`📝 Running: ${migration}`);
            const sql = fs.readFileSync(migrationPath, 'utf8');

            try {
                await client.query(sql);
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
