// ============================================================
// Rate limiting — global + dedicated login limiter
// ============================================================

import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/** Generic API rate limit (per IP). */
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests — try again later.' },
});

/** Stricter limiter on the login endpoint to slow brute-force attempts. */
export const loginLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'login_rate_limited', message: 'Too many sign-in attempts from this IP.' },
});
