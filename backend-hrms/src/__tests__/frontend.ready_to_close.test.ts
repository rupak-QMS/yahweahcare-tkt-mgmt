// ============================================================
// Tests for 'Ready to Close' tab on the Tickets page
// Feature: creator of a resolved ticket sees it under a dedicated
//          "Ready to Close" tab and can close it inline.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

// __dirname = .../Yahweahcare/backend-hrms/src/__tests__
// 3 levels up  = .../Yahweahcare/
const HTML_PATH = path.resolve(__dirname, '../../../web/src/app-source.jsx');
const html = fs.readFileSync(HTML_PATH, 'utf-8');

// ── 1. Code-integrity checks ──────────────────────────────────────────────────

describe('index.html — Ready to Close tab (code integrity)', () => {
  it('STATUS_GROUPS contains ready_to_close key', () => {
    expect(html).toContain("key:'ready_to_close'");
  });

  it('ready_to_close label is "Pending Closure"', () => {
    expect(html).toContain("label:'Pending Closure'");
  });

  it('ready_to_close match uses Resolved status check', () => {
    // The match function for this tab filters on status === 'Resolved'
    expect(html).toContain("t.status==='Resolved'");
  });

  it('ready_to_close match checks requesterId against sessionUser.id', () => {
    expect(html).toContain('t.requesterId');
    expect(html).toContain('sessionUser?.id');
  });

  it('closingTicketId state is initialised', () => {
    // React.useState(null) for closingTicketId must be present
    expect(html).toContain('closingTicketId');
    expect(html).toContain('setClosingTicketId');
  });

  it('inline lock-icon Close button exists in table rows for ready_to_close filter', () => {
    // Emoji was replaced with the standardised <Icon name='lock' .../> component
    expect(html).toContain("Icon name='lock'");
    expect(html).toContain('Close</>');
  });

  it('Action column header is added when filter is ready_to_close', () => {
    // The header spread adds 'Action' only when filter==='ready_to_close'
    expect(html).toContain("filter==='ready_to_close'?['Action']:[]");
  });

  it('API.tickets.close is called in the inline close handler', () => {
    expect(html).toContain('API.tickets.close(t._dbId)');
  });

  it('close button is disabled while closingTicketId matches the row id', () => {
    expect(html).toContain('closingTicketId===t._dbId');
  });

  it('green highlight color (#059669) is used for ready_to_close tab', () => {
    // Tab active bg and border use the green brand color
    const count = (html.match(/#059669/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2); // active bg + border at minimum
  });
});

// ── 2. Unit tests for the filter logic ───────────────────────────────────────

// Mirror the match function from STATUS_GROUPS:
//   t.status === 'Resolved' && Number(t.requesterId) === Number(sessionUser?.id)

interface Ticket {
  status: string;
  requesterId?: number | string | null;
}

function readyToCloseMatch(sessionUserId: number | string | null | undefined) {
  return (t: Ticket): boolean =>
    t.status === 'Resolved' &&
    Number(t.requesterId) === Number(sessionUserId);
}

describe('ready_to_close filter logic', () => {
  const userId = 7;
  const match = readyToCloseMatch(userId);

  it('includes a Resolved ticket created by the session user', () => {
    expect(match({ status: 'Resolved', requesterId: 7 })).toBe(true);
  });

  it('excludes a Resolved ticket created by a different user', () => {
    expect(match({ status: 'Resolved', requesterId: 99 })).toBe(false);
  });

  it('excludes an Open ticket created by the session user', () => {
    expect(match({ status: 'Open', requesterId: 7 })).toBe(false);
  });

  it('excludes a Closed ticket created by the session user', () => {
    expect(match({ status: 'Closed', requesterId: 7 })).toBe(false);
  });

  it('excludes an In Progress ticket created by the session user', () => {
    expect(match({ status: 'In Progress', requesterId: 7 })).toBe(false);
  });

  it('excludes a Pending Approval ticket created by the session user', () => {
    expect(match({ status: 'Pending Approval', requesterId: 7 })).toBe(false);
  });

  it('handles string requesterId matching numeric session user id', () => {
    // requesterId may come back as string from the backend
    expect(match({ status: 'Resolved', requesterId: '7' })).toBe(true);
  });

  it('handles numeric requesterId matching string session user id', () => {
    const matchStr = readyToCloseMatch('7');
    expect(matchStr({ status: 'Resolved', requesterId: 7 })).toBe(true);
  });

  it('returns false when requesterId is null', () => {
    expect(match({ status: 'Resolved', requesterId: null })).toBe(false);
  });

  it('returns false when requesterId is undefined', () => {
    expect(match({ status: 'Resolved', requesterId: undefined })).toBe(false);
  });

  it('returns false when sessionUser id is null', () => {
    const matchNull = readyToCloseMatch(null);
    expect(matchNull({ status: 'Resolved', requesterId: 7 })).toBe(false);
  });

  it('returns false when sessionUser id is undefined', () => {
    const matchUndef = readyToCloseMatch(undefined);
    expect(matchUndef({ status: 'Resolved', requesterId: 7 })).toBe(false);
  });

  it('status check is case-sensitive — lowercase resolved is excluded', () => {
    // DB might return 'resolved'; the normalise() mapper should capitalise it
    // but we verify the filter itself is strict
    expect(match({ status: 'resolved', requesterId: 7 })).toBe(false);
  });
});
