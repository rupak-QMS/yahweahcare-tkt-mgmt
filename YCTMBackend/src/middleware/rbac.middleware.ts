// ============================================================
// Role-Based Access Control middleware
// ============================================================
//
// Three helpers:
//   requireRole('super_admin', 'admin')      — gate by role name(s)
//   requirePermission('user.delete')          — gate by permission(s); must have ALL
//   requireAnyPermission('audit.read', ...)   — must have AT LEAST ONE

import type { Request, Response, NextFunction } from 'express';
import { logAudit } from '../modules/audit/audit.service';

type RoleName = 'super_admin' | 'admin' | 'hr' | 'manager' | 'employee';

function deny(req: Request, res: Response, reason: string) {
  logAudit({
    userId: req.auth?.userId,
    actorEmail: req.auth?.email,
    action: 'login.failed', // generic — caller can override by calling logAudit themselves
    module: 'rbac',
    metadata: { reason, path: req.originalUrl, method: req.method },
    success: false,
    req,
  });
  return res.status(403).json({ error: 'forbidden', message: reason });
}

export function requireRole(...allowed: RoleName[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'unauthenticated' });
    if (!allowed.includes(req.auth.role as RoleName)) {
      return deny(req, res, `Role '${req.auth.role}' not permitted on this resource.`);
    }
    next();
  };
}

export function requirePermission(...required: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'unauthenticated' });
    // Super admins have all permissions implicitly — never block them
    if (req.auth.role === 'super_admin') return next();
    const missing = required.filter(p => !req.auth!.permissions.includes(p));
    if (missing.length > 0) {
      return deny(req, res, `Missing permission(s): ${missing.join(', ')}.`);
    }
    next();
  };
}

export function requireAnyPermission(...options: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'unauthenticated' });
    // Super admins have all permissions implicitly — never block them
    if (req.auth.role === 'super_admin') return next();
    const has = options.some(p => req.auth!.permissions.includes(p));
    if (!has) {
      return deny(req, res, `Requires one of: ${options.join(', ')}.`);
    }
    next();
  };
}

/** Convenience: gate to Super Admins only. */
export const requireSuperAdmin = requireRole('super_admin');
