// ============================================================
// Email service — shared type definitions
// ============================================================

export type EmailEventType =
  // Ticket lifecycle
  | 'ticket.created'
  | 'ticket.assigned'
  | 'ticket.resolution_submitted'   // assignee marks complete → pending approval
  | 'ticket.approved'
  | 'ticket.rejected'
  | 'ticket.closed'
  | 'ticket.reopened'
  | 'ticket.escalated'
  | 'ticket.comment_added'
  | 'ticket.attachment_added'
  | 'ticket.extension_requested'
  | 'ticket.extension_approved'
  | 'ticket.extension_rejected'
  | 'ticket.status_changed'
  // Scheduled reminders
  | 'ticket.overdue_reminder'
  | 'ticket.due_tomorrow'
  // Account events
  | 'user.account_created'
  | 'user.password_reset'
  // Scheduled reports
  | 'scheduled.report';

export interface EmailRecipient {
  userId?: number;
  email:   string;
  name?:   string;
}

export interface TicketEmailPayload {
  ticketId:         number;
  ticketTitle:      string;
  actorName:        string;
  actorId:          number;
  assigneeName?:    string;
  requesterName?:   string;
  priority?:        string;
  category?:        string;
  dueAt?:           string;
  status?:          string;
  comment?:         string;
  attachmentNames?: string[];
  reason?:          string;     // escalation reason / rejection note
  newDueDate?:      string;     // extension new due date
  daysOverdue?:     number;
  note?:            string;
}

export interface UserEmailPayload {
  targetUserName:      string;
  targetUserEmail:     string;
  actorName:           string;
  temporaryPassword?:  string;
  resetToken?:         string;
  loginUrl?:           string;
}

export interface ScheduledReportEmailPayload {
  reportName:           string;
  frequency:            string;
  recipients:           string[];
  reportHtml?:          string;
  attachmentBase64?:    string;
  attachmentName?:      string;
}

export type EmailPayload =
  | TicketEmailPayload
  | UserEmailPayload
  | ScheduledReportEmailPayload;

export interface QueuedEmailRow {
  id:              string;
  event_name:      string;
  payload:         EmailPayload;
  status:          'pending' | 'sent' | 'failed';
  retry_count:     number;
  next_retry_at:   Date | null;
  created_at:      Date;
}

export interface EmailLogRow {
  id:                 string;
  ticket_id:          number | null;
  recipient_email:    string;
  subject:            string;
  resend_message_id:  string | null;
  status:             'sent' | 'failed' | 'skipped';
  error_message:      string | null;
  sent_at:            Date | null;
  created_at:         Date;
}
