// ============================================================
// JWT issuance + verification helpers
// ============================================================

import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';

export interface AccessTokenPayload extends JwtPayload {
  sub: string;            // user id
  email: string;
  role: string;
  permissions: string[];
  sid: string;            // session id
  jti: string;
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'jti'>): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const opts: SignOptions = { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'], jwtid: jti };
  const token = jwt.sign(payload, env.JWT_SECRET, opts);
  return { token, jti };
}

export function signRefreshToken(payload: { sub: string; sid: string }): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const opts: SignOptions = { algorithm: 'HS256', expiresIn: env.REFRESH_TOKEN_TTL as SignOptions['expiresIn'], jwtid: jti };
  const token = jwt.sign(payload, env.JWT_SECRET, opts);
  return { token, jti };
}

export function verifyToken<T = JwtPayload>(token: string): T {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as T;
}

/** PKCE — generate a verifier + S256 challenge */
export function generatePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Cryptographically random opaque session token (stored in cookie). */
export function generateSessionToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}
