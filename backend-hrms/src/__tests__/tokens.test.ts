import { signAccessToken, signRefreshToken, verifyToken, generatePkce, generateSessionToken } from '../utils/tokens';

describe('tokens', () => {
  const basePayload = {
    sub: '42',
    email: 'staff@yahwehcare.com.au',
    role: 'staff',
    permissions: ['tickets:read'],
    sid: '7',
  };

  // ── signAccessToken ───────────────────────────────────────────────

  describe('signAccessToken', () => {
    it('returns a token string and a jti', () => {
      const { token, jti } = signAccessToken(basePayload);
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // header.payload.sig
      expect(typeof jti).toBe('string');
      expect(jti.length).toBeGreaterThan(0);
    });

    it('jti is unique on each call', () => {
      const a = signAccessToken(basePayload);
      const b = signAccessToken(basePayload);
      expect(a.jti).not.toBe(b.jti);
    });

    it('encodes the expected claims', () => {
      const { token } = signAccessToken(basePayload);
      const decoded = verifyToken<typeof basePayload & { exp: number }>(token);
      expect(decoded.sub).toBe('42');
      expect(decoded.email).toBe(basePayload.email);
      expect(decoded.role).toBe('staff');
      expect(decoded.permissions).toEqual(['tickets:read']);
      expect(decoded.sid).toBe('7');
      expect(typeof decoded.exp).toBe('number');
      expect(decoded.exp).toBeGreaterThan(Date.now() / 1000);
    });
  });

  // ── signRefreshToken ──────────────────────────────────────────────

  describe('signRefreshToken', () => {
    it('returns a valid refresh token', () => {
      const { token, jti } = signRefreshToken({ sub: '42', sid: '7' });
      expect(token.split('.').length).toBe(3);
      expect(typeof jti).toBe('string');
    });

    it('refresh token verifies successfully', () => {
      const { token } = signRefreshToken({ sub: '42', sid: '7' });
      const decoded = verifyToken<{ sub: string; sid: string }>(token);
      expect(decoded.sub).toBe('42');
      expect(decoded.sid).toBe('7');
    });
  });

  // ── verifyToken ───────────────────────────────────────────────────

  describe('verifyToken', () => {
    it('throws on a tampered token', () => {
      const { token } = signAccessToken(basePayload);
      const parts = token.split('.');
      const tampered = `${parts[0]}.${parts[1]}.invalidsignature`;
      expect(() => verifyToken(tampered)).toThrow();
    });

    it('throws on an expired token', () => {
      // Sign with -1s TTL so it is already expired
      const jwt = require('jsonwebtoken');
      const { env } = require('../config/env');
      const expired = jwt.sign({ ...basePayload, jti: 'x' }, env.JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: -1,
      });
      expect(() => verifyToken(expired)).toThrow(/expired/i);
    });

    it('throws on a completely invalid string', () => {
      expect(() => verifyToken('not.a.token')).toThrow();
    });
  });

  // ── generatePkce ─────────────────────────────────────────────────

  describe('generatePkce', () => {
    it('returns a verifier and a challenge', () => {
      const { verifier, challenge } = generatePkce();
      expect(typeof verifier).toBe('string');
      expect(typeof challenge).toBe('string');
      expect(verifier).not.toBe(challenge);
    });

    it('challenge is a valid base64url string (no +/= characters)', () => {
      const { challenge } = generatePkce();
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('generates unique values each call', () => {
      const a = generatePkce();
      const b = generatePkce();
      expect(a.verifier).not.toBe(b.verifier);
      expect(a.challenge).not.toBe(b.challenge);
    });
  });

  // ── generateSessionToken ──────────────────────────────────────────

  describe('generateSessionToken', () => {
    it('returns a non-empty string', () => {
      expect(generateSessionToken().length).toBeGreaterThan(0);
    });

    it('generates unique tokens', () => {
      expect(generateSessionToken()).not.toBe(generateSessionToken());
    });
  });
});
