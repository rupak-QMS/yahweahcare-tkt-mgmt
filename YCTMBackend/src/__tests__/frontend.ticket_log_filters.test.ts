// ============================================================
// Tests for Ticket Log page filter feature
// (frontend/index.html — TicketLogPage)
//
// Covers:
//   1. Code-integrity checks  — filter state, UI elements, clear button
//   2. matchSearch             — title, ticketNumber, requesterName, assigneeName
//   3. matchStatus             — normalisation, empty = all
//   4. matchPriority           — by id (String coercion), by label, empty = all
//   5. matchAssignee           — exact name, empty = all
//   6. matchFrom / matchTo     — date range lower and upper bounds
//   7. Combined filters        — multiple active at once
//   8. hasActiveFilters        — truthy/falsy detection
//   9. clearFilters            — resets all to empty
//  10. uniquePriorities        — deduplication from ticket list
//  11. uniqueAssignees         — deduplication + alphabetical sort
//
// NOTE: the Ticket Log category filter was intentionally removed on
// 2026-06-12 (commit d9c158d — "was showing Care Coordination" bug) and
// is NOT part of the current, stable feature set. No tests for it here.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

const HTML_PATH = path.resolve(__dirname, '../../../YCTMFrontend/src/app-source.jsx');
const html = fs.readFileSync(HTML_PATH, 'utf-8');

// ── 1. Code-integrity checks ──────────────────────────────────────────────────

describe('index.html — Ticket Log filters (code integrity)', () => {
  // State declarations
  it('priorityFilter state is declared', () => {
    expect(html).toContain('priorityFilter');
    expect(html).toContain('setPriorityFilter');
  });

  it('assigneeFilter state is declared', () => {
    expect(html).toContain('assigneeFilter');
    expect(html).toContain('setAssigneeFilter');
  });

  it('dateFrom state is declared', () => {
    expect(html).toContain('dateFrom');
    expect(html).toContain('setDateFrom');
  });

  it('dateTo state is declared', () => {
    expect(html).toContain('dateTo');
    expect(html).toContain('setDateTo');
  });

  // Derived options memos
  it('uniquePriorities is computed via useMemo', () => {
    expect(html).toContain('uniquePriorities');
  });

  it('uniqueAssignees is computed via useMemo', () => {
    expect(html).toContain('uniqueAssignees');
  });

  // Filter logic in the filtered array
  it('matchPriority clause is present in filtered computation', () => {
    expect(html).toContain('matchPriority');
  });

  it('matchAssignee clause is present in filtered computation', () => {
    expect(html).toContain('matchAssignee');
  });

  it('matchFrom clause is present for date range lower bound', () => {
    expect(html).toContain('matchFrom');
  });

  it('matchTo clause is present for date range upper bound', () => {
    expect(html).toContain('matchTo');
  });

  // UI elements
  it('"All Priorities" option exists in priority dropdown', () => {
    expect(html).toContain('All Priorities');
  });

  it('"All Assignees" option exists in assignee dropdown', () => {
    expect(html).toContain('All Assignees');
  });

  it('date inputs are type="date"', () => {
    // There should be at least 2 date inputs (From and To)
    const dateInputCount = (html.match(/type="date"/g) || []).length;
    expect(dateInputCount).toBeGreaterThanOrEqual(2);
  });

  it('result count badge shows filtered.length', () => {
    expect(html).toContain('filtered.length');
  });

  it('hasActiveFilters is defined', () => {
    expect(html).toContain('hasActiveFilters');
  });

  it('"Clear all" button is rendered when hasActiveFilters is truthy', () => {
    expect(html).toContain('Clear all');
    expect(html).toContain('clearFilters');
  });

  it('active filter controls get blue border (#6366F1)', () => {
    // At least priority and assignee inputs should have this pattern
    expect(html).toContain("priorityFilter?'#6366F1'");
    expect(html).toContain("assigneeFilter?'#6366F1'");
  });

  it('date-range label "From" exists in UI', () => {
    expect(html).toMatch(/From.*date.*input|input.*date.*From/si);
  });

  it('date-range label "To" exists in UI', () => {
    // Label rendered as JSX text node: >To</label>
    expect(html).toContain('>To</label>');
  });

  it('result count shows "matched" text when filters are active', () => {
    expect(html).toContain('hasActiveFilters ? \' matched\' : \'\'');
  });
});

// ── Shared types and helpers ───────────────────────────────────────────────────

interface LogTicket {
  title?: string;
  ticketNumber?: string;
  requesterName?: string;
  assigneeName?: string;
  status?: string;
  priority?: number | string | null;
  priorityLabel?: string | null;
  category?: number | string | null;
  categoryLabel?: string | null;
  createdAt?: string | null;
}

// Mirror the filter logic exactly as written in TicketLogPage
function applyFilters(
  tickets: LogTicket[],
  { search = '', statusFilter = '', priorityFilter = '', assigneeFilter = '', dateFrom = '', dateTo = '' }
): LogTicket[] {
  return tickets.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || (t.title||'').toLowerCase().includes(q)
      || (t.ticketNumber||'').toLowerCase().includes(q)
      || (t.requesterName||'').toLowerCase().includes(q)
      || (t.assigneeName||'').toLowerCase().includes(q);
    const matchStatus = !statusFilter
      || (t.status||'').toLowerCase().replace(/ /g,'_') === statusFilter.toLowerCase().replace(/ /g,'_');
    const matchPriority = !priorityFilter
      || String(t.priority||'') === String(priorityFilter)
      || (t.priorityLabel||'').toLowerCase() === priorityFilter.toLowerCase();
    const matchAssignee = !assigneeFilter
      || (t.assigneeName||'') === assigneeFilter;
    const createdMs = t.createdAt ? new Date(t.createdAt).getTime() : null;
    const matchFrom = !dateFrom || (createdMs !== null && createdMs >= new Date(dateFrom).getTime());
    const matchTo   = !dateTo   || (createdMs !== null && createdMs <= new Date(dateTo + 'T23:59:59').getTime());
    return matchSearch && matchStatus && matchPriority && matchAssignee && matchFrom && matchTo;
  });
}

// Mirror uniquePriorities, uniqueAssignees derivations
function deriveUniquePriorities(tickets: LogTicket[]) {
  const seen = new Map<string, number | string>();
  tickets.forEach(t => {
    if (t.priorityLabel && !seen.has(t.priorityLabel))
      seen.set(t.priorityLabel, t.priority || t.priorityLabel);
  });
  return [...seen.entries()].map(([label, val]) => ({ label, val }));
}

function deriveUniqueAssignees(tickets: LogTicket[]): string[] {
  const seen = new Map<string, string>();
  tickets.forEach(t => {
    if (t.assigneeName && !seen.has(t.assigneeName)) seen.set(t.assigneeName, t.assigneeName);
  });
  return [...seen.keys()].sort();
}

// Mirror hasActiveFilters
function hasActiveFilters(filters: { search?: string; statusFilter?: string; priorityFilter?: string; assigneeFilter?: string; dateFrom?: string; dateTo?: string }): boolean {
  return !!(filters.search || filters.statusFilter || filters.priorityFilter || filters.assigneeFilter || filters.dateFrom || filters.dateTo);
}

// Sample tickets
const TICKETS: LogTicket[] = [
  { title: 'Fix broken printer',  ticketNumber: 'TKT-000001', requesterName: 'Alice Smith',  assigneeName: 'Bob Jones',   status: 'open',            priority: 2, priorityLabel: 'Medium',   category: 1, categoryLabel: 'IT Support',       createdAt: '2026-05-01T08:00:00.000Z' },
  { title: 'Payroll issue',       ticketNumber: 'TKT-000002', requesterName: 'Charlie Brown', assigneeName: 'Dana White',  status: 'in_progress',     priority: 3, priorityLabel: 'High',     category: 2, categoryLabel: 'HR',               createdAt: '2026-05-15T09:00:00.000Z' },
  { title: 'Access card lost',    ticketNumber: 'TKT-000003', requesterName: 'Eve Davis',     assigneeName: 'Bob Jones',   status: 'resolved',        priority: 1, priorityLabel: 'Low',      category: 3, categoryLabel: 'Facilities',       createdAt: '2026-06-01T10:00:00.000Z' },
  { title: 'Software update',     ticketNumber: 'TKT-000004', requesterName: 'Alice Smith',   assigneeName: 'Frank Ocean', status: 'closed',          priority: 4, priorityLabel: 'Critical', category: 1, categoryLabel: 'IT Support',       createdAt: '2026-06-05T11:00:00.000Z' },
  { title: 'Approval pending',    ticketNumber: 'TKT-000005', requesterName: 'Charlie Brown', assigneeName: 'Dana White',  status: 'pending_approval',priority: 2, priorityLabel: 'Medium',   category: 4, categoryLabel: 'Finance',          createdAt: '2026-06-08T12:00:00.000Z' },
];

// ── 2. matchSearch ────────────────────────────────────────────────────────────

describe('matchSearch', () => {
  it('returns all tickets when search is empty', () => {
    expect(applyFilters(TICKETS, { search: '' })).toHaveLength(5);
  });

  it('filters by title (case-insensitive)', () => {
    const r = applyFilters(TICKETS, { search: 'printer' });
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Fix broken printer');
  });

  it('filters by ticket number', () => {
    const r = applyFilters(TICKETS, { search: 'TKT-000003' });
    expect(r).toHaveLength(1);
    expect(r[0].ticketNumber).toBe('TKT-000003');
  });

  it('filters by requester name', () => {
    const r = applyFilters(TICKETS, { search: 'alice' });
    expect(r).toHaveLength(2); // 2 tickets by Alice
    r.forEach(t => expect(t.requesterName).toBe('Alice Smith'));
  });

  it('filters by assignee name', () => {
    const r = applyFilters(TICKETS, { search: 'bob jones' });
    expect(r).toHaveLength(2); // 2 tickets assigned to Bob
    r.forEach(t => expect(t.assigneeName).toBe('Bob Jones'));
  });

  it('returns empty array when no match', () => {
    expect(applyFilters(TICKETS, { search: 'xyznotexist' })).toHaveLength(0);
  });

  it('search is case-insensitive across all fields', () => {
    expect(applyFilters(TICKETS, { search: 'PAYROLL' })).toHaveLength(1);
  });
});

// ── 3. matchStatus ────────────────────────────────────────────────────────────

describe('matchStatus', () => {
  it('returns all tickets when statusFilter is empty', () => {
    expect(applyFilters(TICKETS, { statusFilter: '' })).toHaveLength(5);
  });

  it('filters by exact lowercase status', () => {
    const r = applyFilters(TICKETS, { statusFilter: 'open' });
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe('open');
  });

  it('normalises spaces to underscores — "Pending Approval" matches pending_approval', () => {
    const r = applyFilters(TICKETS, { statusFilter: 'Pending Approval' });
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe('pending_approval');
  });

  it('normalises "In Progress" to in_progress', () => {
    const r = applyFilters(TICKETS, { statusFilter: 'In Progress' });
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe('in_progress');
  });

  it('filters resolved tickets', () => {
    expect(applyFilters(TICKETS, { statusFilter: 'resolved' })).toHaveLength(1);
  });

  it('filters closed tickets', () => {
    expect(applyFilters(TICKETS, { statusFilter: 'closed' })).toHaveLength(1);
  });

  it('returns empty for a status not present in data', () => {
    expect(applyFilters(TICKETS, { statusFilter: 'new' })).toHaveLength(0);
  });
});

// ── 4. matchPriority ──────────────────────────────────────────────────────────

describe('matchPriority', () => {
  it('returns all tickets when priorityFilter is empty', () => {
    expect(applyFilters(TICKETS, { priorityFilter: '' })).toHaveLength(5);
  });

  it('filters by priority id (numeric string match)', () => {
    // priority id 3 = High
    const r = applyFilters(TICKETS, { priorityFilter: '3' });
    expect(r).toHaveLength(1);
    expect(r[0].priorityLabel).toBe('High');
  });

  it('filters by priority id 2 returns two Medium tickets', () => {
    const r = applyFilters(TICKETS, { priorityFilter: '2' });
    expect(r).toHaveLength(2);
    r.forEach(t => expect(t.priorityLabel).toBe('Medium'));
  });

  it('filters by priority label (case-insensitive fallback)', () => {
    // When priorityFilter is the label string (e.g. if priority id is null)
    const tickets = [{ ...TICKETS[0], priority: null, priorityLabel: 'Medium' }];
    const r = applyFilters(tickets, { priorityFilter: 'Medium' });
    expect(r).toHaveLength(1);
  });

  it('filters by priority label case-insensitively', () => {
    const tickets = [{ ...TICKETS[0], priority: null, priorityLabel: 'Medium' }];
    const r = applyFilters(tickets, { priorityFilter: 'medium' });
    expect(r).toHaveLength(1);
  });

  it('excludes tickets that do not match the priority filter', () => {
    const r = applyFilters(TICKETS, { priorityFilter: '4' }); // Critical
    expect(r).toHaveLength(1);
    expect(r[0].priorityLabel).toBe('Critical');
  });

  it('returns empty when priority not present in data', () => {
    expect(applyFilters(TICKETS, { priorityFilter: '99' })).toHaveLength(0);
  });
});

// ── 5. matchAssignee ──────────────────────────────────────────────────────────

describe('matchAssignee', () => {
  it('returns all tickets when assigneeFilter is empty', () => {
    expect(applyFilters(TICKETS, { assigneeFilter: '' })).toHaveLength(5);
  });

  it('filters to only tickets assigned to the selected person', () => {
    const r = applyFilters(TICKETS, { assigneeFilter: 'Bob Jones' });
    expect(r).toHaveLength(2);
    r.forEach(t => expect(t.assigneeName).toBe('Bob Jones'));
  });

  it('assignee match is exact (case-sensitive)', () => {
    // 'bob jones' should NOT match 'Bob Jones'
    expect(applyFilters(TICKETS, { assigneeFilter: 'bob jones' })).toHaveLength(0);
  });

  it('returns empty when assignee not in data', () => {
    expect(applyFilters(TICKETS, { assigneeFilter: 'Nobody Here' })).toHaveLength(0);
  });

  it('ticket with null assigneeName is excluded when filter is active', () => {
    const tickets = [{ ...TICKETS[0], assigneeName: undefined }];
    expect(applyFilters(tickets, { assigneeFilter: 'Bob Jones' })).toHaveLength(0);
  });
});

// ── 6. matchFrom / matchTo ────────────────────────────────────────────────────

describe('matchFrom (date range lower bound)', () => {
  it('returns all tickets when dateFrom is empty', () => {
    expect(applyFilters(TICKETS, { dateFrom: '' })).toHaveLength(5);
  });

  it('excludes tickets created before the from date', () => {
    // All tickets created from 2026-06-01 onwards
    const r = applyFilters(TICKETS, { dateFrom: '2026-06-01' });
    expect(r).toHaveLength(3); // TKT-3, TKT-4, TKT-5
  });

  it('includes tickets created exactly on the from date', () => {
    const r = applyFilters(TICKETS, { dateFrom: '2026-06-08' });
    expect(r).toHaveLength(1);
    expect(r[0].ticketNumber).toBe('TKT-000005');
  });

  it('returns empty when from date is in the future', () => {
    expect(applyFilters(TICKETS, { dateFrom: '2030-01-01' })).toHaveLength(0);
  });

  it('excludes tickets with null createdAt when dateFrom is set', () => {
    const tickets = [{ ...TICKETS[0], createdAt: null }];
    expect(applyFilters(tickets, { dateFrom: '2026-01-01' })).toHaveLength(0);
  });
});

describe('matchTo (date range upper bound)', () => {
  it('returns all tickets when dateTo is empty', () => {
    expect(applyFilters(TICKETS, { dateTo: '' })).toHaveLength(5);
  });

  it('excludes tickets created after the to date', () => {
    // Only tickets up to 2026-05-31
    const r = applyFilters(TICKETS, { dateTo: '2026-05-31' });
    expect(r).toHaveLength(2); // TKT-1, TKT-2
  });

  it('includes tickets created on the to date itself', () => {
    // dateTo='2026-06-05' → includes tickets up to 2026-06-05T23:59:59
    const r = applyFilters(TICKETS, { dateTo: '2026-06-05' });
    expect(r).toHaveLength(4); // TKT-1,2,3,4
  });

  it('returns empty when to date is in the past', () => {
    expect(applyFilters(TICKETS, { dateTo: '2020-01-01' })).toHaveLength(0);
  });

  it('excludes tickets with null createdAt when dateTo is set', () => {
    const tickets = [{ ...TICKETS[0], createdAt: null }];
    expect(applyFilters(tickets, { dateTo: '2026-12-31' })).toHaveLength(0);
  });
});

describe('matchFrom + matchTo combined (date range)', () => {
  it('returns tickets within the date window', () => {
    const r = applyFilters(TICKETS, { dateFrom: '2026-05-15', dateTo: '2026-06-05' });
    // TKT-2 (May 15), TKT-3 (Jun 1), TKT-4 (Jun 5)
    expect(r).toHaveLength(3);
  });

  it('returns empty when from > to', () => {
    const r = applyFilters(TICKETS, { dateFrom: '2026-07-01', dateTo: '2026-06-01' });
    expect(r).toHaveLength(0);
  });

  it('returns single ticket matching exact date range', () => {
    const r = applyFilters(TICKETS, { dateFrom: '2026-06-08', dateTo: '2026-06-08' });
    expect(r).toHaveLength(1);
    expect(r[0].ticketNumber).toBe('TKT-000005');
  });
});

// ── 7. Combined filters ───────────────────────────────────────────────────────

describe('combined filters', () => {
  it('search + status together narrow results', () => {
    // Alice + in_progress → 0 (Alice has open and closed, not in_progress)
    const r = applyFilters(TICKETS, { search: 'alice', statusFilter: 'in_progress' });
    expect(r).toHaveLength(0);
  });

  it('status + priority together narrow results', () => {
    // open + Medium priority → 1 ticket (TKT-1)
    const r = applyFilters(TICKETS, { statusFilter: 'open', priorityFilter: '2' });
    expect(r).toHaveLength(1);
    expect(r[0].ticketNumber).toBe('TKT-000001');
  });

  it('priority + assignee together narrow results', () => {
    // Medium priority (2) + Bob Jones → 1 ticket (TKT-1)
    const r = applyFilters(TICKETS, { priorityFilter: '2', assigneeFilter: 'Bob Jones' });
    expect(r).toHaveLength(1);
    expect(r[0].ticketNumber).toBe('TKT-000001');
  });

  it('all four filters active simultaneously', () => {
    const r = applyFilters(TICKETS, {
      search: 'printer',
      statusFilter: 'open',
      priorityFilter: '2',
      assigneeFilter: 'Bob Jones',
    });
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Fix broken printer');
  });

  it('conflicting filters return empty', () => {
    // open status but in June (only 1 open ticket created May 1)
    const r = applyFilters(TICKETS, { statusFilter: 'open', dateFrom: '2026-06-01' });
    expect(r).toHaveLength(0);
  });
});

// ── 8. hasActiveFilters ───────────────────────────────────────────────────────

describe('hasActiveFilters', () => {
  it('is false when all filters are empty strings', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ search: '', statusFilter: '', priorityFilter: '', assigneeFilter: '', dateFrom: '', dateTo: '' })).toBe(false);
  });

  it('is true when search is non-empty', () => {
    expect(hasActiveFilters({ search: 'printer' })).toBe(true);
  });

  it('is true when statusFilter is set', () => {
    expect(hasActiveFilters({ statusFilter: 'open' })).toBe(true);
  });

  it('is true when priorityFilter is set', () => {
    expect(hasActiveFilters({ priorityFilter: '2' })).toBe(true);
  });

  it('is true when assigneeFilter is set', () => {
    expect(hasActiveFilters({ assigneeFilter: 'Bob Jones' })).toBe(true);
  });

  it('is true when dateFrom is set', () => {
    expect(hasActiveFilters({ dateFrom: '2026-05-01' })).toBe(true);
  });

  it('is true when dateTo is set', () => {
    expect(hasActiveFilters({ dateTo: '2026-06-30' })).toBe(true);
  });

  it('is true when any single filter is set among all empty', () => {
    expect(hasActiveFilters({ search: '', statusFilter: 'open', priorityFilter: '', assigneeFilter: '', dateFrom: '', dateTo: '' })).toBe(true);
  });
});

// ── 9. clearFilters ─────────────────────────────────────────────────────────

describe('clearFilters effect', () => {
  it('after clear, no filters are active', () => {
    // Simulate clear by resetting all to ''
    const cleared = { search: '', statusFilter: '', priorityFilter: '', assigneeFilter: '', dateFrom: '', dateTo: '' };
    expect(hasActiveFilters(cleared)).toBe(false);
  });

  it('after clear, all tickets are returned', () => {
    const cleared = { search: '', statusFilter: '', priorityFilter: '', assigneeFilter: '', dateFrom: '', dateTo: '' };
    expect(applyFilters(TICKETS, cleared)).toHaveLength(5);
  });
});

// ── 10. uniquePriorities ──────────────────────────────────────────────────────

describe('uniquePriorities derivation', () => {
  it('returns one entry per unique priority label', () => {
    const opts = deriveUniquePriorities(TICKETS);
    // TICKETS has: Medium, High, Low, Critical, Medium → 4 unique
    expect(opts).toHaveLength(4);
  });

  it('each entry has label and val properties', () => {
    const opts = deriveUniquePriorities(TICKETS);
    opts.forEach(o => {
      expect(o).toHaveProperty('label');
      expect(o).toHaveProperty('val');
    });
  });

  it('val is the priority id when present', () => {
    const opts = deriveUniquePriorities(TICKETS);
    const medium = opts.find(o => o.label === 'Medium');
    expect(medium?.val).toBe(2); // priority id
  });

  it('val falls back to label when priority id is null', () => {
    const tickets: LogTicket[] = [{ priority: null, priorityLabel: 'Custom' }];
    const opts = deriveUniquePriorities(tickets);
    expect(opts[0].val).toBe('Custom');
  });

  it('deduplicates — same label appears only once', () => {
    // Two Medium tickets in TICKETS
    const mediums = deriveUniquePriorities(TICKETS).filter(o => o.label === 'Medium');
    expect(mediums).toHaveLength(1);
  });

  it('returns empty array for empty ticket list', () => {
    expect(deriveUniquePriorities([])).toHaveLength(0);
  });

  it('ignores tickets with null/undefined priorityLabel', () => {
    const tickets: LogTicket[] = [{ priority: 1, priorityLabel: null }];
    expect(deriveUniquePriorities(tickets)).toHaveLength(0);
  });
});

// ── 11. uniqueAssignees ───────────────────────────────────────────────────────

describe('uniqueAssignees derivation', () => {
  it('returns sorted unique assignee names', () => {
    const names = deriveUniqueAssignees(TICKETS);
    // Bob Jones, Dana White, Frank Ocean → 3 unique
    expect(names).toHaveLength(3);
    expect(names).toEqual([...names].sort()); // must be sorted
  });

  it('is alphabetically sorted', () => {
    const names = deriveUniqueAssignees(TICKETS);
    expect(names[0]).toBe('Bob Jones');
    expect(names[1]).toBe('Dana White');
    expect(names[2]).toBe('Frank Ocean');
  });

  it('deduplicates — Bob Jones appears once despite two tickets', () => {
    const bobs = deriveUniqueAssignees(TICKETS).filter(n => n === 'Bob Jones');
    expect(bobs).toHaveLength(1);
  });

  it('excludes tickets with falsy assigneeName', () => {
    const tickets: LogTicket[] = [
      { assigneeName: 'Alice' },
      { assigneeName: '' },
      { assigneeName: undefined },
    ];
    expect(deriveUniqueAssignees(tickets)).toEqual(['Alice']);
  });

  it('returns empty for empty ticket list', () => {
    expect(deriveUniqueAssignees([])).toHaveLength(0);
  });
});
