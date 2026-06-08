// ============================================================
// Authentication middleware
// - Reads access token from HTTP-only cookie
// - Verifies JWT signature + expiry
// - Loads session record from DB (so we can revoke)
// - Updates last_activity_at (for inactivity timeout)
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

    // Load session — verifies it hasn't been revoked
    const { rows } = await pool.query(
      `SELECT s.id, s.user_id, s.is_revoked, s.expires_at, s.last_activity_at,
              u.email, u.role, u.bootstrap_admin, u.is_admin, u.microsoft_id, u.active, u.role_id
       FROM yc_tkt_mgmt.sessions s
       JOIN yc_tkt_mgmt.users u ON u.id = s.user_id
       WHERE s.id = $1`, [payload.sid]
    );
    const session = rows[0];
    if (!session)              return res.status(401).json({ error: 'no_session' });
    if (session.is_revoked)    return res.status(401).json({ error: 'session_revoked' });
    if (!session.active)       return res.status(401).json({ error: 'account_inactive' });
    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: 'session_expired' });
    }
    // Inactivity timeout
    const inactiveFor = Date.now() - new Date(session.last_activity_at).getTime();
    if (inactiveFor > env.SESSION_INACTIVITY_TIMEOUT_MS) {
      await pool.query(`UPDATE yc_tkt_mgmt.sessions SET is_revoked = TRUE, revoked_reason = 'inactivity' WHERE id = $1`, [session.id]);
      return res.status(401).json({ error: 'inactivity_timeout' });
    }

    // Look up permissions for this user's role
    const permRes = await pool.query<{ name: string }>(
      `SELECT p.name FROM yc_tkt_mgmt.permissions p
       JOIN yc_tkt_mgmt.role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = $1`,
      [session.role_id]
    );

    req.auth = {
      userId: session.user_id,
      email: session.email,
      role: session.role,
      permissions: permRes.rows.map(r => r.name),
      sessionId: session.id,
      microsoftId: session.microsoft_id,
      isAdmin: session.is_admin,
      bootstrapAdmin: session.bootstrap_admin,
    };

    // Touch activity timestamp (best-effort)
    pool.query(`UPDATE yc_tkt_mgmt.sessions SET last_activity_at = NOW() WHERE id = $1`, [session.id]).catch(() => {});
    next();
  } catch (err) {
    next(err);
  }
}

/** Optional auth — populates req.auth if a valid token is present, but doesn't reject. */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.cookies?.['yc_access'] && !req.headers.authorization) return next();
  return requireAuth(req, res, next);
}
