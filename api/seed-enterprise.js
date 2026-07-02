#!/usr/bin/env node

/**
 * Enterprise Database Seeder
 * Populates the fresh schema with realistic sample data
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function seedDatabase() {
    const client = await pool.connect();
    try {
        console.log('🌱 Starting database seeding...\n');

        // 1. Seed Departments
        console.log('📁 Seeding departments...');
        await client.query(`
            INSERT INTO yc_tkt_mgmt.departments (name, description) VALUES
            ('Operations', 'Day-to-day operations and support'),
            ('Finance', 'Financial management and accounting'),
            ('Strategic Development & Client Relations', 'Strategic initiatives and client management'),
            ('Director Level', 'Executive leadership')
            ON CONFLICT DO NOTHING;
        `);

        // 2. Seed Positions
        console.log('👔 Seeding positions...');
        await client.query(`
            INSERT INTO yc_tkt_mgmt.positions (title, department_id, description) VALUES
            ('Operations Manager', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Operations'), 'Manages day-to-day operations'),
            ('Finance Officer', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Finance'), 'Handles financial records and reporting'),
            ('IT Support', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Operations'), 'Provides technical support'),
            ('Account Manager', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Strategic Development & Client Relations'), 'Manages client relationships'),
            ('Director', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Director Level'), 'Executive director'),
            ('Care Coordinator', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Operations'), 'Coordinates care services')
            ON CONFLICT DO NOTHING;
        `);

        // 3. Seed Users
        console.log('👥 Seeding users...');
        await client.query(`
            INSERT INTO yc_tkt_mgmt.users (name, email, department_id, position_id, is_active) VALUES
            ('Ron Costa', 'ron.costa@yahweahcare.com', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Operations'), (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Operations Manager'), true),
            ('Suganty P', 'suganty.p@yahweahcare.com', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Operations'), (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'IT Support'), true),
            ('Sunita Maharjan', 'sunita.maharjan@yahweahcare.com', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Finance'), (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Finance Officer'), true),
            ('Elenor Elia', 'elenor.elia@yahweahcare.com', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Operations'), (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Care Coordinator'), true),
            ('Saloni Kumar', 'saloni.kumar@yahweahcare.com', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Strategic Development & Client Relations'), (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Account Manager'), true),
            ('James Baskaran', 'james.baskaran@yahweahcare.com', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Operations'), (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'IT Support'), true),
            ('Miejkyla Johnson', 'miejkyla.johnson@yahweahcare.com', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Operations'), (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Care Coordinator'), true),
            ('Venujah Arudselvam', 'venujah.arudselvam@yahweahcare.com', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Finance'), (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Finance Officer'), true),
            ('Akila Nanayakkara', 'akila.nanayakkara@yahweahcare.com', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Director Level'), (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Director'), true),
            ('Alex Thompson', 'alex.thompson@yahweahcare.com', (SELECT id FROM yc_tkt_mgmt.departments WHERE name = 'Operations'), (SELECT id FROM yc_tkt_mgmt.positions WHERE title = 'Operations Manager'), true)
            ON CONFLICT (email) DO NOTHING;
        `);

        // 4. Seed Categories
        console.log('📂 Seeding categories...');
        await client.query(`
            INSERT INTO yc_tkt_mgmt.categories (id, label, icon, sort_order) VALUES
            ('it', 'IT Support', '💻', 1),
            ('hr', 'HR & Payroll', '👥', 2),
            ('facilities', 'Facilities & Maintenance', '🔧', 3),
            ('care', 'Care Coordination', '🤝', 4),
            ('clinical', 'Clinical / Compliance', '🩺', 5),
            ('finance', 'Finance', '💰', 6),
            ('general', 'General Enquiry', '💬', 7)
            ON CONFLICT DO NOTHING;
        `);

        // 5. Seed Priorities
        console.log('⚡ Seeding priorities...');
        await client.query(`
            INSERT INTO yc_tkt_mgmt.priorities (id, label, sla_hours, sort_order) VALUES
            ('critical', 'Critical', 2, 1),
            ('high', 'High', 8, 2),
            ('medium', 'Medium', 24, 3),
            ('low', 'Low', 72, 4)
            ON CONFLICT DO NOTHING;
        `);

        // 6. Seed Statuses
        console.log('✅ Seeding statuses...');
        await client.query(`
            INSERT INTO yc_tkt_mgmt.statuses (id, label, sort_order, is_closed) VALUES
            ('new', 'New', 1, false),
            ('assigned', 'Assigned', 2, false),
            ('in_progress', 'In Progress', 3, false),
            ('waiting', 'Waiting on Requester', 4, false),
            ('resolved', 'Resolved', 5, true),
            ('closed', 'Closed', 6, true)
            ON CONFLICT DO NOTHING;
        `);

        // 7. Seed Roles
        console.log('🔐 Seeding roles...');
        await client.query(`
            INSERT INTO yc_tkt_mgmt.roles (role_name, description) VALUES
            ('BootstrapAdmin', 'Full system access, can delete and restore tickets'),
            ('Manager', 'Can view and manage team tickets, approve tickets'),
            ('Assignee', 'Can update assigned tickets, add notes and attachments'),
            ('Approver', 'Can review and approve/reject tickets'),
            ('Creator', 'Can create and view own tickets'),
            ('User', 'Basic user role')
            ON CONFLICT (role_name) DO NOTHING;
        `);

        // 8. Assign Roles to Users
        console.log('👨‍💼 Assigning roles to users...');
        await client.query(`
            INSERT INTO yc_tkt_mgmt.user_roles (user_id, role_id)
            SELECT u.id, r.id FROM yc_tkt_mgmt.users u, yc_tkt_mgmt.roles r
            WHERE u.email = 'akila.nanayakkara@yahweahcare.com' AND r.role_name = 'BootstrapAdmin'
            ON CONFLICT DO NOTHING;
        `);

        await client.query(`
            INSERT INTO yc_tkt_mgmt.user_roles (user_id, role_id)
            SELECT u.id, r.id FROM yc_tkt_mgmt.users u, yc_tkt_mgmt.roles r
            WHERE u.email IN ('ron.costa@yahweahcare.com', 'alex.thompson@yahweahcare.com')
            AND r.role_name = 'Manager'
            ON CONFLICT DO NOTHING;
        `);

        await client.query(`
            INSERT INTO yc_tkt_mgmt.user_roles (user_id, role_id)
            SELECT u.id, r.id FROM yc_tkt_mgmt.users u, yc_tkt_mgmt.roles r
            WHERE u.email IN ('suganty.p@yahweahcare.com', 'sunita.maharjan@yahweahcare.com')
            AND r.role_name = 'Approver'
            ON CONFLICT DO NOTHING;
        `);

        // 9. Seed Sample Tickets
        console.log('🎫 Seeding sample tickets...');
        await client.query(`
            INSERT INTO yc_tkt_mgmt.tickets
            (title, description, category_id, priority_id, created_by, assigned_to, approver_required, approval_mode, due_date)
            VALUES
            ('System Authentication Error', 'Users unable to login to the system', 'it', 'critical',
             (SELECT id FROM yc_tkt_mgmt.users WHERE email = 'ron.costa@yahweahcare.com'),
             (SELECT id FROM yc_tkt_mgmt.users WHERE email = 'suganty.p@yahweahcare.com'),
             true, 'AllMustApprove', NOW() + INTERVAL '2 days'),

            ('Payroll Processing Delay', 'Monthly payroll processing is delayed', 'finance', 'high',
             (SELECT id FROM yc_tkt_mgmt.users WHERE email = 'sunita.maharjan@yahweahcare.com'),
             (SELECT id FROM yc_tkt_mgmt.users WHERE email = 'sunita.maharjan@yahweahcare.com'),
             true, 'AnyOne', NOW() + INTERVAL '5 days'),

            ('Client Meeting Room Booking', 'Need to book meeting room for client presentation', 'facilities', 'medium',
             (SELECT id FROM yc_tkt_mgmt.users WHERE email = 'saloni.kumar@yahweahcare.com'),
             (SELECT id FROM yc_tkt_mgmt.users WHERE email = 'elenor.elia@yahweahcare.com'),
             false, 'AnyOne', NOW() + INTERVAL '10 days'),

            ('Care Coordination Protocol Update', 'Update care coordination procedures', 'care', 'high',
             (SELECT id FROM yc_tkt_mgmt.users WHERE email = 'alex.thompson@yahweahcare.com'),
             (SELECT id FROM yc_tkt_mgmt.users WHERE email = 'elenor.elia@yahweahcare.com'),
             true, 'AllMustApprove', NOW() + INTERVAL '7 days')
        `);

        // 10. Assign Approvers to Tickets
        console.log('✍️  Assigning approvers to tickets...');
        await client.query(`
            INSERT INTO yc_tkt_mgmt.ticket_approvers (ticket_id, approver_user_id)
            SELECT t.id, u.id
            FROM yc_tkt_mgmt.tickets t
            JOIN yc_tkt_mgmt.users u ON u.email = 'suganty.p@yahweahcare.com'
            WHERE t.title = 'System Authentication Error'
            ON CONFLICT DO NOTHING;
        `);

        await client.query(`
            INSERT INTO yc_tkt_mgmt.ticket_approvers (ticket_id, approver_user_id)
            SELECT t.id, u.id
            FROM yc_tkt_mgmt.tickets t
            JOIN yc_tkt_mgmt.users u ON u.email = 'sunita.maharjan@yahweahcare.com'
            WHERE t.title = 'System Authentication Error'
            ON CONFLICT DO NOTHING;
        `);

        console.log('\n✨ Database seeding completed successfully!\n');
        console.log('📊 Summary:');
        console.log('  ✅ Departments: 4');
        console.log('  ✅ Positions: 6');
        console.log('  ✅ Users: 10');
        console.log('  ✅ Categories: 7');
        console.log('  ✅ Priorities: 4');
        console.log('  ✅ Statuses: 6');
        console.log('  ✅ Roles: 6');
        console.log('  ✅ Sample Tickets: 4');
        console.log('  ✅ Approvers Assigned: Multiple\n');

    } catch (error) {
        console.error('❌ Seeding failed!');
        console.error(error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

seedDatabase();
