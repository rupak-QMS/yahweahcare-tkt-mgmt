// ============================================================
// Yahwehcare HRMS — Idempotent seeder
// Seeds: roles, permissions, role-permission grants, bootstrap super admins
//
// Safe to run multiple times — uses INSERT ... ON CONFLICT DO NOTHING / UPDATE.
// ============================================================

import 'dotenv/config';
import { pool } from './pool';

interface RoleSeed { name: string; display_name: string; description: string; rank: number; }
interface PermSeed { name: string; module: string; description: string; }

const ROLES: RoleSeed[] = [
  { name: 'super_admin', display_name: 'Super Admin', description: 'Full system access — system management, all data, all users', rank: 1 },
  { name: 'admin',       display_name: 'Admin',       description: 'Administrative access — manage org, users, settings (cannot modify super admins)', rank: 2 },
  { name: 'hr',          display_name: 'HR',          description: 'Human resources — manage employee records, payroll inputs, leave', rank: 3 },
  { name: 'manager',     display_name: 'Manager',     description: 'Department manager — oversee team, tickets, reviews', rank: 4 },
  { name: 'employee',    display_name: 'Employee',    description: 'Regular staff — raise tickets, manage own profile', rank: 5 },
];

const PERMISSIONS: PermSeed[] = [
  // ── Users
  { name: 'user.read',              module: 'users',    description: 'View user list and profiles' },
  { name: 'user.create',            module: 'users',    description: 'Create new user accounts' },
  { name: 'user.update',            module: 'users',    description: 'Update user details' },
  { name: 'user.delete',            module: 'users',    description: 'Delete user accounts' },
  { name: 'user.activate',          module: 'users',    description: 'Activate/deactivate users' },
  // ── Roles & permissions
  { name: 'role.read',              module: 'roles',    description: 'View roles and permissions' },
  { name: 'role.assign',            module: 'roles',    description: 'Assign roles to users' },
  { name: 'role.manage',            module: 'roles',    description: 'Create/modify role definitions' },
  { name: 'permission.manage',      module: 'permissions', description: 'Grant/revoke permissions on roles' },
  // ── HRMS settings
  { name: 'settings.read',          module: 'settings', description: 'View HRMS settings' },
  { name: 'settings.update',        module: 'settings', description: 'Modify HRMS settings' },
  { name: 'authsettings.manage',    module: 'settings', description: 'Manage authentication settings' },
  // ── Audit
  { name: 'audit.read',             module: 'audit',    description: 'View audit logs' },
  { name: 'audit.export',           module: 'audit',    description: 'Export audit logs' },
  // ── Tickets (your existing module)
  { name: 'ticket.read.own',        module: 'tickets',  description: 'View own tickets' },
  { name: 'ticket.read.team',       module: 'tickets',  description: 'View team tickets' },
  { name: 'ticket.read.all',        module: 'tickets',  description: 'View all tickets' },
  { name: 'ticket.create',          module: 'tickets',  description: 'Create tickets' },
  { name: 'ticket.update',          module: 'tickets',  description: 'Update tickets' },
  { name: 'ticket.delete',          module: 'tickets',  description: 'Delete tickets' },
  { name: 'ticket.assign',          module: 'tickets',  description: 'Assign tickets' },
  // ── Employees (HR-specific)
  { name: 'employee.read',          module: 'employees', description: 'Read employee profiles' },
  { name: 'employee.update',        module: 'employees', description: 'Update employee profiles' },
  // ── Reports & dashboards
  { name: 'report.read',            module: 'reports',  description: 'View dashboards and reports' },
  { name: 'report.schedule',        module: 'reports',  description: 'Schedule recurring reports' },
];

const ROLE_PERMS: Record<string, string[]> = {
  super_admin: PERMISSIONS.map(p => p.name),                       // everything
  admin: [
    'user.read','user.create','user.update','user.activate',
    'role.read','role.assign',                                     // not role.manage / permission.manage
    'settings.read','settings.update',
    'audit.read','audit.export',
    'ticket.read.all','ticket.create','ticket.update','ticket.assign',
    'employee.read','employee.update',
    'report.read','report.schedule',
  ],
  hr: [
    'user.read','user.update','user.activate',
    'employee.read','employee.update',
    'ticket.read.all','ticket.create','ticket.update','ticket.assign',
    'report.read',
    'audit.read',
  ],
  manager: [
    'user.read',
    'employee.read',
    'ticket.read.team','ticket.create','ticket.update','ticket.assign',
    'report.read',
  ],
  employee: [
    'ticket.read.own','ticket.create',
    'employee.read', // own profile
  ],
};

// Bootstrap Super Admins (will only be created if they don't already exist)
const BOOTSTRAP_SUPER_ADMINS = [
  { name: 'Ron Costa', email: 'ron@wmxsolutions.com.au', department: 'Management', designation: 'Operations Manager', avatar_initials: 'RC' },
  { name: 'Alex',      email: 'alex@yahwehpc.com.au', department: 'Management', designation: 'Administrator',       avatar_initials: 'AX' },
];

async function main() {
  console.log('Connecting to PostgreSQL...');
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO yc_tkt_mgmt, public');
    await client.query('BEGIN');

    // ── Seed roles ──────────────────────────────────────────
    console.log('Seeding roles...');
    for (const r of ROLES) {
      await client.query(
        `INSERT INTO yc_tkt_mgmt.roles (name, display_name, description, rank, is_system)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (name) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               description  = EXCLUDED.description,
               rank         = EXCLUDED.rank,
               updated_at   = NOW()`,
        [r.name, r.display_name, r.description, r.rank]
      );
    }
    console.log(`  ✓ ${ROLES.length} roles upserted`);

    // ── Seed permissions ────────────────────────────────────
    console.log('Seeding permissions...');
    for (const p of PERMISSIONS) {
      await client.query(
        `INSERT INTO yc_tkt_mgmt.permissions (name, module, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE
           SET module = EXCLUDED.module, description = EXCLUDED.description`,
        [p.name, p.module, p.description]
      );
    }
    console.log(`  ✓ ${PERMISSIONS.length} permissions upserted`);

    // ── Wire role ↔ permission grants ───────────────────────
    console.log('Wiring role permissions...');
    for (const [roleName, permNames] of Object.entries(ROLE_PERMS)) {
      const { rows: [role] } = await client.query<{ id: number }>(
        `SELECT id FROM yc_tkt_mgmt.roles WHERE name = $1`, [roleName]
      );
      if (!role) continue;
      // Reset role's permissions to the declared list (idempotent)
      await client.query(`DELETE FROM yc_tkt_mgmt.role_permissions WHERE role_id = $1`, [role.id]);
      for (const pname of permNames) {
        await client.query(
          `INSERT INTO yc_tkt_mgmt.role_permissions (role_id, permission_id)
           SELECT $1, id FROM yc_tkt_mgmt.permissions WHERE name = $2
           ON CONFLICT DO NOTHING`,
          [role.id, pname]
        );
      }
      console.log(`  ✓ ${roleName}: ${permNames.length} permissions`);
    }

    // ── Seed bootstrap super admins ─────────────────────────
    console.log('Seeding bootstrap Super Admins...');
    const { rows: [superRole] } = await client.query<{ id: number }>(
      `SELECT id FROM yc_tkt_mgmt.roles WHERE name = 'super_admin'`
    );
    if (!superRole) throw new Error('super_admin role not found — aborting');

    let createdCount = 0;
    for (const u of BOOTSTRAP_SUPER_ADMINS) {
      const result = await client.query(
        `INSERT INTO yc_tkt_mgmt.users
           (email, name, role, department, designation, avatar_initials, role_id,
            system_created, bootstrap_admin, auth_provider, active)
         VALUES ($1, $2, 'super_admin', $3, $4, $5, $6, TRUE, TRUE, 'microsoft', TRUE)
         ON CONFLICT (email) DO UPDATE
           SET role_id         = EXCLUDED.role_id,
               system_created  = TRUE,
               bootstrap_admin = TRUE,
               auth_provider   = 'microsoft',
               role            = 'super_admin',
               department      = EXCLUDED.department,
               designation     = EXCLUDED.designation,
               updated_at      = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [u.email, u.name, u.department, u.designation, u.avatar_initials, superRole.id]
      );
      if (result.rows[0]?.inserted) createdCount++;
      console.log(`  ✓ ${u.name} (${u.email}) — bootstrap super admin`);
    }
    console.log(`  ${createdCount} of ${BOOTSTRAP_SUPER_ADMINS.length} created (rest already existed)`);

    // ── Audit the seeding itself ────────────────────────────
    await client.query(
      `INSERT INTO yc_tkt_mgmt.audit_logs (action, module, metadata, success)
       VALUES ('system.seed', 'system', $1, TRUE)`,
      [JSON.stringify({ roles: ROLES.length, permissions: PERMISSIONS.length, bootstrapAdmins: BOOTSTRAP_SUPER_ADMINS.length })]
    );

    await client.query('COMMIT');
    console.log('\n✅ Seed complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✗ Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
