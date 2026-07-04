# Yahweh Care — Ticket Management System: Developer Handover

This document is the single source of truth for anyone picking up this project.
It covers architecture, how deploys actually work, environment/config, known
data model quirks, past bugs and fixes, and open issues.

**Keep this file up to date.** Every time you ship a meaningful change (a
feature, a fix, a schema change, an infra change), add an entry to the
[Version History](#version-history) section at the bottom — don't just rely on
git commit messages. Bump the version number (Version 1, Version 2, Version
3, ...) and summarize what changed, why, and anything the next person needs
to know. Treat this file as living documentation, not a one-time snapshot.

---

## 1. What this app is

A ticket management system for Yahweh Property Care (an NDIS/disability
support provider). Staff raise tickets (IT support, HR, facilities, finance,
clinical/compliance, general enquiries), tickets get assigned, worked, marked
complete, routed to approvers, and closed. There's also staff/org-chart
management, SLA/analytics dashboards, scheduled reports, and email/push
notifications.

## 2. High-level architecture

Two independent halves, deployed as **two separate Vercel projects** from the
**same GitHub repo**:

| Piece | What it is | Where it lives | Deployed URL |
|---|---|---|---|
| Frontend | Single-file React app (no build framework — Babel + Terser compile it directly) | `YCTMFrontend/` | `https://yahweahcare-tkt-mgmt.vercel.app` |
| Backend | Express + TypeScript API, runs as Vercel serverless functions | `YCTMBackend/` | `https://yahweahcare-tkt-mgmt-hx48.vercel.app` |
| Database | Neon (serverless Postgres) | schema `yc_tkt_mgmt` | project "neon-byzantium-park" |

GitHub repo: `https://github.com/hostsubho/yahweahcare-tkt-mgmt.git`, branch
`main`. Both Vercel projects are wired to auto-deploy on every push to `main`
via their Git integration — **there is no separate deploy step**, `git push`
is the deploy.

There is also a legacy `api/` folder (an older Express backend) that used to
run on Azure App Service (`yahweahcare-tkt-mmt-prod.azurewebsites.net`). **It
is dead code.** The frontend's API base URL is hardcoded to the
`yahweahcare-tkt-mgmt-hx48` Vercel backend only (see `HRMS_API` /
`API_BASE_URL` near the top of `app-source.jsx`). Two GitHub Actions
workflows (`deploy-frontend.yml`, `deploy-backend.yml`) still target that dead
Azure infra — they're currently being left in place intentionally rather than
deleted, but don't expect them to do anything useful; the live workflows are
`deploy-frontend-staging.yml`, `deploy-backend-staging.yml`, `ci.yml`, and
`codeql.yml`.

## 3. Frontend deep-dive

- **Everything is one file**: `YCTMFrontend/src/app-source.jsx`. All page components
  (`Dashboard`, `TicketsPage`, `StaffManagementPage`, `SettingsPage`,
  `EmailConfigPage`, etc.), the `API` client object, auth helpers, and the
  `App`/`Navigation` shell all live in this one ~750KB JSX file. There is no
  component-per-file structure — search within the file rather than looking
  for separate component files.
- **Build step**: `YCTMFrontend/build.js` compiles `src/app-source.jsx` (Babel JSX →
  JS) and `enterprise-components.js`, then minifies both with Terser into
  `app.js` and `enterprise-components-compiled.js`, and rewrites the
  cache-busting `?v=<hash>` query strings in `index.html`. Run `node
  build.js` from inside `YCTMFrontend/` after any `app-source.jsx` edit — **the
  committed `app.js` is what actually runs in production**, so if you forget
  to rebuild, your source change has no effect on the deployed site. Vercel
  also runs this same build automatically as part of its build step, but
  it's good practice to build and sanity-check locally before pushing.
- **Routing**: hash-based (`#dashboard`, `#tickets`, `#settings`, ...), no
  router library. Adding a new page requires updating **three separate
  places** in `app-source.jsx`, or it will be reachable-but-broken in subtle
  ways:
  1. One of the page-permission arrays (`STAFF_PAGES` / `MANAGER_PAGES` /
     `HR_PAGES` / `DIRECTOR_PAGES` / `BOOTSTRAP_PAGES`, ~line 316) — if the
     new page ID isn't in `allowedPages`, navigating to it silently bounces
     back to Dashboard.
  2. The `pageLabels` map (~line 740) — controls the header/breadcrumb
     title. Missing this makes the title silently fall back to "Dashboard"
     even though the page content is fine (easy to miss in QA).
  3. The `switch (currentPage)` routing block (~line 8880) — the actual
     `case 'your-page': return <YourPageComponent />;`.
  If the page should also show as a sidebar nav link, add it to the `pages`
  array in the `Navigation` component (~line 957) too — but note the
  Settings page deliberately does NOT do this; it's reached only via the
  profile dropdown menus.
- **Service worker caching** (`YCTMFrontend/sw.js`): caches `app.js`,
  `enterprise-components-compiled.js`, and `/` as "shell assets" with a
  stale-while-revalidate strategy. When testing a fresh deploy in a browser
  that's had the app open before, a normal reload can serve a stale cached
  bundle. To force a true fresh load: unregister the service worker and
  clear caches (`navigator.serviceWorker.getRegistrations()` →
  `.unregister()`, `caches.keys()` → `caches.delete()`), then navigate with a
  cache-busting query string (e.g. `/?cb=<timestamp>#page`) — a pure
  hash-only URL change does **not** force a real network reload in a
  browser, since it's a same-document navigation.
- **Auth session storage**: `sessionStorage.getItem('ms_current_user')`
  holds the current user object on the client (`id`, `name`, `email`, `dept`,
  `deptId`, `positionType`, `role`, `isBootstrapAdmin`). Access tokens are
  refreshed silently every ~13 minutes; there's also a 20-minute heartbeat
  ping to `/auth/me` to keep the backend session alive.

## 4. Backend deep-dive

- Express + TypeScript in `YCTMBackend/src/`, organized by module under
  `src/modules/<domain>/<domain>.routes.ts` (e.g. `tickets`, `users`,
  `auth`, `org`, `notifications`).
- Deployed to Vercel as serverless functions — **this has real
  consequences**: any code placed *after* `res.json()`/`res.status().json()`
  is not guaranteed to finish executing once the response is sent. All
  notification/audit-log calls in route handlers must be `await`ed *before*
  the response, wrapped in `.catch(() => {})` so a notification failure
  doesn't fail the whole request.
- **Two independent notification pipelines**, both triggered from the same
  route handlers:
  - Pipeline A: `notify()` in `src/modules/notifications/notifications.service.ts`
    — push notifications (web-push/VAPID) + an in-app `notifications` table
    row. No longer sends ticket-event emails (only user-lifecycle emails),
    to avoid double-sending with Pipeline B.
  - Pipeline B: `notifyTicketXxx()` functions in
    `src/services/email/notification.service.ts` → `enqueue()` in
    `email.queue.ts` → `attemptSend()` → `sendEmail()` in
    `resend.service.ts`. Has retry/backoff via a `/cron/email-retry`
    endpoint. The Email Config admin page's Logs/Queue/Stats tabs read from
    this pipeline.
- **Auth**: Microsoft Entra ID (Azure AD) via PKCE OAuth (`@azure/msal-node`).
  `POST /auth/microsoft` starts the flow, `/auth/microsoft/callback` completes
  it, `GET /auth/me` returns the current session's user, `POST /auth/logout`
  ends it. Sessions are DB-backed (`sessions` table) with a 15-minute access
  token / 30-day refresh token, revoked after 30 minutes of inactivity.
- **Self-healing schema migrations at runtime**: rather than relying solely
  on migration files (which have drifted from the live DB — see §5), several
  routes run an idempotent `ensureXColumn()`/`ensureXTable()` helper on first
  use (e.g. `ensureApproversTable`, `ensureAttachmentsColumn`,
  `ensureAddressColumn` in `users.routes.ts`) using `CREATE TABLE IF NOT
  EXISTS` / `ALTER TABLE ADD COLUMN IF NOT EXISTS`, memoized with a
  module-level boolean so it only actually runs once per cold start. **This
  is the established pattern for adding a new column/table in this
  codebase** — prefer it over hand-writing a new SQL migration file, since
  migration files here are not reliably applied to the live DB.

## 5. Database — important caveats

- Postgres via Neon, schema `yc_tkt_mgmt`. Connection is via `DATABASE_URL`
  (see `YCTMBackend/src/db/pool.ts`).
- **The live schema has drifted from the migration files in the repo.**
  `YCTMBackend/src/db/*.sql` and `api/migrations/*.sql` do not reliably
  describe the current live table shapes — some columns exist live that no
  migration file adds (e.g. `users.phone`, `users.designation`,
  `users.avatar_initials`), and some migration-file columns were never
  actually applied. **Before writing a query against a column, verify it
  exists live** — the most reliable way (from a normal dev machine with
  psql/a Postgres client) is to query `information_schema.columns` directly
  against the Neon database, not to trust the repo's migration files.
- No direct network path to Neon was available from the Claude sandbox this
  work was done in (DNS/proxy blocked). If you're a human developer with a
  real terminal, `psql "$DATABASE_URL"` should just work — you're not
  affected by that sandboxing constraint. If you ever need to fall back to
  the Neon Console SQL Editor (e.g. from a similarly restricted environment),
  its "copy to clipboard" export mechanism was the reliable way to get data
  out — the "Download" button gets silently blocked by the browser after
  the first download of a session.
- Known **live data-integrity quirks** as of 2026-07-04 (not caused by any
  code, just an artifact of an earlier data reset — don't be alarmed by
  them, and don't assume foreign keys are consistently enforced):
  - `users` only has 10 real rows (ids 1, 4–12), but `user_positions`,
    `staff_positions`, `ticket_approval_history`, and `ticket_escalations`
    contain rows referencing now-nonexistent user_ids in the 20s–40s range.
  - `ticket_approval_history` / `ticket_escalations` also reference
    ticket_ids (e.g. 97, 191, 200–208) that don't exist in the current
    `tickets` table (only ids 4–20-ish exist as of this writing).
- A full schema+data backup (excluding `sessions` and `audit_logs` row data)
  was captured on 2026-07-04 — see `SQL_BKP/yahwehcare_backup_2026-07-04.sql`
  and its `README.txt` in the repo root if you need a point-in-time
  reference for the live schema.

## 6. Ticket approval workflow (data model)

- Approvers are attached to a ticket via the `ticket_approvers` table
  (`ticket_id`, `approver_user_id`, `approval_status`) **at ticket-creation
  time**, before any work has been done.
- The ticket's own `status` column only becomes `'pending_approval'` when
  the assignee calls `POST /tickets/:id/complete` with a resolution note —
  this resets all approver rows to `'Pending'` and bumps `approval_round`.
- Approvers act via `POST /tickets/:id/approve` / `/reject` / `/reopen`.
- **Gotcha fixed 2026-07-04**: the "Pending My Approval" tab used to list
  any ticket where the user had a pending `ticket_approvers` row,
  regardless of the ticket's actual `status` — so tickets that had an
  approver assigned at creation but hadn't been marked complete yet showed
  up in the tab with no way to act on them (the Approve/Reject panel only
  renders when `status === 'Pending Approval'`). Fixed by aligning the tab's
  filter condition with the button's gate. If you touch this area again,
  keep those two conditions in sync.

## 7. Environment variables (backend)

See `YCTMBackend/src/config/env.ts` for the authoritative, Zod-validated
list. Highlights:

- `DATABASE_URL` — Neon connection string.
- `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` /
  `AZURE_REDIRECT_URI` / `AZURE_POST_LOGOUT_REDIRECT_URI` — Microsoft Entra
  app registration.
- `JWT_SECRET` / `SESSION_SECRET` — must each be ≥32 chars.
- `ALLOWED_EMAIL_DOMAINS` — comma-separated list gating who can be created
  as staff (defaults to `yahwehcare.com.au,yahwehpc.com.au,wmxsolutions.com.au`).
  **Known gap**: this is a flat allow-list applied to everyone; it does not
  currently implement a "bootstrap-admin can bypass / only bootstrap-admin
  can create another bootstrap-admin" exception, even though that's the
  intended policy per stakeholder conversations. See §9.
- `RESEND_API_KEY` / `EMAIL_FROM` — optional; email sending is silently
  skipped (not erroring) if unset.
- `CRON_SECRET` — protects the `/cron/email-retry` endpoint.

## 8. Repo hygiene notes

- `.gitignore` covers `node_modules/`, build output, `.env*`, DB dumps,
  editor junk, and (as of 2026-07-04) `*.backup` files in addition to
  `*.bak`.
- The `api/` legacy folder and the two Azure-targeting GitHub Actions
  workflows are being kept in the repo intentionally for now (not deleted)
  even though they're dead — this was a deliberate, conservative scope
  decision, not an oversight. Don't assume they're safe to delete without
  checking with the project owner first.

## 9. Known open issues / things worth fixing next

- **Bootstrap-admin email-domain rule is only partially enforced.** The
  intended policy: only `@yahweahcare.com.au`-domain accounts can be added
  as staff, except the existing bootstrap admin(s); only a bootstrap admin
  can create another bootstrap admin; nobody can delete a bootstrap admin.
  As of 2026-07-04: the "can't delete/deactivate a bootstrap admin" and
  "only bootstrap admin can delete/deactivate staff" rules ARE enforced
  server-side (`users.routes.ts`). The domain restriction is a flat
  allow-list with no bootstrap-admin exception path, and the "only a
  bootstrap admin can create another bootstrap admin" rule doesn't have a
  dedicated check at all (no route currently lets you set
  `is_bootstrap_admin` on create/update in the first place, so it's not
  exploitable today, but if that ever gets exposed, add the check then).
- **Frontend-only email-domain allowlist inconsistency**: `app-source.jsx`
  hardcodes `['yahwehcare.com.au','yahwehpc.com.au']` in a couple of
  places (missing `wmxsolutions.com.au`, which the backend does allow).
  This is purely a client-side UX check (real enforcement is server-side),
  but worth fixing for consistency if you're in that code anyway.
- **`ticket_approvers`/escalation interplay**: escalating a ticket
  reassigns it but does not touch `ticket_approvers` or ticket `status` —
  this is fine for the current workflow, but if escalation logic changes,
  re-check the "Pending My Approval" tab filter (§6) still makes sense.
- Push notifications are correctly wired end-to-end but effectively unused
  in practice — very few real users have ever clicked "Enable push
  notifications" in a real browser session, so don't be surprised if this
  area looks "broken" when it's really just unused.

## 10. Recently touched areas (context for the next person)

If you're picking this up soon after 2026-07-04, the following areas were
just worked on and are freshest in anyone's mind — worth a quick look before
assuming behavior:

- `SettingsPage` (My Profile) — new page, `YCTMFrontend/src/app-source.jsx`. Backend:
  `GET/PATCH /users/me` in `users.routes.ts`.
- `StaffManagementPage`'s phone/address fields — now synced with the same
  columns `SettingsPage` edits.
- SLA Compliance dashboard calculation — `stats` `useMemo` in the main app
  component, watch the `resolvedAt || updatedAt` vs `updatedAt ||
  resolvedAt` precedence if you touch it again (the former is correct).
- Sidebar profile widget and the app's logo (`YCTMFrontend/logo.png`) were both
  restyled/replaced — purely cosmetic, low risk.

---

## Version History

**How to use this section**: every developer who ships a change should add a
new entry here (don't edit or delete previous entries). Increment the
version number. Include the date, a short summary of what changed and why,
and anything the next developer needs to know (breaking changes, follow-ups,
things you deliberately didn't do and why).

### Version 1 — 2026-07-04

Baseline handover snapshot. Session covered:

- Created a database backup (`SQL_BKP/`) and a full codebase+DB backup under
  `Application_Backup/`.
- Verified (and partially found gaps in) the bootstrap-admin/email-domain
  access rules — see §9.
- Repo cleanup: removed orphaned files (`yahweahcare-tkt-mgmt/` stray clone,
  duplicate `.backup` files, an untracked debug script, `.DS_Store`), added
  `*.backup` to `.gitignore`. Left the legacy `api/` folder and its Azure
  GitHub Actions workflows in place intentionally (not a full cleanup, by
  request).
- Fixed: SLA Compliance dashboard showing 0% (timestamp-precedence bug).
- Fixed: "Pending My Approval" tab listing tickets with no way to actually
  approve them (status-filter mismatch vs. the Approve button's gate).
- Built: a real "My Profile" (`Settings`) page — view own profile, edit only
  phone number and address. Previously "Settings" just redirected to the
  Staff Management page.
- Synced phone/address between My Profile and Staff Management (same DB
  columns, previously only reachable from one side).
- Restyled the sidebar profile widget (cleaner card, brand-color avatar,
  refined role badge).
- Replaced the text/icon placeholder logo with the real Yahweh Care brand
  logo image (`YCTMFrontend/logo.png`) across sidebar, login, and sign-out screens.
- Created this handover document.

_Next entry goes here — Version 2._
