// ============================================================
// Email templates — one function per scenario
// All return { subject, html }
// ============================================================

import { env } from '../../config/env';
import type { EmailEventType, TicketEmailPayload, UserEmailPayload } from './email.types';

// ── Design tokens ─────────────────────────────────────────────
const BRAND   = '#4F46E5';
const LIGHT   = '#EEF2FF';
const TEXT    = '#1E1B4B';
const MUTED   = '#6B7280';
const SUCCESS = '#10B981';
const WARN    = '#F97316';
const DANGER  = '#EF4444';
const AMBER   = '#F59E0B';

// ── Base layout ───────────────────────────────────────────────
function base(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr>
        <td style="background:${BRAND};border-radius:12px 12px 0 0;padding:20px 32px;">
          <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">Yahweahcare</span>
          <span style="color:rgba(255,255,255,0.55);font-size:12px;margin-left:8px;font-weight:500;">Ticket Management</span>
        </td>
      </tr>
      <tr>
        <td style="background:#fff;padding:32px;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;">
          ${body}
        </td>
      </tr>
      <tr>
        <td style="background:#F9FAFB;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px;padding:16px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:${MUTED};">This is an automated notification — do not reply to this email.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function esc(s: string | undefined | null): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badge(label: string, color: string, bg: string): string {
  return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;background:${bg};color:${color};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${label}</span>`;
}

function kv(rows: Array<[string, string]>): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin:16px 0;">
  ${rows.map(([k, v], i) => `<tr style="background:${i % 2 === 0 ? '#F9FAFB' : '#fff'};">
    <td style="padding:9px 14px;font-size:12px;font-weight:600;color:${MUTED};width:30%;border-right:1px solid #E5E7EB;">${k}</td>
    <td style="padding:9px 14px;font-size:13px;color:${TEXT};">${v}</td>
  </tr>`).join('')}
</table>`;
}

function cta(text: string, url: string, color = BRAND): string {
  return `<div style="text-align:center;margin:24px 0;">
  <a href="${url}" style="display:inline-block;padding:12px 28px;background:${color};color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">${text}</a>
</div>`;
}

function ticketUrl(ticketId: number): string {
  return `${env.FRONTEND_URL || ''}#tickets&id=${ticketId}`;
}

function ticketMeta(p: TicketEmailPayload): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Ticket ID', `#${p.ticketId}`],
    ['Title', esc(p.ticketTitle)],
  ];
  if (p.priority) rows.push(['Priority', esc(p.priority)]);
  if (p.category) rows.push(['Category', esc(p.category)]);
  if (p.assigneeName) rows.push(['Assigned To', esc(p.assigneeName)]);
  if (p.requesterName) rows.push(['Requested By', esc(p.requesterName)]);
  if (p.dueAt) rows.push(['Due Date', esc(new Date(p.dueAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }))]);
  return rows;
}

// ── Subject helpers ───────────────────────────────────────────
function tmsSubject(ticketId: number, label: string): string {
  return `[TMS-${ticketId}] ${label}`;
}

// ── Template map ──────────────────────────────────────────────
type TemplateFn = (p: TicketEmailPayload) => { subject: string; html: string };

// 1. Ticket Created
const ticketCreated: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'New Ticket Created'),
  html: base('New Ticket Created', `
    <div style="margin-bottom:16px;">${badge('New Ticket', BRAND, LIGHT)}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      <strong>${esc(p.actorName)}</strong> submitted a new support request.
    </p>
    ${kv(ticketMeta(p))}
    ${cta('View Ticket →', ticketUrl(p.ticketId))}
  `),
});

// 2. Ticket Assigned
const ticketAssigned: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'Ticket Assigned To You'),
  html: base('Ticket Assigned To You', `
    <div style="margin-bottom:16px;">${badge('Assigned', '#2563EB', '#EFF6FF')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      You have been assigned this ticket by <strong>${esc(p.actorName)}</strong>. Please review and begin work.
    </p>
    ${kv(ticketMeta(p))}
    ${cta('View My Ticket →', ticketUrl(p.ticketId))}
  `),
});

// 3. Resolution Submitted (pending approval)
const resolutionSubmitted: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'Approval Required'),
  html: base('Approval Required', `
    <div style="margin-bottom:16px;">${badge('Pending Approval', '#8B5CF6', '#F5F3FF')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      <strong>${esc(p.actorName)}</strong> has marked this ticket as complete and submitted it for your approval.
      Please review the work and approve or reject the resolution.
    </p>
    ${kv(ticketMeta(p))}
    ${cta('Review & Approve →', ticketUrl(p.ticketId), '#8B5CF6')}
  `),
});

// 4. Ticket Approved
const ticketApproved: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'Resolution Approved'),
  html: base('Resolution Approved', `
    <div style="margin-bottom:16px;">${badge('Approved', SUCCESS, '#ECFDF5')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      <strong>${esc(p.actorName)}</strong> has approved the resolution for this ticket.
      ${p.note ? `<br/><br/><em>"${esc(p.note)}"</em>` : ''}
    </p>
    ${kv(ticketMeta(p))}
    ${cta('View Ticket →', ticketUrl(p.ticketId), SUCCESS)}
  `),
});

// 5. Ticket Rejected
const ticketRejected: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'Resolution Rejected'),
  html: base('Resolution Rejected', `
    <div style="margin-bottom:16px;">${badge('Rejected', DANGER, '#FEF2F2')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      <strong>${esc(p.actorName)}</strong> has rejected the resolution. Please review the feedback and resubmit.
      ${p.reason ? `<br/><br/><strong>Reason:</strong> <em>"${esc(p.reason)}"</em>` : ''}
    </p>
    ${kv(ticketMeta(p))}
    ${cta('View Ticket →', ticketUrl(p.ticketId), DANGER)}
  `),
});

// 6. Ticket Closed
const ticketClosed: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'Ticket Closed'),
  html: base('Ticket Closed', `
    <div style="margin-bottom:16px;">${badge('Closed', '#475569', '#F1F5F9')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      <strong>${esc(p.actorName)}</strong> has confirmed resolution and closed this ticket. No further action is required.
    </p>
    ${kv(ticketMeta(p))}
    ${cta('View Ticket →', ticketUrl(p.ticketId), '#475569')}
  `),
});

// 7. Ticket Reopened
const ticketReopened: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'Ticket Reopened'),
  html: base('Ticket Reopened', `
    <div style="margin-bottom:16px;">${badge('Reopened', WARN, '#FFF7ED')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      <strong>${esc(p.actorName)}</strong> has reopened this ticket. Please review and continue work.
      ${p.reason ? `<br/><br/><strong>Reason:</strong> <em>"${esc(p.reason)}"</em>` : ''}
    </p>
    ${kv(ticketMeta(p))}
    ${cta('View Ticket →', ticketUrl(p.ticketId), WARN)}
  `),
});

// 8. Ticket Escalated
const ticketEscalated: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'Ticket Escalated'),
  html: base('Ticket Escalated', `
    <div style="margin-bottom:16px;">${badge('Escalated', DANGER, '#FEF2F2')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      <strong>${esc(p.actorName)}</strong> has escalated this ticket and requires urgent attention.
      ${p.reason ? `<br/><br/><strong>Reason:</strong> <em>"${esc(p.reason)}"</em>` : ''}
    </p>
    ${kv(ticketMeta(p))}
    ${cta('Review Escalation →', ticketUrl(p.ticketId), DANGER)}
  `),
});

// 9. Comment Added
const commentAdded: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'New Comment Added'),
  html: base('New Comment Added', `
    <div style="margin-bottom:16px;">${badge('New Comment', '#0369A1', '#E0F2FE')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 16px;font-size:14px;color:${MUTED};"><strong>${esc(p.actorName)}</strong> added a comment:</p>
    ${p.comment ? `
    <div style="background:#F9FAFB;border-left:4px solid ${BRAND};border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 20px;font-size:14px;color:${TEXT};line-height:1.6;">
      ${esc(p.comment)}
    </div>` : ''}
    ${kv([['Ticket ID', `#${p.ticketId}`], ['Ticket', esc(p.ticketTitle)]])}
    ${cta('Reply to Comment →', ticketUrl(p.ticketId))}
  `),
});

// 10. Attachment Added
const attachmentAdded: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'New Attachment Uploaded'),
  html: base('New Attachment Uploaded', `
    <div style="margin-bottom:16px;">${badge('Attachment', '#0891B2', '#ECFEFF')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 16px;font-size:14px;color:${MUTED};line-height:1.6;">
      <strong>${esc(p.actorName)}</strong> uploaded ${p.attachmentNames?.length ?? 1} file(s) to this ticket:
    </p>
    ${p.attachmentNames?.length ? `
    <ul style="margin:0 0 20px;padding-left:20px;">
      ${p.attachmentNames.map(n => `<li style="font-size:13px;color:${TEXT};margin-bottom:4px;">📎 ${esc(n)}</li>`).join('')}
    </ul>` : ''}
    ${kv([['Ticket ID', `#${p.ticketId}`], ['Ticket', esc(p.ticketTitle)]])}
    ${cta('View Attachments →', ticketUrl(p.ticketId))}
  `),
});

// 11. Extension Requested
const extensionRequested: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'Extension Request'),
  html: base('Extension Request', `
    <div style="margin-bottom:16px;">${badge('Extension Request', AMBER, '#FFFBEB')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      <strong>${esc(p.actorName)}</strong> has requested a deadline extension for this ticket.
      ${p.newDueDate ? `The proposed new due date is <strong>${esc(new Date(p.newDueDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }))}</strong>.` : ''}
      ${p.reason ? `<br/><br/><strong>Reason:</strong> <em>"${esc(p.reason)}"</em>` : ''}
    </p>
    ${kv(ticketMeta(p))}
    ${cta('Review Extension Request →', ticketUrl(p.ticketId), AMBER)}
  `),
});

// 12. Extension Approved
const extensionApproved: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'Extension Approved'),
  html: base('Extension Approved', `
    <div style="margin-bottom:16px;">${badge('Extension Approved', SUCCESS, '#ECFDF5')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      <strong>${esc(p.actorName)}</strong> has approved your deadline extension request.
      ${p.newDueDate ? `Your new due date is <strong>${esc(new Date(p.newDueDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }))}</strong>.` : ''}
    </p>
    ${kv(ticketMeta(p))}
    ${cta('View Ticket →', ticketUrl(p.ticketId), SUCCESS)}
  `),
});

// 13. Extension Rejected
const extensionRejected: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'Extension Rejected'),
  html: base('Extension Rejected', `
    <div style="margin-bottom:16px;">${badge('Extension Rejected', DANGER, '#FEF2F2')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      <strong>${esc(p.actorName)}</strong> has rejected your deadline extension request.
      The original due date remains in effect.
      ${p.reason ? `<br/><br/><strong>Reason:</strong> <em>"${esc(p.reason)}"</em>` : ''}
    </p>
    ${kv(ticketMeta(p))}
    ${cta('View Ticket →', ticketUrl(p.ticketId), DANGER)}
  `),
});

// 14. Overdue Reminder
const overdueReminder: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, `Overdue — ${p.daysOverdue ?? '?'} day(s) past due`),
  html: base('Ticket Overdue', `
    <div style="margin-bottom:16px;">${badge('Overdue', DANGER, '#FEF2F2')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      This ticket is <strong style="color:${DANGER};">${p.daysOverdue ?? '?'} day(s) overdue</strong>.
      Immediate action is required to avoid further SLA breach.
    </p>
    ${kv(ticketMeta(p))}
    ${cta('Resolve Now →', ticketUrl(p.ticketId), DANGER)}
  `),
});

// 15. Due Tomorrow
const dueTomorrow: TemplateFn = (p) => ({
  subject: tmsSubject(p.ticketId, 'Due Tomorrow — Action Required'),
  html: base('Due Tomorrow', `
    <div style="margin-bottom:16px;">${badge('Due Tomorrow', AMBER, '#FFFBEB')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${esc(p.ticketTitle)}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      This ticket is due <strong>tomorrow</strong>. Please ensure resolution is submitted on time to avoid SLA breach.
    </p>
    ${kv(ticketMeta(p))}
    ${cta('View Ticket →', ticketUrl(p.ticketId), AMBER)}
  `),
});

// ── User templates ────────────────────────────────────────────

export function buildAccountCreatedHtml(p: UserEmailPayload): string {
  return base('Welcome to Yahweahcare TMS', `
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">Welcome, ${esc(p.targetUserName)}!</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      Your account has been created on the <strong>Yahweahcare Ticket Management System</strong> by <strong>${esc(p.actorName)}</strong>.
    </p>
    ${kv([
      ['Email', esc(p.targetUserEmail)],
      ...(p.temporaryPassword ? [['Temporary Password', `<code style="background:#F3F4F6;padding:2px 8px;border-radius:4px;font-family:monospace;">${esc(p.temporaryPassword)}</code>`] as [string, string]] : []),
    ])}
    <p style="margin:16px 0;font-size:13px;color:${MUTED};">Please log in and change your password immediately.</p>
    ${cta('Log In Now →', p.loginUrl || env.FRONTEND_URL)}
  `);
}

export function buildPasswordResetHtml(p: UserEmailPayload): string {
  const resetUrl = p.resetToken ? `${env.FRONTEND_URL}/reset-password?token=${p.resetToken}` : env.FRONTEND_URL;
  return base('Password Reset Request', `
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">Password Reset</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">
      A password reset was requested for your account. Click the button below to reset your password.
      This link expires in 1 hour.
    </p>
    ${cta('Reset My Password →', resetUrl, DANGER)}
    <p style="margin:16px 0;font-size:12px;color:${MUTED};">
      If you did not request a password reset, please ignore this email and contact your administrator.
    </p>
  `);
}

// ── Main export: build template by event type ─────────────────
const TICKET_TEMPLATES: Partial<Record<EmailEventType, TemplateFn>> = {
  'ticket.created':             ticketCreated,
  'ticket.assigned':            ticketAssigned,
  'ticket.resolution_submitted':resolutionSubmitted,
  'ticket.approved':            ticketApproved,
  'ticket.rejected':            ticketRejected,
  'ticket.closed':              ticketClosed,
  'ticket.reopened':            ticketReopened,
  'ticket.escalated':           ticketEscalated,
  'ticket.comment_added':       commentAdded,
  'ticket.attachment_added':    attachmentAdded,
  'ticket.extension_requested': extensionRequested,
  'ticket.extension_approved':  extensionApproved,
  'ticket.extension_rejected':  extensionRejected,
  'ticket.overdue_reminder':    overdueReminder,
  'ticket.due_tomorrow':        dueTomorrow,
};

export function buildTicketEmail(
  eventType: EmailEventType,
  payload: TicketEmailPayload,
): { subject: string; html: string } {
  const fn = TICKET_TEMPLATES[eventType];
  if (!fn) {
    return {
      subject: `[TMS-${payload.ticketId}] Update: ${payload.ticketTitle}`,
      html: base('Ticket Update', `
        <p style="font-size:14px;color:${MUTED};">Your ticket <strong>${esc(payload.ticketTitle)}</strong> has been updated by <strong>${esc(payload.actorName)}</strong>.</p>
        ${cta('View Ticket →', ticketUrl(payload.ticketId))}
      `),
    };
  }
  return fn(payload);
}
