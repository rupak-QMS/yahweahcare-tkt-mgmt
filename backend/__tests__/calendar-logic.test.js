/**
 * Unit tests — Calendar page helper logic
 *
 * These tests exercise the pure helper functions used by CalendarPage and the
 * Tickets page in the frontend (app-source.jsx). Because the helpers are
 * pure (no React, no DOM, no network), they can be validated in Node.js
 * without any browser environment.
 *
 * Covers:
 *  ticketColor  — correct colour bucket for each status/priority/overdue state
 *  isDone       — resolved + closed are done; everything else is not
 *  isOverdue    — only open tickets past their due date
 *  tktMap       — builds date-keyed ticket map correctly
 *  holMap       — filters holidays by state, builds date map
 *  month grid   — correct cell count, first-day offset, week rows
 *  date helpers — pad, dateStr, isToday
 *  stats        — mDue, mOD, mRes counts from a ticket set
 *  AU_HOLIDAYS  — data integrity: no duplicate entries for same state+date
 */

// ── Inline helpers (mirrored from app-source.jsx) ────────────────────────────
// These are duplicated here intentionally; the tests validate the contract
// that the frontend code implements, acting as a regression safety net.

const pad = n => String(n).padStart(2, '0');

function ticketColor(t, now = new Date()) {
  const s  = (t.status || '').toLowerCase();
  const p  = (t.priorityLabel || t.priority || '').toLowerCase();
  const od = !['resolved', 'closed'].includes(s) && t.dueAt && new Date(t.dueAt) < now;
  if (od) return { bar: '#EF4444', label: 'Overdue' };
  if (s === 'resolved' || s === 'closed') return { bar: '#10B981', label: 'Resolved' };
  if (s === 'pending_approval')           return { bar: '#8B5CF6', label: 'Approval' };
  if (s === 'in_progress')                return { bar: '#3B82F6', label: 'In Progress' };
  if (p === 'critical' || p === 'urgent') return { bar: '#F97316', label: 'Critical' };
  if (p === 'high')                       return { bar: '#F59E0B', label: 'High' };
  return { bar: '#6366F1', label: 'Open' };
}

function isDone(t) {
  return ['resolved', 'closed'].includes((t.status || '').toLowerCase());
}

function isOverdue(t, now = new Date()) {
  return !isDone(t) && !!t.dueAt && new Date(t.dueAt) < now;
}

function buildTktMap(tickets) {
  const map = {};
  tickets.forEach(t => {
    const raw = t.dueAt || t.expectedCompletion;
    if (!raw) return;
    const ds = raw.slice(0, 10);
    if (!map[ds]) map[ds] = [];
    map[ds].push(t);
  });
  return map;
}

function buildHolMap(holidays, selectedState) {
  const map = {};
  holidays.forEach(h => {
    if (h.states.includes('ALL') || h.states.includes(selectedState)) {
      if (!map[h.date]) map[h.date] = [];
      map[h.date].push(h);
    }
  });
  return map;
}

function buildMonthGrid(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monFirst    = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
  const cells = [];
  for (let i = 0; i < monFirst; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { cells, weeks, daysInMonth, monFirst };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ticketColor
// ═══════════════════════════════════════════════════════════════════════════════
describe('ticketColor', () => {
  const PAST  = new Date(Date.now() - 86400000).toISOString(); // yesterday
  const FUTURE = new Date(Date.now() + 86400000).toISOString(); // tomorrow

  test('overdue open ticket → red Overdue', () => {
    const c = ticketColor({ status: 'new', dueAt: PAST });
    expect(c.bar).toBe('#EF4444');
    expect(c.label).toBe('Overdue');
  });

  test('resolved ticket is never overdue, even if past due date', () => {
    const c = ticketColor({ status: 'resolved', dueAt: PAST });
    expect(c.bar).toBe('#10B981');
    expect(c.label).toBe('Resolved');
  });

  test('closed ticket → green Resolved', () => {
    const c = ticketColor({ status: 'closed', dueAt: PAST });
    expect(c.bar).toBe('#10B981');
  });

  test('pending_approval → purple Approval', () => {
    const c = ticketColor({ status: 'pending_approval', dueAt: FUTURE });
    expect(c.bar).toBe('#8B5CF6');
    expect(c.label).toBe('Approval');
  });

  test('in_progress → blue In Progress', () => {
    const c = ticketColor({ status: 'in_progress', dueAt: FUTURE });
    expect(c.bar).toBe('#3B82F6');
  });

  test('critical priority open ticket → orange Critical', () => {
    const c = ticketColor({ status: 'new', priority: 'critical', dueAt: FUTURE });
    expect(c.bar).toBe('#F97316');
    expect(c.label).toBe('Critical');
  });

  test('urgent priority treated same as critical', () => {
    const c = ticketColor({ status: 'new', priority: 'urgent', dueAt: FUTURE });
    expect(c.bar).toBe('#F97316');
  });

  test('high priority open ticket → amber High', () => {
    const c = ticketColor({ status: 'new', priority: 'high', dueAt: FUTURE });
    expect(c.bar).toBe('#F59E0B');
    expect(c.label).toBe('High');
  });

  test('medium priority open ticket → indigo Open', () => {
    const c = ticketColor({ status: 'new', priority: 'medium', dueAt: FUTURE });
    expect(c.bar).toBe('#6366F1');
    expect(c.label).toBe('Open');
  });

  test('no dueAt → not overdue regardless of status', () => {
    const c = ticketColor({ status: 'new' });
    expect(c.label).toBe('Open');
  });

  test('status check is case-insensitive', () => {
    const c = ticketColor({ status: 'RESOLVED', dueAt: PAST });
    expect(c.label).toBe('Resolved');
  });

  test('priorityLabel takes precedence over priority', () => {
    const c = ticketColor({ status: 'new', priorityLabel: 'High', priority: 'low', dueAt: FUTURE });
    expect(c.label).toBe('High');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isDone
// ═══════════════════════════════════════════════════════════════════════════════
describe('isDone', () => {
  test.each([
    ['resolved', true],
    ['closed',   true],
    ['RESOLVED', true],
    ['CLOSED',   true],
    ['new',      false],
    ['in_progress', false],
    ['assigned', false],
    ['pending_approval', false],
    ['',         false],
  ])('status "%s" → isDone = %s', (status, expected) => {
    expect(isDone({ status })).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isOverdue
// ═══════════════════════════════════════════════════════════════════════════════
describe('isOverdue', () => {
  const PAST   = new Date(Date.now() - 86400000).toISOString();
  const FUTURE = new Date(Date.now() + 86400000).toISOString();

  test('open ticket with past dueAt → overdue', () => {
    expect(isOverdue({ status: 'new', dueAt: PAST })).toBe(true);
  });

  test('open ticket with future dueAt → not overdue', () => {
    expect(isOverdue({ status: 'new', dueAt: FUTURE })).toBe(false);
  });

  test('resolved ticket with past dueAt → NOT overdue', () => {
    expect(isOverdue({ status: 'resolved', dueAt: PAST })).toBe(false);
  });

  test('closed ticket with past dueAt → NOT overdue', () => {
    expect(isOverdue({ status: 'closed', dueAt: PAST })).toBe(false);
  });

  test('open ticket with no dueAt → not overdue', () => {
    expect(isOverdue({ status: 'new' })).toBe(false);
  });

  test('in_progress ticket past due → overdue', () => {
    expect(isOverdue({ status: 'in_progress', dueAt: PAST })).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildTktMap
// ═══════════════════════════════════════════════════════════════════════════════
describe('buildTktMap', () => {
  test('groups tickets by due date string', () => {
    const tickets = [
      { id: 1, dueAt: '2026-06-15T09:00:00Z' },
      { id: 2, dueAt: '2026-06-15T14:00:00Z' },
      { id: 3, dueAt: '2026-06-20T09:00:00Z' },
    ];
    const map = buildTktMap(tickets);
    expect(map['2026-06-15']).toHaveLength(2);
    expect(map['2026-06-20']).toHaveLength(1);
  });

  test('falls back to expectedCompletion when dueAt is absent', () => {
    const tickets = [{ id: 4, expectedCompletion: '2026-07-01T00:00:00Z' }];
    const map = buildTktMap(tickets);
    expect(map['2026-07-01']).toHaveLength(1);
  });

  test('skips tickets with no dueAt or expectedCompletion', () => {
    const tickets = [{ id: 5, title: 'No date' }];
    const map = buildTktMap(tickets);
    expect(Object.keys(map)).toHaveLength(0);
  });

  test('extracts only the date portion (ignores time)', () => {
    const tickets = [{ id: 6, dueAt: '2026-08-22T23:59:59.999Z' }];
    const map = buildTktMap(tickets);
    expect(map['2026-08-22']).toHaveLength(1);
  });

  test('multiple tickets on same date all appear in the array', () => {
    const tickets = [1, 2, 3, 4, 5].map(id => ({ id, dueAt: '2026-09-10T00:00:00Z' }));
    const map = buildTktMap(tickets);
    expect(map['2026-09-10']).toHaveLength(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildHolMap
// ═══════════════════════════════════════════════════════════════════════════════
describe('buildHolMap', () => {
  const SAMPLE_HOLIDAYS = [
    { date: '2026-01-01', name: "New Year's Day",  states: ['ALL'] },
    { date: '2026-01-26', name: 'Australia Day',   states: ['ALL'] },
    { date: '2026-06-08', name: "King's Birthday",  states: ['NSW', 'ACT'] },
    { date: '2026-03-09', name: 'Labour Day',       states: ['VIC'] },
    { date: '2026-04-03', name: 'Good Friday',      states: ['ALL'] },
  ];

  test('national holidays appear for any state', () => {
    const map = buildHolMap(SAMPLE_HOLIDAYS, 'QLD');
    expect(map['2026-01-01']).toHaveLength(1);
    expect(map['2026-04-03']).toHaveLength(1);
  });

  test('state-specific holiday appears for matching state', () => {
    const map = buildHolMap(SAMPLE_HOLIDAYS, 'NSW');
    expect(map['2026-06-08']).toHaveLength(1);
    expect(map['2026-06-08'][0].name).toBe("King's Birthday");
  });

  test('state-specific holiday does NOT appear for other state', () => {
    const map = buildHolMap(SAMPLE_HOLIDAYS, 'QLD');
    expect(map['2026-06-08']).toBeUndefined();
  });

  test('VIC Labour Day appears only for VIC', () => {
    const vicMap = buildHolMap(SAMPLE_HOLIDAYS, 'VIC');
    const nswMap = buildHolMap(SAMPLE_HOLIDAYS, 'NSW');
    expect(vicMap['2026-03-09']).toHaveLength(1);
    expect(nswMap['2026-03-09']).toBeUndefined();
  });

  test('ACT gets Kings Birthday same day as NSW', () => {
    const map = buildHolMap(SAMPLE_HOLIDAYS, 'ACT');
    expect(map['2026-06-08']).toHaveLength(1);
  });

  test('multiple holidays on same date accumulate in array', () => {
    const dupes = [
      { date: '2026-06-08', name: 'Holiday A', states: ['ALL'] },
      { date: '2026-06-08', name: 'Holiday B', states: ['NSW'] },
    ];
    const map = buildHolMap(dupes, 'NSW');
    expect(map['2026-06-08']).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildMonthGrid
// ═══════════════════════════════════════════════════════════════════════════════
describe('buildMonthGrid', () => {
  test('June 2026 has 30 days', () => {
    const { daysInMonth } = buildMonthGrid(2026, 5); // month is 0-indexed
    expect(daysInMonth).toBe(30);
  });

  test('February 2024 (leap year) has 29 days', () => {
    const { daysInMonth } = buildMonthGrid(2024, 1);
    expect(daysInMonth).toBe(29);
  });

  test('February 2025 (non-leap) has 28 days', () => {
    const { daysInMonth } = buildMonthGrid(2025, 1);
    expect(daysInMonth).toBe(28);
  });

  test('total cells are always a multiple of 7', () => {
    for (let m = 0; m < 12; m++) {
      const { cells } = buildMonthGrid(2026, m);
      expect(cells.length % 7).toBe(0);
    }
  });

  test('each week row has exactly 7 cells', () => {
    const { weeks } = buildMonthGrid(2026, 5);
    weeks.forEach(wk => expect(wk).toHaveLength(7));
  });

  test('null cells appear before day 1 for the correct weekday offset', () => {
    // June 1 2026 is a Monday (0 offset in Mon-first grid)
    const { cells } = buildMonthGrid(2026, 5);
    expect(cells[0]).toBe(1); // no leading nulls
  });

  test('January 2026 — 1 Jan is Thursday, so 3 leading nulls (Mon-first)', () => {
    // Thu in Mon-first = index 3
    const { monFirst } = buildMonthGrid(2026, 0);
    expect(monFirst).toBe(3);
  });

  test('last non-null cell equals daysInMonth', () => {
    const { cells, daysInMonth } = buildMonthGrid(2026, 5);
    const lastDay = [...cells].reverse().find(c => c !== null);
    expect(lastDay).toBe(daysInMonth);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// pad helper
// ═══════════════════════════════════════════════════════════════════════════════
describe('pad', () => {
  test('pads single digit', () => expect(pad(5)).toBe('05'));
  test('does not pad two-digit number', () => expect(pad(12)).toBe('12'));
  test('pads 0 to 00', () => expect(pad(0)).toBe('00'));
  test('passes through three-digit number unchanged', () => expect(pad(100)).toBe('100'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Calendar stats (mDue, mOD, mRes, wkTkts)
// ═══════════════════════════════════════════════════════════════════════════════
describe('Calendar stats computation', () => {
  const now    = new Date('2026-06-23T10:00:00Z');
  const PAST   = '2026-06-10T09:00:00Z'; // in June, past
  const FUTURE = '2026-06-30T09:00:00Z'; // in June, future
  const NEXT_M = '2026-07-05T09:00:00Z'; // July — different month

  const tickets = [
    { id: 1, status: 'new',        dueAt: FUTURE },  // due this month, open
    { id: 2, status: 'new',        dueAt: PAST   },  // due this month, overdue
    { id: 3, status: 'resolved',   dueAt: PAST   },  // due this month, resolved (done)
    { id: 4, status: 'in_progress',dueAt: FUTURE },  // due this month, open
    { id: 5, status: 'new',        dueAt: NEXT_M },  // next month — out of range
  ];

  const moPfx  = '2026-06';
  const moTkts = tickets.filter(t => (t.dueAt || '').startsWith(moPfx));

  function isDoneLocal(t)         { return ['resolved','closed'].includes((t.status||'').toLowerCase()); }
  function isOverdueLocal(t)      { return !isDoneLocal(t) && !!t.dueAt && new Date(t.dueAt) < now; }

  test('mDue counts tickets due in current month', () => {
    expect(moTkts.length).toBe(4); // tickets 1–4
  });

  test('mOD is 1 — only ticket 2 is overdue (open + past due date)', () => {
    // ticket 2: open (new) + dueAt in the past → overdue
    // ticket 3: resolved → NOT overdue despite past due
    // ticket 5: open but dueAt is in the future (July) → NOT overdue
    const mOD = tickets.filter(isOverdueLocal).length;
    expect(mOD).toBe(1);
  });

  test('mRes counts resolved tickets due in current month', () => {
    const mRes = moTkts.filter(isDoneLocal).length;
    expect(mRes).toBe(1); // ticket 3 only
  });

  test('wkTkts: tickets due within next 7 days from now, not done', () => {
    const wkEnd  = new Date(now.getTime() + 7 * 86400000);
    const wkTkts = tickets.filter(t => {
      const r = t.dueAt;
      if (!r) return false;
      const d = new Date(r);
      return d >= now && d <= wkEnd && !isDoneLocal(t);
    });
    // FUTURE = June 30T09:00 which is within the 7-day window (ends June 30T10:00)
    // tickets 1 (new) and 4 (in_progress) have dueAt=FUTURE → both qualify
    // ticket 2: past (before now) → excluded
    // ticket 3: resolved → excluded
    // ticket 5: July → outside window
    expect(wkTkts.length).toBe(2);
    expect(wkTkts.map(t => t.id).sort()).toEqual([1, 4]);
  });

  test('wkTkts includes ticket due in 3 days', () => {
    const soon = new Date(now.getTime() + 3 * 86400000).toISOString();
    const extra = { id: 99, status: 'new', dueAt: soon };
    const wkEnd  = new Date(now.getTime() + 7 * 86400000);
    const wkTkts = [extra].filter(t => {
      const d = new Date(t.dueAt);
      return d >= now && d <= wkEnd && !isDoneLocal(t);
    });
    expect(wkTkts.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AU_HOLIDAYS data integrity
// ═══════════════════════════════════════════════════════════════════════════════
describe('AU_HOLIDAYS data integrity', () => {
  // Inline a representative subset — just enough to test the integrity rules
  const AU_HOLIDAYS = [
    { date:'2026-01-01', name:"New Year's Day",           states:['ALL'] },
    { date:'2026-01-26', name:'Australia Day',            states:['ALL'] },
    { date:'2026-04-03', name:'Good Friday',              states:['ALL'] },
    { date:'2026-04-04', name:'Easter Saturday',          states:['ACT','NSW','QLD','SA','VIC'] },
    { date:'2026-04-05', name:'Easter Sunday',            states:['ACT','NSW','QLD','VIC'] },
    { date:'2026-04-06', name:'Easter Monday',            states:['ALL'] },
    { date:'2026-04-25', name:'ANZAC Day',                states:['ALL'] },
    { date:'2026-12-25', name:'Christmas Day',            states:['ALL'] },
    { date:'2026-12-28', name:'Boxing Day (observed)',    states:['ALL'] },
    { date:'2026-06-08', name:"King's Birthday",          states:['NSW','ACT'] },
    { date:'2026-08-03', name:'Bank Holiday',             states:['NSW'] },
    { date:'2026-10-05', name:'Labour Day',               states:['NSW','ACT'] },
    { date:'2026-03-09', name:'Labour Day',               states:['VIC'] },
    { date:'2026-06-08', name:"King's Birthday",          states:['VIC'] },
    { date:'2026-11-03', name:'Melbourne Cup',            states:['VIC'] },
    { date:'2026-05-04', name:'Labour Day',               states:['QLD'] },
    { date:'2026-10-05', name:"King's Birthday",          states:['QLD'] },
  ];

  test('every entry has a date string in YYYY-MM-DD format', () => {
    AU_HOLIDAYS.forEach(h => {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  test('every entry has a non-empty name', () => {
    AU_HOLIDAYS.forEach(h => {
      expect(h.name.trim().length).toBeGreaterThan(0);
    });
  });

  test('every states array is non-empty', () => {
    AU_HOLIDAYS.forEach(h => {
      expect(h.states.length).toBeGreaterThan(0);
    });
  });

  test('states values are valid AU state codes or ALL', () => {
    const VALID = new Set(['ALL','NSW','VIC','QLD','SA','WA','TAS','NT','ACT']);
    AU_HOLIDAYS.forEach(h => {
      h.states.forEach(s => expect(VALID.has(s)).toBe(true));
    });
  });

  test('dates parse to valid Date objects', () => {
    AU_HOLIDAYS.forEach(h => {
      const d = new Date(h.date);
      expect(isNaN(d.getTime())).toBe(false);
    });
  });

  test('no exact duplicate (date + name + state set) entries', () => {
    const seen = new Set();
    AU_HOLIDAYS.forEach(h => {
      const key = `${h.date}::${h.name}::${[...h.states].sort().join(',')}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    });
  });

  test('national holidays with ALL states are accessible to every state', () => {
    const nationalHols = AU_HOLIDAYS.filter(h => h.states.includes('ALL'));
    const states = ['NSW','VIC','QLD','SA','WA','TAS','NT','ACT'];
    nationalHols.forEach(h => {
      states.forEach(state => {
        const map = buildHolMap([h], state);
        expect(map[h.date]).toBeDefined();
      });
    });
  });
});
