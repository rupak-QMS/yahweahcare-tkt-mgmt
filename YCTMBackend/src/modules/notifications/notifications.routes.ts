// ============================================================
// Notifications routes
// ============================================================

import { Router } from 'express';
import * as XLSX from 'xlsx';
import { Resend } from 'resend';
import { pool } from '../../db/pool';
import { requireAuth } from '../../middleware/auth.middleware';
import { ensurePushTable } from './notifications.service';

const router = Router();
router.use(requireAuth);

// GET /notifications — current user's notifications (paginated)
// ?page=1&limit=20 (defaults: page=1, limit=20, max limit=100)
router.get('/', async (req, res, next) => {
  try {
    await ensurePushTable();
    const limit  = Math.min(Number(req.query.limit)  || 20, 100);
    const page   = Math.max(Number(req.query.page)   || 1,  1);
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT * FROM yc_tkt_mgmt.notifications
       WHERE recipient_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.auth!.userId, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE read_at IS NULL) AS unread
       FROM yc_tkt_mgmt.notifications WHERE recipient_id = $1`,
      [req.auth!.userId]
    );

    res.json({
      notifications: rows,
      total:   Number(countRows[0]?.total  || 0),
      unread:  Number(countRows[0]?.unread || 0),
      page,
      limit,
      hasMore: offset + rows.length < Number(countRows[0]?.total || 0),
    });
  } catch (err) { next(err); }
});

// PATCH /notifications/:id/read — mark one read
router.patch('/:id/read', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE yc_tkt_mgmt.notifications SET read_at = NOW(), status = 'read' WHERE id = $1 AND recipient_id = $2`,
      [Number(req.params.id), req.auth!.userId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /notifications/read-all — mark all read
router.post('/read-all', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE yc_tkt_mgmt.notifications SET read_at = NOW(), status = 'read' WHERE recipient_id = $1 AND read_at IS NULL`,
      [req.auth!.userId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /notifications/send-report-email — send report email with Excel attachment via Resend
router.post('/send-report-email', async (req, res, next) => {
  try {
    const { to, subject, reportTitle, period, generatedBy, headers, rows } = req.body || {};
    if (!to || !reportTitle) return res.status(400).json({ error: 'missing_fields' });

    const recipients: string[] = (Array.isArray(to) ? to : String(to).split(','))
      .map((e: string) => e.trim()).filter(Boolean);
    if (!recipients.length) return res.status(400).json({ error: 'no_valid_recipients' });

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'email_not_configured' });

    const safeTitle   = String(reportTitle);
    const safePeriod  = String(period || 'All Time').replace(/_/g, ' ');
    const safeSubject = subject || `${safeTitle} — ${new Date().toLocaleDateString('en-AU')}`;
    const safeBy      = generatedBy || 'System';
    const hdrs: string[]     = Array.isArray(headers) ? headers : [];
    const dataRows: unknown[][] = Array.isArray(rows) ? rows : [];
    const dateStr = new Date().toISOString().slice(0, 10);

    const wsData = hdrs.length ? [hdrs, ...dataRows.map(r => (r as unknown[]).map(c => c ?? ''))] : dataRows;
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    if (hdrs.length) {
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      ws['!cols'] = hdrs.map(() => ({ wch: 20 }));
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r: 0, c });
        if (ws[cellAddr]) ws[cellAddr].s = { font: { bold: true } };
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, safeTitle.slice(0, 31));
    const xlsxBuffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `${safeTitle.replace(/[\s/]+/g, '_')}_${dateStr}.xlsx`;

    const previewRows = dataRows.slice(0, 10);
    const tableHtml = hdrs.length ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:12px;">
        <thead>
          <tr style="background:#4F46E5;color:#fff;">
            ${hdrs.map(h => `<th style="padding:8px 10px;text-align:left;font-weight:700;">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${previewRows.map((row, i) => `
            <tr style="background:${i%2===0?'#fff':'#F9FAFB'};">
              ${(row as unknown[]).map(cell => `<td style="padding:7px 10px;border-bottom:1px solid #E5E7EB;">${cell ?? '—'}</td>`).join('')}
            </tr>`).join('')}
          ${dataRows.length === 0
            ? `<tr><td colspan="${hdrs.length}" style="padding:16px;text-align:center;color:#6B7280;">No records match the selected filters</td></tr>`
            : dataRows.length > 10
              ? `<tr><td colspan="${hdrs.length}" style="padding:10px;text-align:center;color:#6B7280;font-style:italic;">… and ${dataRows.length - 10} more rows in the attached Excel file</td></tr>`
              : ''}
        </tbody>
      </table>` : '';

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;padding:32px 16px;">
  <tr><td align="center">
    <table width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;">
      <tr><td style="background:#4F46E5;border-radius:12px 12px 0 0;padding:24px 32px;">
        <span style="color:#fff;font-size:20px;font-weight:700;">Yahwehcare</span>
        <span style="color:rgba(255,255,255,0.65);font-size:13px;margin-left:8px;">Ticket Management</span>
      </td></tr>
      <tr><td style="background:#fff;padding:28px 32px;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;">
        <h2 style="margin:0 0 4px;font-size:18px;color:#1E1B4B;">📊 ${safeTitle}</h2>
        <p style="margin:0 0 20px;font-size:13px;color:#6B7280;">
          Period: <strong>${safePeriod}</strong> &nbsp;·&nbsp;
          Generated by: <strong>${safeBy}</strong> &nbsp;·&nbsp;
          ${new Date().toLocaleString('en-AU')}
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#374151;font-weight:600;">
          ${dataRows.length} record${dataRows.length!==1?'s':''} — full report attached as <em>${filename}</em>
        </p>
        ${tableHtml}
      </td></tr>
      <tr><td style="background:#F3F4F6;border:1px solid #E5E7EB;border-top:0;border-radius:0 0 12px 12px;padding:14px 32px;text-align:center;">
        <p style="margin:0;font-size:11px;color:#6B7280;">Automated report from Yahwehcare Ticket Management. Do not reply to this email.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

    const resend = new Resend(apiKey);
    const from = process.env.EMAIL_FROM || 'Yahwehcare <onboarding@resend.dev>';
    const { error } = await resend.emails.send({
      from,
      to: recipients,
      subject: safeSubject,
      html,
      attachments: [{ filename, content: xlsxBuffer }],
    });

    if (error) {
      console.error('[send-report-email] Resend error:', error);
      return res.status(502).json({ error: 'email_send_failed', detail: error });
    }

    res.json({ ok: true, recipients, count: dataRows.length, filename });
  } catch (err) { next(err); }
});

// POST /notifications — create (internal use: from ticket events)
router.post('/', async (req, res, next) => {
  try {
    const { recipientId, recipientEmail, ticketId, channel, subject, body } = req.body || {};
    if (!subject || !body || !channel) return res.status(400).json({ error: 'missing_fields' });
    const { rows } = await pool.query(
      `INSERT INTO yc_tkt_mgmt.notifications (recipient_id, recipient_email, ticket_id, channel, subject, body, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
      [recipientId || null, recipientEmail || null, ticketId || null, channel, subject, body]
    );
    res.status(201).json({ notification: rows[0] });
  } catch (err) { next(err); }
});

export default router;
