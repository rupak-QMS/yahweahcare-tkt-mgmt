// ============================================================
// Tests for archive.service.ts — pure logic only (no DB, no network).
// Covers:
//   getFinancialQuarterRange() — AU FY date math for all 4 quarters
//   buildArchiveFilename()     — naming convention
//   computeSeverity()          — action/success → severity mapping
//   buildAuditFilters()        — WHERE-clause + params builder
//   buildCsv/buildJson/buildTxt — export formatters
// ============================================================

import {
  getFinancialQuarterRange,
  buildArchiveFilename,
  computeSeverity,
  buildAuditFilters,
  buildCsv,
  buildJson,
  buildTxt,
  buildExport,
  contentTypeFor,
} from '../modules/audit/archive.service';

describe('getFinancialQuarterRange()', () => {
  it('Q1 (Jul–Sep) of FY2026 is 1 Jul 2025 – 1 Oct 2025 (exclusive end)', () => {
    const r = getFinancialQuarterRange(2026, 1);
    expect(r.start).toBe(new Date(Date.UTC(2025, 6, 1)).toISOString());
    expect(r.end).toBe(new Date(Date.UTC(2025, 9, 1)).toISOString());
    expect(r.label).toBe('FY2026 Q1');
  });

  it('Q2 (Oct–Dec) of FY2026 is 1 Oct 2025 – 1 Jan 2026', () => {
    const r = getFinancialQuarterRange(2026, 2);
    expect(r.start).toBe(new Date(Date.UTC(2025, 9, 1)).toISOString());
    expect(r.end).toBe(new Date(Date.UTC(2026, 0, 1)).toISOString());
  });

  it('Q3 (Jan–Mar) of FY2026 is 1 Jan 2026 – 1 Apr 2026', () => {
    const r = getFinancialQuarterRange(2026, 3);
    expect(r.start).toBe(new Date(Date.UTC(2026, 0, 1)).toISOString());
    expect(r.end).toBe(new Date(Date.UTC(2026, 3, 1)).toISOString());
  });

  it('Q4 (Apr–Jun) of FY2026 is 1 Apr 2026 – 1 Jul 2026', () => {
    const r = getFinancialQuarterRange(2026, 4);
    expect(r.start).toBe(new Date(Date.UTC(2026, 3, 1)).toISOString());
    expect(r.end).toBe(new Date(Date.UTC(2026, 6, 1)).toISOString());
  });

  it('quarters are contiguous across the FY boundary (Q1 start of next FY = Q4 end of this FY)', () => {
    const q4 = getFinancialQuarterRange(2026, 4);
    const nextQ1 = getFinancialQuarterRange(2027, 1);
    expect(q4.end).toBe(nextQ1.start);
  });

  it('throws on an invalid financial year', () => {
    expect(() => getFinancialQuarterRange(1999, 1)).toThrow(/Invalid financial year/);
    expect(() => getFinancialQuarterRange(NaN, 1)).toThrow(/Invalid financial year/);
  });

  it('throws on an invalid quarter', () => {
    expect(() => getFinancialQuarterRange(2026, 0 as any)).toThrow(/Invalid quarter/);
    expect(() => getFinancialQuarterRange(2026, 5 as any)).toThrow(/Invalid quarter/);
  });
});

describe('buildArchiveFilename()', () => {
  it('matches the required naming convention', () => {
    expect(buildArchiveFilename(2026, 1)).toBe('Activity_Log_AU_FY2026_Q1.zip');
    expect(buildArchiveFilename(2027, 4)).toBe('Activity_Log_AU_FY2027_Q4.zip');
  });
});

describe('computeSeverity()', () => {
  it('failed actions are always "high", regardless of action name', () => {
    expect(computeSeverity('login.success', false)).toBe('high');
  });
  it('delete/truncate/account_locked actions are "critical"', () => {
    expect(computeSeverity('user.delete', true)).toBe('critical');
    expect(computeSeverity('activitylog.truncate', true)).toBe('critical');
    expect(computeSeverity('login.account_locked', true)).toBe('critical');
  });
  it('reject/escalate/deactivate/revoke actions are "high"', () => {
    expect(computeSeverity('ticket.reject', true)).toBe('high');
    expect(computeSeverity('ticket.escalate', true)).toBe('high');
    expect(computeSeverity('user.deactivate', true)).toBe('high');
    expect(computeSeverity('token.revoke', true)).toBe('high');
  });
  it('create/update/assign/approve/change actions are "medium"', () => {
    expect(computeSeverity('user.create', true)).toBe('medium');
    expect(computeSeverity('ticket.assign', true)).toBe('medium');
    expect(computeSeverity('role.change', true)).toBe('medium');
  });
  it('everything else defaults to "low"', () => {
    expect(computeSeverity('login.success', true)).toBe('low');
    expect(computeSeverity('logout', true)).toBe('low');
  });
});

describe('buildAuditFilters()', () => {
  it('returns "1=1" with no params when no filters are given', () => {
    const { where, params } = buildAuditFilters({});
    expect(where).toBe('1=1');
    expect(params).toEqual([]);
  });

  it('builds a single clause per filter, in a stable order, with sequential $n placeholders', () => {
    const { where, params } = buildAuditFilters({ userId: 5, role: 'admin', action: 'user.create' });
    expect(where).toBe('1=1 AND a.user_id = $1 AND u.role = $2 AND a.action = $3');
    expect(params).toEqual([5, 'admin', 'user.create']);
  });

  it('respects a custom startIndex (for appending after other params)', () => {
    const { where, params } = buildAuditFilters({ module: 'auth' }, 3);
    expect(where).toBe('1=1 AND a.module = $3');
    expect(params).toEqual(['auth']);
  });

  it('ticketNumber filters on target_type + target_id together in one clause', () => {
    const { where, params } = buildAuditFilters({ ticketNumber: 24 });
    expect(where).toContain(`a.target_type = 'ticket' AND a.target_id = $1`);
    expect(params).toEqual(['24']);
  });

  it('severity uses the shared SQL CASE expression as a subquery', () => {
    const { where, params } = buildAuditFilters({ severity: 'critical' });
    expect(where).toContain('CASE');
    expect(where).toContain(") = $1");
    expect(params).toEqual(['critical']);
  });

  it('success:"success" / "failure" map to boolean equality with no param', () => {
    expect(buildAuditFilters({ success: 'success' }).where).toContain('a.success = TRUE');
    expect(buildAuditFilters({ success: 'failure' }).where).toContain('a.success = FALSE');
    expect(buildAuditFilters({ success: 'success' }).params).toEqual([]);
  });

  it('user free-text filter matches name/email/actor_email with one shared param (ILIKE)', () => {
    const { where, params } = buildAuditFilters({ user: 'ron' });
    expect(where).toContain('u.name ILIKE $1');
    expect(where).toContain('u.email ILIKE $1');
    expect(where).toContain('a.actor_email ILIKE $1');
    expect(params).toEqual(['%ron%']);
  });

  it('ipAddress and device use ILIKE with wildcards', () => {
    const { where, params } = buildAuditFilters({ ipAddress: '10.0.0', device: 'Chrome' });
    expect(params).toEqual(['%10.0.0%', '%Chrome%']);
  });
});

describe('export formatters', () => {
  const rows = [
    {
      id: 1, created_at: new Date('2026-07-01T02:00:00Z'), user_id: 7, user_name: 'Jane Smith',
      actor_email: 'jane@yahwehcare.com.au', role: 'admin', action: 'user.deactivate', module: 'users',
      target_type: 'user', target_id: '13', metadata: { status: 'inactive' }, ip_address: '10.0.0.5',
      user_agent: 'Mozilla/5.0', success: true,
    },
    {
      id: 2, created_at: new Date('2026-07-02T03:00:00Z'), user_id: null, user_name: null,
      actor_email: 'unknown@x.com', role: null, action: 'login.failed', module: 'auth',
      target_type: null, target_id: null, metadata: {}, ip_address: null, user_agent: null, success: false,
    },
  ];

  it('buildCsv() includes a header row and quotes every field', () => {
    const csv = buildCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('"id"');
    expect(lines[0]).toContain('"severity"');
    expect(lines[0]).toContain('"status"');
    expect(lines[1]).toContain('"1"');
    expect(lines[1]).toContain('"Jane Smith"');
    // severity for a "deactivate" action with success=true is "high"
    expect(lines[1]).toContain('"high"');
    // status falls back to metadata->>'status' when present
    expect(lines[1]).toContain('"inactive"');
    // second row: no metadata.status, success=false → status falls back to "failure"
    expect(lines[2]).toContain('"failure"');
    // second row: success=false → severity is "high" regardless of action
    expect(lines[2]).toContain('login.failed');
  });

  it('buildJson() produces valid, parseable JSON with computed severity/status fields', () => {
    const json = buildJson(rows);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].severity).toBe('high');
    expect(parsed[0].status).toBe('inactive');
    expect(parsed[1].status).toBe('failure');
    expect(parsed[1].user_id).toBeNull();
  });

  it('buildTxt() produces one human-readable line per row', () => {
    const txt = buildTxt(rows);
    const lines = txt.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Jane Smith');
    expect(lines[0]).toContain('user.deactivate');
    expect(lines[0]).toContain('SUCCESS');
    expect(lines[1]).toContain('FAILURE');
    expect(lines[1]).toContain('unknown@x.com');
  });

  it('buildExport() dispatches to the right formatter by format string', () => {
    expect(buildExport(rows, 'csv')).toBe(buildCsv(rows));
    expect(buildExport(rows, 'json')).toBe(buildJson(rows));
    expect(buildExport(rows, 'txt')).toBe(buildTxt(rows));
  });

  it('contentTypeFor() maps each format to the right MIME type', () => {
    expect(contentTypeFor('csv')).toBe('text/csv');
    expect(contentTypeFor('json')).toBe('application/json');
    expect(contentTypeFor('txt')).toBe('text/plain');
  });
});
