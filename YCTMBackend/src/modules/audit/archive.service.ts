// ============================================================
// Activity Log Export / Archive helpers
//
// Pure functions only (no DB, no network) so the date math and
// formatting logic can be unit-tested directly. audit.routes.ts
// wires these into the actual HTTP endpoints.
// ============================================================

export type ExportFormat = 'csv' | 'json' | 'txt';
export type Quarter = 1 | 2 | 3 | 4;

// ── Australian Financial Quarter date math ──────────────────
// The Australian Financial Year runs 1 Jul – 30 Jun and is named after
// the calendar year it ENDS in (e.g. FY2026 = 1 Jul 2025 – 30 Jun 2026).
//   Q1: Jul–Sep (of fyYear-1)     Q2: Oct–Dec (of fyYear-1)
//   Q3: Jan–Mar (of fyYear)       Q4: Apr–Jun (of fyYear)
// `end` is an EXCLUSIVE upper bound (start of the following quarter) so
// callers can filter with `created_at >= start AND created_at < end`.
export function getFinancialQuarterRange(
  fyYear: number,
  quarter: Quarter,
): { start: string; end: string; label: string } {
  if (!Number.isInteger(fyYear) || fyYear < 2000 || fyYear > 2100) {
    throw new Error(`Invalid financial year: ${fyYear}`);
  }
  if (![1, 2, 3, 4].includes(quarter)) {
    throw new Error(`Invalid quarter: ${quarter} (must be 1-4)`);
  }

  const startsByQuarter: Record<Quarter, [number, number]> = {
    1: [fyYear - 1, 6],  // July (0-indexed month 6)
    2: [fyYear - 1, 9],  // October
    3: [fyYear, 0],       // January
    4: [fyYear, 3],       // April
  };
  const [startYear, startMonth] = startsByQuarter[quarter];
  const start = new Date(Date.UTC(startYear, startMonth, 1, 0, 0, 0));
  const end   = new Date(Date.UTC(startYear, startMonth + 3, 1, 0, 0, 0));

  return { start: start.toISOString(), end: end.toISOString(), label: `FY${fyYear} Q${quarter}` };
}

export function buildArchiveFilename(fyYear: number, quarter: Quarter): string {
  return `Activity_Log_AU_FY${fyYear}_Q${quarter}.zip`;
}

// ── Severity — derived, not stored ──────────────────────────
// audit_logs has no severity column. Severity is inferred from the
// action name + success flag so display and filtering share one
// definition — see SEVERITY_SQL_CASE for the SQL-side mirror used in
// WHERE clauses (must be kept in sync with computeSeverity()).
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export function computeSeverity(action: string, success: boolean): Severity {
  const a = (action || '').toLowerCase();
  if (success === false) return 'high';
  if (a.includes('delete') || a.includes('truncate') || a.includes('account_locked')) return 'critical';
  if (a.includes('reject') || a.includes('escalate') || a.includes('deactivate') || a.includes('revoke')) return 'high';
  if (a.includes('create') || a.includes('update') || a.includes('assign') || a.includes('approve') || a.includes('change')) return 'medium';
  return 'low';
}

/** SQL CASE expression mirroring computeSeverity(), for filtering in WHERE clauses. */
export const SEVERITY_SQL_CASE = `CASE
    WHEN a.success = FALSE THEN 'high'
    WHEN a.action ILIKE '%delete%' OR a.action ILIKE '%truncate%' OR a.action ILIKE '%account_locked%' THEN 'critical'
    WHEN a.action ILIKE '%reject%' OR a.action ILIKE '%escalate%' OR a.action ILIKE '%deactivate%' OR a.action ILIKE '%revoke%' THEN 'high'
    WHEN a.action ILIKE '%create%' OR a.action ILIKE '%update%' OR a.action ILIKE '%assign%' OR a.action ILIKE '%approve%' OR a.action ILIKE '%change%' THEN 'medium'
    ELSE 'low'
  END`;

// ── Filter builder — shared by the list + export routes ─────
// (The quarterly archive endpoint deliberately ignores these — section 3
// of the spec extracts the WHOLE quarter, unfiltered.)
export interface AuditFilterInput {
  userId?:       number | string | null;
  user?:         string | null;   // free-text match on user name/email — distinct from the numeric userId
  role?:         string | null;
  action?:       string | null;
  module?:       string | null;
  activityType?: string | null; // alias for module — coarse category filter
  since?:        string | null;
  until?:        string | null;
  search?:       string | null;
  ticketNumber?: string | number | null;
  status?:       string | null;   // best-effort match against metadata->>'status'
  severity?:     Severity | string | null;
  ipAddress?:    string | null;
  device?:       string | null;   // matches user_agent — optional per spec
  success?:      'success' | 'failure' | null;
}

export interface AuditFilterResult {
  where:  string;
  params: unknown[];
}

/** Builds a parameterised WHERE clause fragment (joined with AND, always
 *  starting with a harmless `1=1` so callers can always append `AND`).
 *  Assumes the query aliases audit_logs as `a` and (if joined) users as `u`. */
export function buildAuditFilters(input: AuditFilterInput, startIndex = 1): AuditFilterResult {
  const clauses: string[] = ['1=1'];
  const params: unknown[] = [];
  let i = startIndex;

  if (input.userId)       { clauses.push(`a.user_id = $${i++}`); params.push(Number(input.userId)); }
  if (input.user) {
    clauses.push(`(u.name ILIKE $${i} OR u.email ILIKE $${i} OR a.actor_email ILIKE $${i})`);
    params.push(`%${input.user}%`);
    i++;
  }
  if (input.role)         { clauses.push(`u.role = $${i++}`); params.push(input.role); }
  if (input.action)       { clauses.push(`a.action = $${i++}`); params.push(input.action); }
  if (input.module)       { clauses.push(`a.module = $${i++}`); params.push(input.module); }
  if (input.activityType) { clauses.push(`a.module = $${i++}`); params.push(input.activityType); }
  if (input.since)        { clauses.push(`a.created_at >= $${i++}`); params.push(input.since); }
  if (input.until)        { clauses.push(`a.created_at <= $${i++}`); params.push(input.until); }
  if (input.search) {
    clauses.push(`(a.actor_email ILIKE $${i} OR a.action ILIKE $${i} OR a.module ILIKE $${i} OR a.target_type ILIKE $${i} OR u.name ILIKE $${i})`);
    params.push(`%${input.search}%`);
    i++;
  }
  if (input.ticketNumber) {
    clauses.push(`a.target_type = 'ticket' AND a.target_id = $${i++}`);
    params.push(String(input.ticketNumber));
  }
  if (input.status) {
    clauses.push(`a.metadata->>'status' ILIKE $${i++}`);
    params.push(`%${input.status}%`);
  }
  if (input.severity) {
    clauses.push(`(${SEVERITY_SQL_CASE}) = $${i++}`);
    params.push(input.severity);
  }
  if (input.ipAddress) {
    clauses.push(`a.ip_address ILIKE $${i++}`);
    params.push(`%${input.ipAddress}%`);
  }
  if (input.device) {
    clauses.push(`a.user_agent ILIKE $${i++}`);
    params.push(`%${input.device}%`);
  }
  if (input.success === 'success') clauses.push(`a.success = TRUE`);
  if (input.success === 'failure') clauses.push(`a.success = FALSE`);

  return { where: clauses.join(' AND '), params };
}

// ── Format builders ──────────────────────────────────────────
const EXPORT_HEADERS = [
  'id', 'created_at', 'user_id', 'user_name', 'actor_email', 'role', 'action', 'module',
  'target_type', 'target_id', 'severity', 'status', 'success', 'ip_address', 'user_agent', 'metadata',
] as const;

function rowField(r: Record<string, unknown>, h: string): string {
  if (h === 'severity') return computeSeverity(String(r.action ?? ''), r.success !== false);
  if (h === 'status') {
    const m = r.metadata;
    if (m && typeof m === 'object' && 'status' in (m as Record<string, unknown>)) {
      const s = (m as Record<string, unknown>).status;
      if (s != null) return String(s);
    }
    return r.success === false ? 'failure' : 'success';
  }
  const val = (r as Record<string, unknown>)[h];
  if (val == null) return '';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export function buildCsv(rows: Record<string, unknown>[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [EXPORT_HEADERS.map(esc).join(',')];
  for (const r of rows) lines.push(EXPORT_HEADERS.map(h => esc(rowField(r, h))).join(','));
  return lines.join('\n');
}

export function buildJson(rows: Record<string, unknown>[]): string {
  const enriched = rows.map(r => {
    const out: Record<string, unknown> = {};
    for (const h of EXPORT_HEADERS) {
      out[h] = h === 'severity' || h === 'status' ? rowField(r, h) : ((r as Record<string, unknown>)[h] ?? null);
    }
    return out;
  });
  return JSON.stringify(enriched, null, 2);
}

export function buildTxt(rows: Record<string, unknown>[]): string {
  return rows.map(r => {
    const time     = r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? '');
    const actor    = r.user_name || r.actor_email || `User #${r.user_id ?? '?'}`;
    const target   = r.target_type ? `${r.target_type}${r.target_id ? ' #' + r.target_id : ''}` : '—';
    const result   = r.success === false ? 'FAILURE' : 'SUCCESS';
    const severity = rowField(r, 'severity');
    const ip       = r.ip_address ? ` — ip:${r.ip_address}` : '';
    return `[${time}] ${actor} — ${r.action} (${r.module || 'n/a'}) on ${target} — ${result} — severity:${severity}${ip}`;
  }).join('\n');
}

export function contentTypeFor(format: ExportFormat): string {
  return format === 'csv' ? 'text/csv' : format === 'json' ? 'application/json' : 'text/plain';
}

export function buildExport(rows: Record<string, unknown>[], format: ExportFormat): string {
  if (format === 'csv')  return buildCsv(rows);
  if (format === 'json') return buildJson(rows);
  return buildTxt(rows);
}
