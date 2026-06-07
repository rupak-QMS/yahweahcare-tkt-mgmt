// ============================================================
// Vercel serverless function — wraps the Express app
// ============================================================
//
// Vercel routes every request matching the rewrite rule in vercel.json
// through this single function. Express handles routing internally.
//
// Cold start is ~150-300ms after first request; subsequent requests
// reuse the warm function instance for ~5-15 min.

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { env } from '../src/config/env';
import { apiLimiter } from '../src/middleware/rateLimit.middleware';
import { errorHandler, notFound } from '../src/middleware/error.middleware';

import authRoutes          from '../src/modules/auth/auth.routes';
import userRoutes          from '../src/modules/users/users.routes';
import roleRoutes          from '../src/modules/roles/roles.routes';
import auditRoutes         from '../src/modules/audit/audit.routes';
import scheduleRoutes      from '../src/modules/schedules/schedules.routes';
import ticketRoutes        from '../src/modules/tickets/tickets.routes';
import notificationRoutes  from '../src/modules/notifications/notifications.routes';
import pushRoutes          from '../src/modules/notifications/push.routes';
import lookupRoutes        from '../src/modules/lookup/lookup.routes';
import orgRoutes           from '../src/modules/org/org.routes';

// Build the Express app ONCE per cold start
const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(env.SESSION_SECRET));

// Health probe — bypass rate limit
app.get('/health', async (_req, res) => {
  const { pool } = await import('../src/db/pool');
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString(), runtime: 'vercel' });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
});

app.use('/auth',          apiLimiter);
app.use('/users',         apiLimiter);
app.use('/roles',         apiLimiter);
app.use('/audit-logs',    apiLimiter);
app.use('/tickets',       apiLimiter);
app.use('/schedules',     apiLimiter);
app.use('/notifications', apiLimiter);
app.use('/push',          apiLimiter);
app.use('/lookup',        apiLimiter);

app.use('/auth',          authRoutes);
app.use('/users',         userRoutes);
app.use('/roles',         roleRoutes);
app.use('/audit-logs',    auditRoutes);
app.use('/tickets',       ticketRoutes);
app.use('/schedules',     scheduleRoutes);
app.use('/notifications', notificationRoutes);
app.use('/push',          pushRoutes);
app.use('/lookup',        lookupRoutes);
app.use('/org',           orgRoutes);

app.use(notFound);
app.use(errorHandler);

// Vercel serverless handler — adapts Express to Vercel's request/response interface
export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as unknown as express.Request, res as unknown as express.Response);
}
