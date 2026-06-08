// ============================================================
// Authentication middleware
// - Reads access token from HTTP-only cookie or Bearer header
// - Verifies JWT signature + expiry
// - Loads session record from DB (so we can revoke)
// - Updates last_activity_at (for inactivity timeout)
//
// NOTE: The live DB users table is the legacy schema which does NOT
// have bootstrap_admin, microsoft_id, or role_id columns.
// We derive isAdmin from u.is_admin and bootstrapAdmin from the role.
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { verifyToken, type AccessTokenPayload } from '../utils/tokens';
import { env } from '../config/env';

// ─── Extend Express Request with the authenticated user ────
declare module 'express-serve-static-core' {
  interface Request {
    auth?: {
      userId: number;
      email: string;
      role: string;
      permissions: string[];
      sessionId: number;
      microsoftId?: string | null;
      isAdmin: boolean;
      bootstrapAdmin: boolean;
    };
  }
}

/** Load session + user from DB using only columns present in the live schema. */
async function loadSession(sid: string) {
  const { rows } = await pool.query(
    `SELECT s.id, s.user_id, s.is_revoked, s.expires_at, s.last_activity_at,
            u.email, u.role,
            COALESCE(u.is_admin, FALSE)        AS is_admin,
            COALESCE(u.active,   TRUE)         AS active
     FROM yc_tkt_mgmt.sessions s
     JOIN yc_tkt_mgmt.users u ON u.id = s.user_id
     WHERE s.id = $1`, [sid]
  );
  return rows[0] as {
    id: number; user_id: number; is_revoked: boolean;
    expires_at: string; last_activity_at: string;
    email: string; role: string; is_admin: boolean; active: boolean;
  } | undefined;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.['yc_access'] || (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7) : undefined);
    if (!token) return res.status(401).json({ error: 'unauthenticated', message: 'Missing access token' });

    let payload: AccessTokenPayload;
    try {
      payload = verifyToken<AccessTokenPayload>(token);
    } catch {
      return res.status(401).json({ error: 'invalid_token', message: 'Token verification failed' });
    }

    const session = await loadSession(payload.sid);
    if (!session)           return res.status(401).json({ error: 'no_session' });
    if (session.is_revoked) return res.status(401).json({ error: 'session_revoked' });
    if (!session.active)    return res.status(401).json({ error: 'account_inactive' });
    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: 'session_expired' });
    }
    const inactiveFor = Date.now() - new Date(session.last_activity_at).getTime();
    if (inactiveFor > env.SESSION_INACTIVITY_TIMEOUT_MS) {
      await pool.query(
        `UPDATE yc_tkt_mgmt.sessions SET is_revoked = TRUE, revoked_reason = 'inactivity' WHERE id = $1`,
        [session.id]
      );
      return res.status(401).json({ error: 'inactivity_timeout' });
    }

    // Permissions: best-effort — empty array if role_permissions tables absent
    let permissions: string[] = [];
    try {
      const permRes = await pool.query<{ name: string }>(
        `SELECT p.name FROM yc_tkt_mgmt.permissions p
         JOIN yc_tkt_mgmt.role_permissions rp ON rp.permission_id = p.id
         JOIN yc_tkt_mgmt.roles r ON r.id = rp.role_id
         WHERE LOWER(r.name) = LOWER($1)`,
        [session.role]
      );
      permissions = permRes.rows.map(r => r.name);
    } catch { /* permissions tables may not exist yet */ }

    req.auth = {
      userId:         session.user_id,
      email:          session.email,
      role:           session.role,
      permissions,
      sessionId:      session.id,
      microsoftId:    null,
      isAdmin:        session.is_admin,
      bootstrapAdmin: session.is_admin, // treat is_admin as bootstrap for delete perms
    };

    pool.query(
      `UPDATE yc_tkt_mgmt.sessions SET last_activity_at = NOW() WHERE id = $1`,
      [session.id]
    ).catch(() => {});
    next();
  } catch (err) {
    next(err);
  }
}

/** Optional auth — populates req.auth if a valid token is present, but NEVER rejects.
 *  An expired / invalid / missing cookie is silently ignored. */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.['yc_access'] || (req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7) : undefined);
  if (!token) return next();

  try {
    let payload: AccessTokenPayload;
    try { payload = verifyToken<AccessTokenPayload>(token); }
    catch { return next(); }

    const session = await loadSession(payload.sid);
    if (!session || session.is_revoked || !session.active || new Date(session.expires_at) < new Date()) {
      return next();
    }
    const inactiveFor = Date.now() - new Date(session.last_activity_at).getTime();
    if (inactiveFor > env.SESSION_INACTIVITY_TIMEOUT_MS) return next();

    let permissions: string[] = [];
    try {
      const permRes = await pool.query<{ name: string }>(
        `SELECT p.name FROM yc_tkt_mgmt.permissions p
         JOIN yc_tkt_mgmt.role_permissions rp ON rp.permission_id = p.id
         JOIN yc_tkt_mgmt.roles r ON r.id = rp.role_id
         WHERE LOWER(r.name) = LOWER($1)`,
        [session.role]
      );
      permissions = permRes.rows.map(r => r.name);
    } catch { /* ignore */ }

    req.auth = {
      userId:         session.user_id,
      email:          session.email,
      role:           session.role,
      permissions,
      sessionId:      session.id,
      microsoftId:    null,
      isAdmin:        session.is_admin,
      bootstrapAdmin: session.is_admin,
    };
    pool.query(
      `UPDATE yc_tkt_mgmt.sessions SET last_activity_at = NOW() WHERE id = $1`,
      [session.id]
    ).catch(() => {});
  } catch { /* proceed unauthenticated */ }
  next();
}
