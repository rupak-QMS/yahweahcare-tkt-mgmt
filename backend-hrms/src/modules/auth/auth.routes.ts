// ============================================================
// /auth routes
// ============================================================

import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import { getAuthCodeUrl, acquireTokenByCode, getMicrosoftLogoutUrl } from '../../config/msal';
import { generatePkce } from '../../utils/tokens';
import { fetchGraphProfile, fetchGraphPhoto } from './microsoft.service';
import {
  provisionFromGraph,
  createSession,
  rotateTokens,
  revokeSession,
  revokeAllUserSessions,
  pkceCookieValue,
  decodePkceCookie,
  PKCE_COOKIE_NAME,
} from './auth.service';
import { env } from '../../config/env';
import { loginLimiter } from '../../middleware/rateLimit.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateEmail } from '../../utils/emailDomain';
import { logAudit } from '../audit/audit.service';
import { pool } from '../../db/pool';

const router = Router();

// ─── Cookie helper ─────────────────────────────────────────
function cookieOpts(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN === 'localhost' ? undefined : env.COOKIE_DOMAIN,
    path: '/',
    maxAge: maxAgeMs,
  } as const;
}

// ─── GET /auth/config — frontend bootstrap ─────────────────
router.get('/config', (_req, res) => {
  res.json({
    allowedDomains: env.ALLOWED_DOMAINS,
    loginUrl: '/auth/microsoft',
    sessionInactivityMs: env.SESSION_INACTIVITY_TIMEOUT_MS,
  });
});

// ─── POST /auth/validate-email — for frontend onboarding ───
router.post('/validate-email', (req, res) => {
  const result = validateEmail(req.body?.email);
  if (!result.valid) return res.status(400).json(result);
  res.json(result);
});

// ─── GET /auth/microsoft — start the SSO flow ──────────────
router.get('/microsoft', loginLimiter, async (req, res, next) => {
  try {
    const state = crypto.randomBytes(24).toString('base64url');
    const { verifier, challenge } = generatePkce();
    const rememberMe = req.query.remember === '1';
    // Stash PKCE state in a short-lived signed cookie (10 min)
    res.cookie(PKCE_COOKIE_NAME, pkceCookieValue(state, verifier, rememberMe), {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      maxAge: 10 * 60_000,
      path: '/',
    });
    const url = await getAuthCodeUrl(state, challenge);
    res.redirect(url);
  } catch (err) { next(err); }
});

// ─── GET /auth/microsoft/callback ──────────────────────────
router.get('/microsoft/callback', async (req, res, next) => {
  try {
    const { code, state, error, error_description } = req.query as Record<string, string>;
    if (error) {
      await logAudit({ action: 'login.failed', module: 'auth', metadata: { error, error_description }, success: false, req });
      return res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(error_description || error)}`);
    }
    if (!code || !state) return res.status(400).json({ error: 'missing_code_or_state' });

    const remembered = decodePkceCookie(req.cookies?.[PKCE_COOKIE_NAME]);
    res.clearCookie(PKCE_COOKIE_NAME);   // one-shot use
    if (!remembered || remembered.state !== state) {
      await logAudit({ action: 'login.failed', module: 'auth', metadata: { reason: 'state_mismatch' }, success: false, req });
      return res.status(400).json({ error: 'invalid_state' });
    }

    // Exchange the auth code for tokens via MSAL
    const tokenResponse = await acquireTokenByCode(code, remembered.verifier);
    if (!tokenResponse?.accessToken) throw new Error('No access token in MSAL response');

    // Fetch the user's profile + photo from Microsoft Graph
    const profile = await fetchGraphProfile(tokenResponse.accessToken);
    const photo   = await fetchGraphPhoto(tokenResponse.accessToken);
    const tenantId = tokenResponse.tenantId || env.AZURE_TENANT_ID;

    // Provision or sync the user
    const user = await provisionFromGraph(profile, photo, tenantId, req);

    // Mint our own session + JWTs
    const { accessToken, refreshToken, sessionToken } = await createSession({ user, rememberMe: remembered.rememberMe, req });

    // Set HTTP-only cookies
    res.cookie('yc_access',  accessToken,  cookieOpts(15 * 60_000));                                // 15m
    res.cookie('yc_refresh', refreshToken, cookieOpts((remembered.rememberMe ? 90 : 30) * 86_400_000));
    res.cookie('yc_session', sessionToken, cookieOpts((remembered.rememberMe ? 90 : 30) * 86_400_000));

    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch (err) {
    await logAudit({ action: 'login.failed', module: 'auth', metadata: { reason: 'callback_error', error: String(err) }, success: false, req });
    next(err);
  }
});

// ─── POST /auth/refresh — rotate refresh + access ──────────
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshTokenCookie = req.cookies?.['yc_refresh'];
    if (!refreshTokenCookie) return res.status(401).json({ error: 'no_refresh_token' });

    const { verifyToken } = await import('../../utils/tokens');
    const payload = verifyToken<{ sub: string; sid: string }>(refreshTokenCookie);
    const { accessToken, refreshToken } = await rotateTokens(Number(payload.sid), refreshTokenCookie, req);

    res.cookie('yc_access',  accessToken,  cookieOpts(15 * 60_000));
    res.cookie('yc_refresh', refreshToken, cookieOpts(30 * 86_400_000));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── GET /auth/me — current user ───────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.department, u.designation,
            u.profile_photo_url, u.bootstrap_admin, u.bootstrap_admin, u.active,
            r.display_name AS role_label
       FROM yc_tkt_mgmt.users u
       LEFT JOIN yc_tkt_mgmt.roles r ON r.id = u.role_id
      WHERE u.id = $1`,
    [req.auth!.userId]
  );
  res.json({ user: rows[0], permissions: req.auth!.permissions });
});

// ─── POST /auth/logout — current session ───────────────────
router.post('/logout', requireAuth, async (req, res) => {
  await revokeSession(req.auth!.sessionId, 'user_logout', req);
  res.clearCookie('yc_access');
  res.clearCookie('yc_refresh');
  res.clearCookie('yc_session');
  res.json({ ok: true, microsoftLogoutUrl: getMicrosoftLogoutUrl() });
});

// ─── POST /auth/logout-all — every device ──────────────────
router.post('/logout-all', requireAuth, async (req, res) => {
  await revokeAllUserSessions(req.auth!.userId, 'user_logout_all', req);
  res.clearCookie('yc_access');
  res.clearCookie('yc_refresh');
  res.clearCookie('yc_session');
  res.json({ ok: true, microsoftLogoutUrl: getMicrosoftLogoutUrl() });
});

// ─── GET /auth/logged-out — post-Entra logout landing ──────
router.get('/logged-out', (_req, res) => {
  res.redirect(`${env.FRONTEND_URL}/login?logged_out=1`);
});

// ─── GET /auth/sessions — list my active sessions ──────────
router.get('/sessions', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, device_info, ip_address, user_agent, remember_me, last_activity_at, created_at, expires_at,
            (id = $1) AS is_current
     FROM yc_tkt_mgmt.sessions
     WHERE user_id = $2 AND is_revoked = FALSE AND expires_at > NOW()
     ORDER BY last_activity_at DESC`,
    [req.auth!.sessionId, req.auth!.userId]
  );
  res.json({ sessions: rows });
});

// ─── DELETE /auth/sessions/:id — kill a specific session ───
router.delete('/sessions/:id', requireAuth, async (req, res) => {
  const sessionId = Number(req.params.id);
  // Make sure it belongs to the caller
  const { rows } = await pool.query(`SELECT user_id FROM yc_tkt_mgmt.sessions WHERE id = $1`, [sessionId]);
  if (!rows[0] || rows[0].user_id !== req.auth!.userId) return res.status(403).json({ error: 'forbidden' });
  await revokeSession(sessionId, 'user_revoked_session', req);
  res.json({ ok: true });
});

export default router;
