-- ============================================================
-- Yahwehcare HRMS Authentication & Authorization Schema
-- All tables live under the yc_tkt_mgmt schema
-- ============================================================

-- Drop existing auth tables (idempotent re-init)
DROP TABLE IF EXISTS yc_tkt_mgmt.audit_logs       CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.sessions         CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.role_permissions CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.permissions      CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.roles            CASCADE;
DROP TABLE IF EXISTS yc_tkt_mgmt.failed_logins    CASCADE;

-- Make sure the schema exists
CREATE SCHEMA IF NOT EXISTS yc_tkt_mgmt;
SET search_path TO yc_tkt_mgmt, public;

-- ------------------------------------------------------------
-- Users table — synced from main backend or created locally
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yc_tkt_mgmt.users (
  id                  SERIAL PRIMARY KEY,
  email               TEXT UNIQUE NOT NULL,
  name                TEXT NOT NULL,
  password_hash       TEXT,
  active              BOOLEAN DEFAULT TRUE,
  role                TEXT,
  department          TEXT,
  site                TEXT,
  avatar_initials     TEXT,
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  -- HRMS / Entra fields
  designation         TEXT,
  employee_id         TEXT UNIQUE,
  microsoft_id        TEXT UNIQUE,
  tenant_id           TEXT,
  profile_photo_url   TEXT,
  system_created      BOOLEAN DEFAULT FALSE,
  bootstrap_admin     BOOLEAN DEFAULT FALSE,
  is_admin            BOOLEAN DEFAULT FALSE,
  role_id             INTEGER,
  auth_provider       TEXT DEFAULT 'microsoft' CHECK (auth_provider IN ('microsoft','local')),
  locked_until        TIMESTAMPTZ,
  failed_attempts     INTEGER DEFAULT 0,
  last_login_ip       TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email             ON yc_tkt_mgmt.users(email);
CREATE INDEX IF NOT EXISTS idx_users_microsoft_id      ON yc_tkt_mgmt.users(microsoft_id);
CREATE INDEX IF NOT EXISTS idx_users_employee_id       ON yc_tkt_mgmt.users(employee_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id           ON yc_tkt_mgmt.users(role_id);

-- ------------------------------------------------------------
-- Roles
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.roles (
  id              SERIAL PRIMARY KEY,
  name            TEXT UNIQUE NOT NULL,           -- 'super_admin', 'admin', 'hr', 'manager', 'employee'
  display_name    TEXT NOT NULL,
  description     TEXT,
  is_system       BOOLEAN DEFAULT FALSE,          -- prevents accidental deletion
  rank            INTEGER NOT NULL,               -- 1 = highest (super_admin), 5 = employee
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Permissions
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.permissions (
  id              SERIAL PRIMARY KEY,
  name            TEXT UNIQUE NOT NULL,           -- e.g. 'user.create', 'user.delete', 'ticket.view'
  module          TEXT NOT NULL,                  -- e.g. 'users', 'tickets', 'audit', 'settings'
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_permissions_module ON yc_tkt_mgmt.permissions(module);

-- ------------------------------------------------------------
-- Role ↔ Permission join
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.role_permissions (
  role_id       INTEGER NOT NULL REFERENCES yc_tkt_mgmt.roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES yc_tkt_mgmt.permissions(id) ON DELETE CASCADE,
  granted_at    TIMESTAMPTZ DEFAULT NOW(),
  granted_by    INTEGER REFERENCES yc_tkt_mgmt.users(id),
  PRIMARY KEY (role_id, permission_id)
);

-- Note: Foreign key constraint fk_users_role is optional and skipped if it fails

-- ------------------------------------------------------------
-- Sessions — token / refresh token tracking + device fingerprint
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.sessions (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES yc_tkt_mgmt.users(id) ON DELETE CASCADE,
  session_token      TEXT UNIQUE NOT NULL,        -- opaque session ID stored in cookie
  refresh_token_hash TEXT NOT NULL,               -- bcrypt of the refresh token (never store plaintext)
  refresh_token_jti  TEXT UNIQUE NOT NULL,        -- JWT ID for revocation
  access_token_jti   TEXT,                        -- current access token JTI (for blacklist)
  microsoft_token_id TEXT,                        -- opaque ref to MSAL token cache entry (optional)
  device_info        JSONB,                       -- { browser, os, deviceType }
  ip_address         TEXT,
  user_agent         TEXT,
  remember_me        BOOLEAN DEFAULT FALSE,
  is_revoked         BOOLEAN DEFAULT FALSE,
  revoked_at         TIMESTAMPTZ,
  revoked_reason     TEXT,
  last_activity_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id       ON yc_tkt_mgmt.sessions(user_id);
CREATE INDEX idx_sessions_session_token ON yc_tkt_mgmt.sessions(session_token);
CREATE INDEX idx_sessions_jti           ON yc_tkt_mgmt.sessions(refresh_token_jti);
CREATE INDEX idx_sessions_active        ON yc_tkt_mgmt.sessions(user_id, is_revoked, expires_at);

-- ------------------------------------------------------------
-- Audit log — every security-relevant event
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES yc_tkt_mgmt.users(id) ON DELETE SET NULL,
  actor_email  TEXT,                              -- denormalised for forensics if user is later deleted
  action       TEXT NOT NULL,                     -- 'login.success', 'login.failed', 'logout', 'role.changed', ...
  module       TEXT,                              -- 'auth', 'users', 'roles', 'tickets', 'settings'
  target_type  TEXT,                              -- what was acted upon: 'user', 'role', 'permission'
  target_id    TEXT,                              -- ID of the target entity
  metadata     JSONB DEFAULT '{}'::jsonb,         -- before/after, ip, user-agent, reason, etc.
  ip_address   TEXT,
  user_agent   TEXT,
  success      BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user        ON yc_tkt_mgmt.audit_logs(user_id);
CREATE INDEX idx_audit_action      ON yc_tkt_mgmt.audit_logs(action);
CREATE INDEX idx_audit_module      ON yc_tkt_mgmt.audit_logs(module);
CREATE INDEX idx_audit_created_at  ON yc_tkt_mgmt.audit_logs(created_at DESC);

-- ------------------------------------------------------------
-- Failed login attempts — for IP-based brute force protection
-- ------------------------------------------------------------
CREATE TABLE yc_tkt_mgmt.failed_logins (
  id           BIGSERIAL PRIMARY KEY,
  email        TEXT,
  ip_address   TEXT NOT NULL,
  user_agent   TEXT,
  reason       TEXT,                              -- 'bad_credentials', 'account_locked', 'disallowed_domain'
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_failed_ip       ON yc_tkt_mgmt.failed_logins(ip_address, created_at DESC);
CREATE INDEX idx_failed_email    ON yc_tkt_mgmt.failed_logins(email, created_at DESC);

-- ------------------------------------------------------------
-- View: active sessions (helpful for admin pages)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW yc_tkt_mgmt.v_active_sessions AS
SELECT s.*, u.email, u.name, u.role_id, r.name AS role_name
FROM yc_tkt_mgmt.sessions s
JOIN yc_tkt_mgmt.users u ON u.id = s.user_id
LEFT JOIN yc_tkt_mgmt.roles r ON r.id = u.role_id
WHERE s.is_revoked = FALSE AND s.expires_at > NOW();
