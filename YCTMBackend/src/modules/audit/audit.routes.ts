// ============================================================
// Activity Log — read, filtered export (CSV/JSON/TXT), and the
// manual Australian Financial Quarter archive/email/truncate
// workflow (Bootstrap Admin only, no automatic execution).
//
//   GET  /audit-logs                          — filterable, paginated list
//   GET  /audit-logs/export                   — filtered export (csv|json|txt)
//   POST /audit-logs/archive/generate         — build+store a quarterly ZIP
//   GET  /audit-logs/archives                 — list generated archives
//   GET  /audit-logs/archives/:id/download    — download a ZIP directly
//   POST /audit-logs/archives/:id/email       — email the ZIP to all bootstrap admins
//   POST /audit-logs/archives/:id/truncate    — delete the archived quarter's rows
//        (only once that archive has been emailed successfully; requires confirm:true)
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import JSZip from 'jszip';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/rbac.middleware';
import { logAudit } from './audit.service';
import { ensureArchiveTable } from './archive.migrate';
import { sendEmail } from '../../services/email/resend.service';
import {
  buildAuditFilters,
  buildExport,
  buildCsv,
  buildJson,
  buildTxt,
  buildArchiveFilename,
  contentTypeFor,
  getFinancialQuarterRange,
  type AuditFilterInput,
  type ExportFormat,
  type Quarter,
} from './archive.service';

const router = Router();
router.use(requireAuth);

// ── Bootstrap admin guard ─────────────────────────────────────
// Mirrors modules/email/email.routes.ts — the whole export/archive/
// truncate workflow is Bootstrap Admin only per spec, not just
// permission-gated (super_admin/admin roles are NOT enough).
async function requireBootstrapAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) { res.status(401).json({ error: 'unauthorized' }); return; }
  const { rows } = await pool.query(
    `SELECT is_bootstrap_admin FROM yc_tkt_mgmt.users WHERE id = $1`,
    [req.auth.userId],
  );
  if (!rows[0]?.is_bootstrap_admin) {
    res.status(403).json({ error: 'forbidden', message: 'Bootstrap admin only' });
    return;
  }
  next();
}

function parseFilters(req: Request): AuditFilterInput {
  const q = req.query;
  return {
    userId:       q.userId ? Number(q.userId) : null,
    user:         (q.user as string) || null,
    role:         (q.role as string) || null,
    action:       (q.action as string) || null,
    module:       (q.module as string) || null,
    activityType: (q.activityType as string) || null,
    since:        (q.since as string) || null,
    until:        (q.until as string) || null,
    search:       (q.search as string) || null,
    ticketNumber: (q.ticketNumber as string) || null,
    status:       (q.status as string) || null,
    severity:     (q.severity as string) || null,
    ipAddress:    (q.ipAddress as string) || null,
    device:       (q.device as string) || null,
    success:      (q.success as 'success' | 'failure') || null,
  };
}

// ── GET /audit-logs — filterable, paginated audit list ─────────
router.get('/', requirePermission('audit.read'), async (req, res) => {
  const limit  = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const { where, params } = buildAuditFilters(parseFilters(req));

  const { rows } = await pool.query(
    `SELECT a.id, a.user_id, a.actor_email, a.action, a.module, a.target_type, a.target_id,
            a.metadata, a.ip_address, a.user_agent, a.success, a.created_at,
            u.name AS user_name, u.role, COUNT(*) OVER() AS total
       FROM yc_tkt_mgmt.audit_logs a
       LEFT JOIN yc_tkt_mgmt.users u ON u.id = a.user_id
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  res.json({ entries: rows.map(({ total: _, ...r }) => r), total });
});

// ── DELETE /audit-logs — manual, filtered deletion ──────────────
// Deletes whatever the current search + filters match — the same
// filter set used by the list and export routes above (mirrors
// "delete what you'd export"). This is separate from, and does not
// require, the quarterly archive/email/truncate workflow below; it's
// for ad-hoc cleanup of specific filtered entries.
//
// Safety:
//   - requires ?confirm=true
//   - if NO search/filters are applied (i.e. this would wipe the
//     entire Activity Log), also requires ?confirmAll=true
//   - capped at 50,000 rows per request (oldest first) so a single
//     click can't silently nuke an unexpectedly large match
router.delete('/', requireBootstrapAdmin, async (req, res, next) => {
  try {
    const filters = parseFilters(req);
    const { where, params } = buildAuditFilters(filters);
    const hasFilters = where !== '1=1';

    const confirm    = req.query.confirm === 'true' || req.query.confirm === '1';
    const confirmAll = req.query.confirmAll === 'true' || req.query.confirmAll === '1';

    if (!confirm) {
      return res.status(400).json({ error: 'confirmation_required', message: 'Deletion requires confirm=true.' });
    }
    if (!hasFilters && !confirmAll) {
      return res.status(400).json({
        error: 'no_filters',
        message: 'No search or filters are applied — this would delete the entire Activity Log. Apply filters first, or pass confirmAll=true to proceed anyway.',
      });
    }

    const del = await pool.query(
      `DELETE FROM yc_tkt_mgmt.audit_logs
        WHERE id IN (
          SELECT a.id
            FROM yc_tkt_mgmt.audit_logs a
            LEFT JOIN yc_tkt_mgmt.users u ON u.id = a.user_id
           WHERE ${where}
           ORDER BY a.created_at ASC
           LIMIT 50000
        )`,
      params
    );
    const deletedCount = del.rowCount || 0;

    // Logged AFTER the delete — this row is inserted once the statement
    // above has already completed, so it can't have deleted itself.
    await logAudit({
      userId: req.auth!.userId, actorEmail: req.auth!.email,
      action: 'activitylog.delete', module: 'audit',
      metadata: { filters, deletedCount, confirmAll },
      req,
    });

    res.json({ ok: true, deletedCount });
  } catch (err) { next(err); }
});

// ── GET /audit-logs/export — manual, filtered, CSV/JSON/TXT ────
router.get('/export', requireBootstrapAdmin, async (req, res, next) => {
  try {
    const format = ((req.query.format as string) || 'csv').toLowerCase() as ExportFormat;
    if (!['csv', 'json', 'txt'].includes(format)) {
      return res.status(400).json({ error: 'invalid_format', message: 'format must be csv, json, or txt' });
    }

    const filters = parseFilters(req);
    const { where, params } = buildAuditFilters(filters);

    const { rows } = await pool.query(
      `SELECT a.id, a.user_id, u.name AS user_name, a.actor_email, u.role, a.action, a.module,
              a.target_type, a.target_id, a.metadata, a.ip_address, a.user_agent, a.success, a.created_at
         FROM yc_tkt_mgmt.audit_logs a
         LEFT JOIN yc_tkt_mgmt.users u ON u.id = a.user_id
        WHERE ${where}
        ORDER BY a.created_at DESC
        LIMIT 50000`,
      params
    );

    await logAudit({
      userId: req.auth!.userId, actorEmail: req.auth!.email,
      action: 'activitylog.export', module: 'audit',
      metadata: { format, filters, rowCount: rows.length }, req,
    });

    const content = buildExport(rows, format);
    res.setHeader('Content-Type', contentTypeFor(format));
    res.setHeader('Content-Disposition', `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.${format}"`);
    res.send(content);
  } catch (err) { next(err); }
});

// ── POST /audit-logs/archive/generate — build + store a quarterly ZIP ──
router.post('/archive/generate', requireBootstrapAdmin, async (req, res, next) => {
  try {
    await ensureArchiveTable();

    const fyYear  = Number(req.body?.fyYear);
    const quarter = Number(req.body?.quarter) as Quarter;
    let range;
    try {
      range = getFinancialQuarterRange(fyYear, quarter);
    } catch (e) {
      return res.status(400).json({ error: 'invalid_period', message: (e as Error).message });
    }

    const { rows } = await pool.query(
      `SELECT a.id, a.user_id, u.name AS user_name, a.actor_email, u.role, a.action, a.module,
              a.target_type, a.target_id, a.metadata, a.ip_address, a.user_agent, a.success, a.created_at
         FROM yc_tkt_mgmt.audit_logs a
         LEFT JOIN yc_tkt_mgmt.users u ON u.id = a.user_id
        WHERE a.created_at >= $1 AND a.created_at < $2
        ORDER BY a.created_at ASC
        LIMIT 500000`,
      [range.start, range.end]
    );

    const filename = buildArchiveFilename(fyYear, quarter);
    const zip = new JSZip();
    zip.file('activity_log.csv',  buildCsv(rows));
    zip.file('activity_log.json', buildJson(rows));
    zip.file('activity_log.txt',  buildTxt(rows));
    const zipBuffer: Buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const { rows: inserted } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.activity_log_archives
         (fy_year, quarter, period_start, period_end, filename, record_count, zip_data, generated_by, generated_by_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, generated_at`,
      [fyYear, quarter, range.start, range.end, filename, rows.length, zipBuffer, req.auth!.userId, req.auth!.email]
    );
    const archiveId = inserted[0].id;

    await logAudit({
      userId: req.auth!.userId, actorEmail: req.auth!.email,
      action: 'activitylog.archive_generate', module: 'audit',
      targetType: 'archive', targetId: archiveId,
      metadata: { fyYear, quarter, filename, recordCount: rows.length, periodStart: range.start, periodEnd: range.end },
      req,
    });

    res.json({
      archive: {
        id: archiveId, fyYear, quarter, filename,
        recordCount: rows.length,
        periodStart: range.start, periodEnd: range.end,
        generatedAt: inserted[0].generated_at,
      },
    });
  } catch (err) { next(err); }
});

// ── GET /audit-logs/archives — list generated archives (metadata only) ──
router.get('/archives', requireBootstrapAdmin, async (_req, res, next) => {
  try {
    await ensureArchiveTable();
    const { rows } = await pool.query(
      `SELECT id, fy_year, quarter, period_start, period_end, filename, record_count,
              generated_by_email, generated_at, emailed_at, email_status, email_error,
              email_recipients, truncated_at, truncated_count
         FROM yc_tkt_mgmt.activity_log_archives
        ORDER BY generated_at DESC
        LIMIT 200`
    );
    res.json({ archives: rows });
  } catch (err) { next(err); }
});

// ── GET /audit-logs/archives/:id/download — direct ZIP download ────
router.get('/archives/:id/download', requireBootstrapAdmin, async (req, res, next) => {
  try {
    await ensureArchiveTable();
    const { rows } = await pool.query(
      `SELECT filename, zip_data FROM yc_tkt_mgmt.activity_log_archives WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });

    await logAudit({
      userId: req.auth!.userId, actorEmail: req.auth!.email,
      action: 'activitylog.archive_download', module: 'audit',
      targetType: 'archive', targetId: req.params.id,
      metadata: { filename: rows[0].filename }, req,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${rows[0].filename}"`);
    res.send(rows[0].zip_data);
  } catch (err) { next(err); }
});

// ── POST /audit-logs/archives/:id/email — send ZIP to all bootstrap admins ──
router.post('/archives/:id/email', requireBootstrapAdmin, async (req, res, next) => {
  try {
    await ensureArchiveTable();
    const { rows } = await pool.query(
      `SELECT id, fy_year, quarter, filename, zip_data FROM yc_tkt_mgmt.activity_log_archives WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    const archive = rows[0];

    const { rows: adminRows } = await pool.query(
      `SELECT email FROM yc_tkt_mgmt.users
        WHERE is_bootstrap_admin = TRUE AND is_active = TRUE AND email IS NOT NULL`
    );
    const recipients: string[] = adminRows.map((r: { email: string }) => r.email).filter(Boolean);
    if (!recipients.length) {
      return res.status(400).json({ error: 'no_recipients', message: 'No active Bootstrap Administrators with an email address were found.' });
    }

    const subject = `Australian Financial Quarter Activity Log Archive – FY${archive.fy_year} Q${archive.quarter}`;
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">
        <div style="background:#4F46E5;border-radius:10px 10px 0 0;padding:18px 24px;">
          <span style="color:#fff;font-size:18px;font-weight:700;">Yahwehcare</span>
          <span style="color:rgba(255,255,255,0.6);font-size:12px;margin-left:8px;">Ticket Management</span>
        </div>
        <div style="background:#fff;border:1px solid #E5E7EB;border-top:0;padding:28px;color:#1E293B;font-size:14px;line-height:1.6;">
          <p>Dear Bootstrap Administrator,</p>
          <p>Please find attached the Activity Log archive for the completed Australian Financial Quarter.</p>
          <p>The attached ZIP file contains the Activity Log in the following formats:</p>
          <ul><li>CSV</li><li>JSON</li><li>TXT</li></ul>
          <p><strong>Reporting Period:</strong><br/>FY${archive.fy_year} – Quarter ${archive.quarter}</p>
          <p>This archive has been generated for audit, compliance, and record retention purposes.</p>
          <p>Regards,<br/>Yahweh Property Care<br/>System Administration</p>
        </div>
        <div style="background:#F3F4F6;border:1px solid #E5E7EB;border-top:0;border-radius:0 0 10px 10px;padding:14px 24px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#6B7280;">Automated message from Yahwehcare Ticket Management. Please do not reply to this email.</p>
        </div>
      </div>`;

    const result = await sendEmail({
      to: recipients,
      subject,
      html,
      attachments: [{ filename: archive.filename, content: archive.zip_data as Buffer }],
    });

    const emailStatus = result.ok ? 'sent' : 'failed';
    await pool.query(
      `UPDATE yc_tkt_mgmt.activity_log_archives
          SET emailed_at = NOW(), emailed_by = $2, email_status = $3, email_error = $4, email_recipients = $5
        WHERE id = $1`,
      [req.params.id, req.auth!.userId, emailStatus, result.ok ? null : (result.error || null), JSON.stringify(recipients)]
    );

    await logAudit({
      userId: req.auth!.userId, actorEmail: req.auth!.email,
      action: 'activitylog.archive_email', module: 'audit',
      targetType: 'archive', targetId: req.params.id,
      success: result.ok,
      metadata: { filename: archive.filename, recipients, status: emailStatus, error: result.error },
      req,
    });

    res.json({ ok: result.ok, emailStatus, recipients, error: result.error });
  } catch (err) { next(err); }
});

// ── POST /audit-logs/archives/:id/truncate — delete the archived quarter's rows ──
// Only allowed once that specific archive has been emailed successfully.
// Requires an explicit { confirm: true } in the body on top of whatever
// confirmation dialog the client already showed.
router.post('/archives/:id/truncate', requireBootstrapAdmin, async (req, res, next) => {
  try {
    await ensureArchiveTable();
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'confirmation_required', message: 'Truncation requires { confirm: true } in the request body.' });
    }

    const { rows } = await pool.query(
      `SELECT id, fy_year, quarter, filename, period_start, period_end, email_status, truncated_at
         FROM yc_tkt_mgmt.activity_log_archives WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    const archive = rows[0];

    if (archive.truncated_at) {
      return res.status(400).json({ error: 'already_truncated', message: 'This archive has already been truncated.' });
    }
    if (archive.email_status !== 'sent') {
      return res.status(400).json({
        error: 'email_not_sent',
        message: 'This archive must be successfully emailed to all Bootstrap Administrators before it can be truncated.',
      });
    }

    const del = await pool.query(
      `DELETE FROM yc_tkt_mgmt.audit_logs WHERE created_at >= $1 AND created_at < $2`,
      [archive.period_start, archive.period_end]
    );
    const truncatedCount = del.rowCount || 0;

    await pool.query(
      `UPDATE yc_tkt_mgmt.activity_log_archives
          SET truncated_at = NOW(), truncated_by = $2, truncated_count = $3
        WHERE id = $1`,
      [req.params.id, req.auth!.userId, truncatedCount]
    );

    // Logged AFTER the delete — this row is timestamped now, outside the
    // (past, completed) quarter that was just truncated, so it survives.
    await logAudit({
      userId: req.auth!.userId, actorEmail: req.auth!.email,
      action: 'activitylog.truncate', module: 'audit',
      targetType: 'archive', targetId: req.params.id,
      metadata: { fyYear: archive.fy_year, quarter: archive.quarter, filename: archive.filename, truncatedCount },
      req,
    });

    res.json({ ok: true, truncatedCount });
  } catch (err) { next(err); }
});

export default router;
