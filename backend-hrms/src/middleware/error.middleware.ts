// ============================================================
// Centralised error handler
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export interface AppError extends Error { statusCode?: number; code?: string; details?: unknown; }

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
}

export function errorHandler(err: AppError, req: Request, res: Response, _next: NextFunction) {
  const status = err.statusCode || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: err.code || (status === 500 ? 'server_error' : 'error'),
    message: err.message || 'Something went wrong.',
    ...(env.isProduction ? {} : { stack: err.stack }),
    ...(err.details ? { details: err.details } : {}),
  });
}
