// ============================================================
// Email Service — Resend integration
// Gracefully degrades (no-op) if RESEND_API_KEY is not set.
// ============================================================

import { Resend } from 'resend';
import { env } from '../../config/env';
import type { TicketEvent, UserEvent, NotifyEvent } from './notifications.service';

// ── Resend client (lazy init) ─────────────────────────────
let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

// ── Base styles ───────────────────────────────────────────
const BRAND   = '#4F46E5';
const LIGHT   = '#EEF2FF';
const TEXT    = '#1E1B4B';
const MUTED   = '#6B7280';
const SUCCESS = '#10B981';
const WARN    = '#F97316';
const DANGER  = '#EF4444';

function baseLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:${BRAND};border-radius:12px 12px 0 0;padding:24px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Yahwehcare</span>
                  <span style="color:rgba(255,255,255,0.6);font-size:13px;margin-left:8px;">Ticket Management</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background:#fff;padding:32px;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#F3F4F6;border:1px solid #E5E7EB;border-top:0;border-radius:0 0 12px 12px;padding:16px 32px;text-align:center;">
            <p style="margin:0;font-size:12px;color:${MUTED};">
              This is an automated notification from Yahwehcare Ticket Management.<br/>
              Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function badge(label: string, color: string, bg: string): string {
  return `<span style="display:inline-block;padding:2px 10px;border-radius:20px;background:${bg};color:${color};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${label}</span>`;
}

function keyValue(rows: Array<[string, string]>): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin:16px 0;">
    ${rows.map(([k, v], i) => `
    <tr style="background:${i % 2 === 0 ? '#F9FAFB' : '#fff'};">
      <td style="padding:10px 16px;font-size:12px;font-weight:600;color:${MUTED};width:35%;border-right:1px solid #E5E7EB;">${k}</td>
      <td style="padding:10px 16px;font-size:13px;color:${TEXT};">${v}</td>
    </tr>`).join('')}
  </table>`;
}

function ctaButton(text: string, url: string): string {
  return `<div style="text-align:center;margin:24px 0;">
    <a href="${url}" style="display:inline-block;padding:12px 28px;background:${BRAND};color:#fff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">${text}</a>
  </div>`;
}

// ── Ticket event email ────────────────────────────────────
export function buildTicketEventHtml(ev: TicketEvent, frontendUrl: string): string {
  const actor = ev.actorName || `User #${ev.actorId}`;

  const statusColors: Record<string, { color: string; bg: string }> = {
    'ticket.created':       { color: BRAND,   bg: LIGHT },
    'ticket.status_changed':{ color: '#0369A1', bg: '#E0F2FE' },
    'ticket.escalated':     { color: DANGER,  bg: '#FEF2F2' },
    'ticket.completed':     { color: SUCCESS, bg: '#ECFDF5' },
    'ticket.approved':      { color: SUCCESS, bg: '#ECFDF5' },
    'ticket.rejected':      { color: DANGER,  bg: '#FEF2F2' },
  };

  const labels: Record<string, string> = {
    'ticket.created':        'New Ticket',
    'ticket.status_changed': 'Status Updated',
    'ticket.escalated':      'Escalated',
    'ticket.completed':      'Completed',
    'ticket.approved':       'Approved',
    'ticket.rejected':       'Rejected',
  };

  const { color, bg } = statusColors[ev.type] ?? { color: BRAND, bg: LIGHT };
  const label = labels[ev.type] ?? 'Notification';

  const actionLine: Record<string, string> = {
    'ticket.created':        `<strong>${actor}</strong> created a new support ticket.`,
    'ticket.status_changed': `<strong>${actor}</strong> changed the status to <strong>${ev.extra || 'updated'}</strong>.`,
    'ticket.escalated':      `<strong>${actor}</strong> escalated this ticket for urgent attention.`,
    'ticket.completed':      `<strong>${actor}</strong> marked this ticket as complete.`,
    'ticket.approved':       `<strong>${actor}</strong> approved this ticket.`,
    'ticket.rejected':       `<strong>${actor}</strong> rejected this ticket.`,
  };

  const body = `
    <div style="margin-bottom:20px;">
      ${badge(label, color, bg)}
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;color:${TEXT};font-weight:700;">${ev.ticketTitle}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.6;">${actionLine[ev.type] ?? `${actor} updated ticket #${ev.ticketId}.`}</p>
    ${keyValue([
      ['Ticket ID',  `#${ev.ticketId}`],
      ['Action',     label],
      ['By',         actor],
      ['Time',       new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' })],
    ])}
    ${ctaButton('View Ticket →', `${frontendUrl}?page=tickets&id=${ev.ticketId}`)}
  `;

  return baseLayout(`${label}: ${ev.ticketTitle}`, body);
}

// ── Scheduled report email ────────────────────────────────
export interface ReportData {
  total: number;
  open: number;
  resolved: number;
  escalated: number;
  slaBreached: number;
  slaRate: number;
  topCategory: string;
  generatedAt: string;
  reportType: string;
  rows: Array<{ label: string; value: number; pct?: number }>;
}

export function buildScheduledReportHtml(
  scheduleName: string,
  frequency: string,
  data: ReportData,
): string {
  const statBox = (label: string, value: string | number, color: string) =>
    `<td style="text-align:center;padding:16px;background:#F9FAFB;border-radius:8px;border:1px solid #E5E7EB;">
      <div style="font-size:28px;font-weight:800;color:${color};">${value}</div>
      <div style="font-size:11px;color:${MUTED};margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">${label}</div>
    </td>`;

  const tableRows = data.rows.slice(0, 10).map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#F9FAFB' : '#fff'};">
      <td style="padding:10px 16px;font-size:13px;color:${TEXT};">${r.label}</td>
      <td style="padding:10px 16px;font-size:13px;color:${TEXT};text-align:right;font-weight:600;">${r.value}</td>
      ${r.pct !== undefined ? `<td style="padding:10px 16px;font-size:12px;color:${MUTED};text-align:right;">${r.pct}%</td>` : ''}
    </tr>`).join('');

  const body = `
    <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:${TEXT};">${scheduleName}</h2>
    <p style="margin:0 0 24px;font-size:13px;color:${MUTED};">
      ${frequency.charAt(0).toUpperCase() + frequency.slice(1)} report &middot; Generated ${data.generatedAt}
    </p>

    <!-- KPI row -->
    <table width="100%" cellpadding="8" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        ${statBox('Total Tickets', data.total, BRAND)}
        <td width="8"></td>
        ${statBox('Open', data.open, WARN)}
        <td width="8"></td>
        ${statBox('Resolved', data.resolved, SUCCESS)}
        <td width="8"></td>
        ${statBox('SLA Rate', `${data.slaRate}%`, data.slaRate >= 80 ? SUCCESS : data.slaRate >= 60 ? WARN : DANGER)}
      </tr>
    </table>

    ${data.escalated > 0 ? `
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#DC2626;">⚠️ <strong>${data.escalated} escalated ticket${data.escalated !== 1 ? 's' : ''}</strong> require attention.</p>
    </div>` : ''}

    ${data.rows.length > 0 ? `
    <h3 style="margin:0 0 8px;font-size:14px;font-weight:700;color:${TEXT};">Breakdown</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
      <tr style="background:${BRAND};">
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#fff;text-transform:uppercase;">Label</td>
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#fff;text-transform:uppercase;text-align:right;">Count</td>
        ${data.rows[0]?.pct !== undefined ? '<td style="padding:10px 16px;font-size:12px;font-weight:700;color:#fff;text-transform:uppercase;text-align:right;">Share</td>' : ''}
      </tr>
      ${tableRows}
    </table>` : ''}

    ${ctaButton('Open Analytics Dashboard →', `${env.FRONTEND_URL}?page=analytics`)}
  `;

  return baseLayout(`${scheduleName} — ${frequency} report`, body);
}

// ── SLA breach alert email ────────────────────────────────
export interface SlaBreachTicket {
  id: number;
  title: string;
  assigneeName: string;
  daysOverdue: number;
  priority: string;
  category: string;
}

export function buildSlaBreachHtml(tickets: SlaBreachTicket[]): string {
  const rows = tickets.slice(0, 20).map((t, i) => {
    const urgency = t.daysOverdue >= 7 ? DANGER : t.daysOverdue >= 3 ? WARN : '#EAB308';
    return `
    <tr style="background:${i % 2 === 0 ? '#F9FAFB' : '#fff'};">
      <td style="padding:10px 16px;font-size:13px;color:${TEXT};">#${t.id} — ${t.title}</td>
      <td style="padding:10px 16px;font-size:12px;color:${MUTED};">${t.assigneeName || 'Unassigned'}</td>
      <td style="padding:10px 16px;font-size:12px;color:${MUTED};">${t.category}</td>
      <td style="padding:10px 16px;font-size:13px;font-weight:700;color:${urgency};text-align:right;">${t.daysOverdue}d</td>
    </tr>`;
  }).join('');

  const body = `
    <div style="margin-bottom:20px;">${badge('SLA Breach Alert', DANGER, '#FEF2F2')}</div>
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:${TEXT};">
      ${tickets.length} Ticket${tickets.length !== 1 ? 's' : ''} Past SLA Due Date
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:${MUTED};line-height:1.6;">
      The following tickets have exceeded their SLA due dates and require immediate attention.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      <tr style="background:${DANGER};">
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#fff;">Ticket</td>
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#fff;">Assignee</td>
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#fff;">Category</td>
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#fff;text-align:right;">Overdue</td>
      </tr>
      ${rows}
    </table>

    ${tickets.length > 20 ? `<p style="font-size:12px;color:${MUTED};text-align:center;">+ ${tickets.length - 20} more tickets. View all in the dashboard.</p>` : ''}
    ${ctaButton('Review Overdue Tickets →', `${env.FRONTEND_URL}?page=tickets&filter=overdue`)}
  `;

  return baseLayout('SLA Breach Alert', body);
}

// ── Main send wrapper ─────────────────────────────────────
export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
): Promise<void> {
  const client = getResend();
  if (!client) {
    console.warn('[email] RESEND_API_KEY not configured — email skipped');
    return;
  }
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return;
  try {
    const { error } = await client.emails.send({
      from: env.EMAIL_FROM,
      to: recipients,
      subject,
      html,
    });
    if (error) console.error('[email] Resend error:', error);
  } catch (err) {
    console.error('[email] send failed:', err);
  }
}

// ── Convenience: send ticket event email to recipients ────
export async function sendTicketEventEmail(
  ev: TicketEvent,
  recipientEmails: string[],
): Promise<void> {
  if (!recipientEmails.length) return;
  const labels: Record<string, string> = {
    'ticket.created':        'New Ticket Created',
    'ticket.status_changed': `Ticket Status Updated`,
    'ticket.escalated':      'Ticket Escalated',
    'ticket.completed':      'Ticket Completed',
    'ticket.approved':       'Ticket Approved',
    'ticket.rejected':       'Ticket Rejected',
  };
  const subject = `${labels[ev.type] ?? 'Ticket Update'}: ${ev.ticketTitle}`;
  const html    = buildTicketEventHtml(ev, env.FRONTEND_URL);
  await sendEmail(recipientEmails, subject, html);
}

// ── Convenience: send user event email ───────────────────
export async function sendUserEventEmail(
  ev: UserEvent,
  recipientEmails: string[],
): Promise<void> {
  if (!recipientEmails.length) return;
  const subject = `Team Update: ${ev.targetUserName}`;
  const action  = ev.actorName || `User #${ev.actorId}`;
  const lines: Record<string, string> = {
    'user.created':          `${action} added <strong>${ev.targetUserName}</strong> to the team.`,
    'user.position_changed': `${action} updated <strong>${ev.targetUserName}</strong>'s position to <strong>${ev.extra || 'new role'}</strong>.`,
    'user.deleted':          `${action} removed <strong>${ev.targetUserName}</strong> from the team.`,
  };
  const body = `
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:${TEXT};">Team Update</h2>
    <p style="font-size:14px;color:${MUTED};line-height:1.6;">${lines[ev.type] ?? `${ev.targetUserName} was updated.`}</p>
    ${ctaButton('Open Staff Management →', `${env.FRONTEND_URL}?page=staff-management`)}
  `;
  await sendEmail(recipientEmails, subject, baseLayout(subject, body));
}
