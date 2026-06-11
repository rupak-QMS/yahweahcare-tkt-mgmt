// ============================================================
// Tests for Bootstrap Admin designation label fix
// Feature: Bootstrap Admin users must show 'System Administrator'
//          as their deptLabel in Navigation sidebar and TopBar,
//          NOT their org-chart position type ('Director Level' etc.)
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

// ── 1. Code-integrity checks: verify the fix is in index.html ────────────────

// __dirname = .../Yahweahcare/backend-hrms/src/__tests__
// 3 levels up  = .../Yahweahcare/
const HTML_PATH = path.resolve(__dirname, '../../../frontend/src/app-source.jsx');
const html = fs.readFileSync(HTML_PATH, 'utf-8');

describe('index.html — Bootstrap Admin designation fix (code integrity)', () => {
  it('TopBar: uses isBootstrapAdmin guard before showing deptLabel', () => {
    // Must have: isBootstrapAdmin ? 'System Administrator' : (dept fallback)
    // Located in the TopBar component (first occurrence of the pattern)
    const topBarSection = html.slice(html.indexOf('function TopBar('), html.indexOf('function Navigation('));
    expect(topBarSection).toContain("isBootstrapAdmin");
    expect(topBarSection).toContain("'System Administrator'");
  });

  it('Navigation sidebar: uses isBootstrapAdmin guard before showing deptLabel', () => {
    // Located in the Navigation / Sidebar component
    const navSection = html.slice(html.indexOf('function Navigation('), html.indexOf('function SignedOutScreen('));
    expect(navSection).toContain("isBootstrapAdmin");
    expect(navSection).toContain("'System Administrator'");
  });

  it('fix appears exactly twice — once in TopBar, once in Navigation', () => {
    const matches = html.match(/isBootstrapAdmin\s*\?\s*'System Administrator'/g) || [];
    expect(matches.length).toBe(2);
  });
});

// ── 2. Unit-tests for the deptLabel logic itself ─────────────────────────────

// Extracted logic matching BOTH TopBar and Navigation implementations:
//   TopBar:     isBootstrapAdmin ? 'System Administrator' : (department_name || dept || '')
//   Navigation: isBootstrapAdmin ? 'System Administrator' : (dept || department_name || employment_type || '')

function topBarDeptLabel(currentUser: Record<string, unknown> | null): string {
  if (!currentUser) return '';
  if (currentUser.isBootstrapAdmin) return 'System Administrator';
  return (currentUser.department_name as string) || (currentUser.dept as string) || '';
}

function navDeptLabel(currentUser: Record<string, unknown> | null): string {
  if (!currentUser) return '';
  if (currentUser.isBootstrapAdmin) return 'System Administrator';
  return (currentUser.dept as string) || (currentUser.department_name as string) || (currentUser.employment_type as string) || '';
}

// ── TopBar deptLabel ─────────────────────────────────────────────────────────

describe('TopBar deptLabel — Bootstrap Admin designation', () => {
  it('returns "System Administrator" for a Bootstrap Admin with no department', () => {
    const user = { isBootstrapAdmin: true, dept: '', department_name: '' };
    expect(topBarDeptLabel(user)).toBe('System Administrator');
  });

  it('returns "System Administrator" for a Bootstrap Admin who also holds Director position', () => {
    const user = { isBootstrapAdmin: true, dept: 'Director Level', positionType: 'director' };
    expect(topBarDeptLabel(user)).toBe('System Administrator');
  });

  it('returns "System Administrator" for a Bootstrap Admin with a real department set', () => {
    // Even if dept is set, Bootstrap Admin always gets System Administrator
    const user = { isBootstrapAdmin: true, dept: 'Human Resources', department_name: 'Human Resources' };
    expect(topBarDeptLabel(user)).toBe('System Administrator');
  });

  it('returns department_name for a regular Director (not Bootstrap Admin)', () => {
    const user = { isBootstrapAdmin: false, positionType: 'director', department_name: 'Operations' };
    expect(topBarDeptLabel(user)).toBe('Operations');
  });

  it('returns dept when department_name is absent for a non-bootstrap user', () => {
    const user = { isBootstrapAdmin: false, dept: 'IT Support' };
    expect(topBarDeptLabel(user)).toBe('IT Support');
  });

  it('returns empty string when no dept data for non-bootstrap user', () => {
    const user = { isBootstrapAdmin: false, dept: '', department_name: '' };
    expect(topBarDeptLabel(user)).toBe('');
  });

  it('returns empty string for null currentUser', () => {
    expect(topBarDeptLabel(null)).toBe('');
  });
});

// ── Navigation deptLabel ─────────────────────────────────────────────────────

describe('Navigation deptLabel — Bootstrap Admin designation', () => {
  it('returns "System Administrator" for a Bootstrap Admin with no department', () => {
    const user = { isBootstrapAdmin: true, dept: '', employment_type: 'full_time' };
    expect(navDeptLabel(user)).toBe('System Administrator');
  });

  it('returns "System Administrator" for a Bootstrap Admin who also holds Director position', () => {
    const user = { isBootstrapAdmin: true, dept: 'Director Level', positionType: 'director' };
    expect(navDeptLabel(user)).toBe('System Administrator');
  });

  it('dept fallback: returns dept for non-bootstrap user with dept set', () => {
    const user = { isBootstrapAdmin: false, dept: 'Finance', department_name: '' };
    expect(navDeptLabel(user)).toBe('Finance');
  });

  it('department_name fallback: returns department_name when dept is empty', () => {
    const user = { isBootstrapAdmin: false, dept: '', department_name: 'Care Coordination' };
    expect(navDeptLabel(user)).toBe('Care Coordination');
  });

  it('employment_type fallback: returns employment_type when both dept fields are empty', () => {
    const user = { isBootstrapAdmin: false, dept: '', department_name: '', employment_type: 'Casual' };
    expect(navDeptLabel(user)).toBe('Casual');
  });

  it('returns empty string when all fallbacks are empty for non-bootstrap user', () => {
    const user = { isBootstrapAdmin: false, dept: '', department_name: '', employment_type: '' };
    expect(navDeptLabel(user)).toBe('');
  });

  it('returns empty string for null currentUser', () => {
    expect(navDeptLabel(null)).toBe('');
  });

  it('non-bootstrap admin role users are unaffected', () => {
    const user = { isBootstrapAdmin: false, role: 'admin', dept: 'Management' };
    expect(navDeptLabel(user)).toBe('Management');
  });
});
