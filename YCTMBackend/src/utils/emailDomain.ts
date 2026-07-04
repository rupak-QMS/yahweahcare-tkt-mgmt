// ============================================================
// Email-domain validator (used on backend AND shipped to frontend)
// ============================================================
//
// Organization-approved domains are configured via ALLOWED_EMAIL_DOMAINS env var.
// This utility is the single source of truth — share it via /auth/config endpoint
// so the frontend never drifts from server policy.

import { env } from '../config/env';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateEmail(email: string | undefined | null): ValidationResult {
  if (!email || typeof email !== 'string') {
    return { valid: false, reason: 'Email is required.' };
  }
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, reason: 'Invalid email format.' };
  }
  const domain = trimmed.split('@')[1];
  if (!env.ALLOWED_DOMAINS.includes(domain)) {
    return {
      valid: false,
      reason: `Only organization emails are accepted (allowed: ${env.ALLOWED_DOMAINS.join(', ')}).`,
    };
  }
  return { valid: true };
}

export function extractDomain(email: string): string | null {
  const m = email.toLowerCase().match(/@(.+)$/);
  return m ? m[1] : null;
}

export function isOrgEmail(email: string): boolean {
  return validateEmail(email).valid;
}
