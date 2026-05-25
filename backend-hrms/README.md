# Yahwehcare HRMS — Authentication & Authorization Service

Enterprise-grade authentication and authorization backend with **Microsoft Entra ID (Azure AD) SSO**, role-based access control, organization-email validation, refresh-token rotation, audit logging, and rate limiting.

**Stack:** Node.js 20+, TypeScript (strict), Express, PostgreSQL, MSAL (`@azure/msal-node`), Microsoft Graph SDK, JWT.

---

## 1. Quick Start (local dev)

### Prerequisites
- Node.js 20+
- PostgreSQL 16 (running)
- A Microsoft Entra app registration (see [§ 5](#5-microsoft-entra-app-registration-step-by-step))

### Setup
```bash
cd backend-hrms
npm install
cp .env.example .env       # fill in AZURE_* values from your Entra app
createdb yahweahcare        # or use an existing DB
npm run init-db             # apply schema (extends yc_tkt_mgmt schema)
npm run seed                # seed roles, permissions, bootstrap super admins
npm run dev                 # starts on http://localhost:4001
```

### Verify
```bash
curl http://localhost:4001/health
# {"ok": true, "time": "..."}
```

---

## 2. Architecture

### Folder structure
```
backend-hrms/
├── src/
│   ├── server.ts                      ← Express entry, security middleware
│   ├── config/
│   │   ├── env.ts                     ← Zod-validated env vars
│   │   └── msal.ts                    ← MSAL confidential-client config
│   ├── middleware/
│   │   ├── auth.middleware.ts         ← JWT verification + session check
│   │   ├── rbac.middleware.ts         ← requireRole / requirePermission
│   │   ├── rateLimit.middleware.ts    ← global + per-route limiters
│   │   └── error.middleware.ts        ← centralised error handler
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.routes.ts         ← /auth/* endpoints
│   │   │   ├── auth.service.ts        ← session lifecycle, token rotation
│   │   │   └── microsoft.service.ts   ← Graph API integration
│   │   ├── users/
│   │   │   └── users.routes.ts        ← user CRUD with super-admin guards
│   │   ├── roles/
│   │   │   └── roles.routes.ts        ← role + permission management
│   │   └── audit/
│   │       ├── audit.routes.ts        ← list + export logs
│   │       └── audit.service.ts       ← logAudit() — used everywhere
│   ├── utils/
│   │   ├── emailDomain.ts             ← shared validator (front + back)
│   │   └── tokens.ts                  ← JWT + PKCE helpers
│   └── db/
│       ├── schema.sql                 ← all tables (yc_tkt_mgmt schema)
│       ├── seed.ts                    ← idempotent seeder
│       ├── init.ts                    ← apply schema.sql
│       └── pool.ts                    ← pg pool with search_path
├── frontend-example/                  ← Next.js integration samples
│   ├── AuthContext.tsx
│   ├── LoginPage.tsx
│   ├── ProtectedRoute.tsx
│   └── middleware.ts
├── Dockerfile
├── docker-compose.yml
├── tsconfig.json
├── package.json
└── .env.example
```

### Authentication flow (Microsoft SSO)

```
┌──────────┐                  ┌──────────────┐                  ┌─────────────────┐
│ Browser  │                  │  HRMS API    │                  │  Microsoft Entra│
└─────┬────┘                  └──────┬───────┘                  └────────┬────────┘
      │  1. GET /login                │                                   │
      │  click "Sign in w/ Microsoft" │                                   │
      ├──────────────────────────────►│                                   │
      │                                │ 2. generate state + PKCE          │
      │                                │    redirect to Entra auth URL    │
      │  3. 302 → login.microsoftonline.com/.../authorize                  │
      │◄───────────────────────────────┤                                   │
      │                                                                    │
      │  4. User authenticates (MFA, conditional access)                    │
      ├───────────────────────────────────────────────────────────────────►│
      │                                                                    │
      │  5. 302 → BACKEND_URL/auth/microsoft/callback?code=...&state=...   │
      │◄───────────────────────────────────────────────────────────────────┤
      │  6. GET /auth/microsoft/callback│                                   │
      ├───────────────────────────────►│                                   │
      │                                │ 7. verify state, exchange code   │
      │                                ├──────────────────────────────────►│
      │                                │ 8. id_token + access_token       │
      │                                │◄──────────────────────────────────┤
      │                                │ 9. GET /me on MS Graph           │
      │                                ├──────────────────────────────────►│
      │                                │ 10. user profile + photo         │
      │                                │◄──────────────────────────────────┤
      │                                │ 11. validate org-email domain    │
      │                                │ 12. find-or-create local user    │
      │                                │ 13. mint our JWTs, persist session│
      │                                │                                   │
      │  14. 302 → FRONTEND_URL/dashboard                                  │
      │     Set-Cookie: yc_access  (HttpOnly, Secure, SameSite=Lax)        │
      │     Set-Cookie: yc_refresh (HttpOnly, Secure, SameSite=Lax)        │
      │◄───────────────────────────────┤                                   │
      │                                                                    │
      │  15. GET /auth/me — cookie sent automatically                      │
      │                                                                    │
```

### RBAC flow

```
Request → requireAuth ──┐
                        ├─► JWT verified ─► session loaded ─► permissions loaded ─► req.auth populated
                        │                                                              │
                        │                                                              ▼
                        │                                                  ┌─ requireRole('admin') ──┐
                        │                                                  │                          │
                        │                                                  ├─ requirePermission('x') ─┼─► route handler
                        │                                                  │                          │
                        │                                                  └─ requireAnyPermission(…) ┘
                        │
                        └─► 401 / 403 + audit log entry
```

### Database ER (high level)
```
users ──< user.role_id >── roles ──< role_permissions >── permissions
  │
  ├──< sessions (refresh tokens, device, expires_at)
  └──< audit_logs (every security event)

failed_logins (IP + email + timestamp)
```

All tables live in the **`yc_tkt_mgmt`** PostgreSQL schema. See [`src/db/schema.sql`](./src/db/schema.sql).

---

## 3. Roles & Permissions

| Role | Rank | Description |
|---|:---:|---|
| **Super Admin** | 1 | Full system access. Can create/modify other Super Admins. Bootstrap admins are protected. |
| **Admin** | 2 | Manage users/settings/audit. **Cannot** modify Super Admins or change role definitions. |
| **HR** | 3 | Manage employee records, view all tickets, audit read-only. |
| **Manager** | 4 | View own department's data; create/assign tickets within their team. |
| **Employee** | 5 | Raise tickets, view own. |

### Built-in safety rails

- ❌ Cannot delete bootstrap Super Admins (`bootstrap_admin = TRUE`).
- ❌ Cannot demote the **last active** Super Admin.
- ❌ Only another Super Admin can modify a Super Admin user.
- ❌ Cannot delete yourself.
- ❌ Refresh-token theft detection — mismatched refresh tokens revoke the session immediately.
- ✅ Every role/permission change is audited with `actor`, `target`, `before`, `after`, `ip`, `user-agent`.

### Permission catalogue (seeded)

`user.read · user.create · user.update · user.delete · user.activate`
`role.read · role.assign · role.manage · permission.manage`
`settings.read · settings.update · authsettings.manage`
`audit.read · audit.export`
`ticket.read.own · ticket.read.team · ticket.read.all · ticket.create · ticket.update · ticket.delete · ticket.assign`
`employee.read · employee.update`
`report.read · report.schedule`

---

## 4. Email-Domain Validation

Single source of truth: [`src/utils/emailDomain.ts`](./src/utils/emailDomain.ts).

Allowed domains are configured via `ALLOWED_EMAIL_DOMAINS` env var (comma-separated). Defaults to `yahwehcare.com.au,yahwehpc.com.au`.

The same validator is **used by the backend** (after Microsoft sign-in, and on every `POST /users` create) and **shipped to the frontend** via `GET /auth/config` so onboarding forms display the same error message and there's no possibility of drift.

```ts
import { validateEmail } from './utils/emailDomain';

validateEmail('user@gmail.com');           // { valid: false, reason: "Only organization emails…" }
validateEmail('user@yahwehcare.com.au');   // { valid: true }
```

This also runs as part of the Microsoft SSO callback — even if someone bypasses the front end, an attacker with a personal `@gmail.com` Microsoft account will be rejected at the server with an audited `login.bad_domain` event.

---

## 5. Microsoft Entra App Registration (step by step)

1. **Go to the Azure portal** → **Microsoft Entra ID** → **App registrations** → **+ New registration**.
2. **Name:** `Yahwehcare HRMS`.
3. **Supported account types:**
   - Single tenant (recommended) — only your org's users can sign in.
   - Or "Multi-tenant" if you need to accept external orgs (uncommon for HRMS).
4. **Redirect URI:**
   - Platform: **Web**
   - URI: `https://api.yourdomain.com/auth/microsoft/callback` (or `http://localhost:4001/auth/microsoft/callback` for local dev — you can add both).
5. Click **Register**.
6. On the **Overview** page, copy:
   - `Application (client) ID`         → `AZURE_CLIENT_ID`
   - `Directory (tenant) ID`           → `AZURE_TENANT_ID`
7. **Certificates & secrets** → **+ New client secret**:
   - Description: `hrms-prod-secret`
   - Expires: 6 months (rotate ahead of expiry)
   - Copy the secret **Value** (not the ID) → `AZURE_CLIENT_SECRET`
   - **Note:** Microsoft only shows the value once.
8. **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**:
   - `openid`
   - `profile`
   - `email`
   - `User.Read`        — basic profile (name, email, department, jobTitle)
   - `User.ReadBasic.All` *(optional — only if you want a directory people-picker)*
9. Click **Grant admin consent for [tenant]** (you must be a Global Admin or Privileged Role Admin).
10. **Authentication** tab → **Front-channel logout URL:** `https://api.yourdomain.com/auth/logged-out` → enables single sign-out.
11. **Token configuration** → optional: add `email`, `family_name`, `given_name`, `preferred_username` as optional claims so they're available in the ID token without an extra Graph call.
12. **Enterprise applications** → find your app → **Properties** → **User assignment required?** = **Yes** if you want to gate access to a specific group (e.g. only `Yahwehcare Employees` AAD group can sign in).

### What to put in your `.env`

```bash
AZURE_CLIENT_ID=00000000-0000-0000-0000-000000000000
AZURE_CLIENT_SECRET=lZv...                            # the SECRET VALUE
AZURE_TENANT_ID=00000000-0000-0000-0000-000000000000  # use 'common' for multi-tenant
AZURE_REDIRECT_URI=https://api.yourdomain.com/auth/microsoft/callback
AZURE_POST_LOGOUT_REDIRECT_URI=https://app.yourdomain.com/auth/logged-out
AZURE_SCOPES=openid profile email User.Read
```

---

## 6. API Reference

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| GET    | `/auth/config`              | public | Returns allowed domains + login URL for the frontend |
| POST   | `/auth/validate-email`      | public | Validates an email's domain |
| GET    | `/auth/microsoft`           | public | Starts SSO flow, redirects to Entra |
| GET    | `/auth/microsoft/callback`  | public | OIDC callback; sets auth cookies |
| POST   | `/auth/refresh`             | refresh cookie | Rotates access + refresh tokens |
| GET    | `/auth/me`                  | access cookie | Current user + permissions |
| POST   | `/auth/logout`              | access cookie | Revoke current session; clears cookies; returns MS logout URL |
| POST   | `/auth/logout-all`          | access cookie | Revoke **all** sessions for this user |
| GET    | `/auth/sessions`            | access cookie | List my active sessions |
| DELETE | `/auth/sessions/:id`        | access cookie | Revoke a specific session |

### Users
| Method | Path | Permission |
|---|---|---|
| GET    | `/users`           | `user.read`   |
| POST   | `/users`           | `user.create` |
| PATCH  | `/users/:id`       | `user.update` |
| DELETE | `/users/:id`       | `user.delete` |

### Roles
| Method | Path | Permission |
|---|---|---|
| GET    | `/roles`                  | `role.read`     |
| GET    | `/roles/:id`              | `role.read`     |
| POST   | `/roles`                  | Super Admin     |
| PATCH  | `/roles/:id`              | Super Admin     |
| GET    | `/roles/permissions/all`  | `role.read`     |

### Audit
| Method | Path | Permission |
|---|---|---|
| GET | `/audit-logs`        | `audit.read`   |
| GET | `/audit-logs/export` | `audit.export` |

### Sample requests

```bash
# 1. Visit in browser — the SSO flow can't be tested with curl
open http://localhost:4001/auth/microsoft

# 2. Check who's signed in (browser will send the cookie automatically)
curl -b "yc_access=<token>" http://localhost:4001/auth/me

# 3. Refresh tokens
curl -X POST -b "yc_refresh=<token>" http://localhost:4001/auth/refresh

# 4. List users (admin)
curl -b "yc_access=<token>" "http://localhost:4001/users?limit=20&role=manager"
```

---

## 7. Security Features

### What's enabled out of the box
- 🛡️ **Helmet** security headers (XFO, CSP, HSTS in production).
- 🌐 **CORS** locked to `FRONTEND_URL` with `credentials: true`.
- 🍪 **HTTP-only**, **Secure** (production), **SameSite=Lax** cookies — JS cannot read them.
- 🔑 **JWT** signed with `HS256` + per-token `jti`; access TTL 15 min, refresh 30 d (90 d with remember-me).
- ♻️ **Refresh-token rotation** — every refresh issues a new token and revokes the old one.
- 🚫 **Refresh-token theft detection** — if the presented refresh hash doesn't match, the session is killed.
- 🚦 **Rate limiting** — global 100 req/15 min/IP, login endpoint stricter (5/15 min/IP).
- 🔒 **Account-lock-on-failure** scaffold (`failed_logins` table + `locked_until`) — wire to your auth flow as needed.
- ⏰ **Inactivity timeout** — sessions revoke after 30 min idle (configurable via `SESSION_INACTIVITY_TIMEOUT_MS`).
- 🧾 **Audit log** for every security event (`yc_tkt_mgmt.audit_logs`).
- 🚨 **PKCE** on the Microsoft auth-code flow.
- 🔁 **CSRF** mitigated via SameSite + state parameter on OAuth; for non-GET API calls, frontend should send custom header or origin check.
- 📵 **No-store** cache headers in Next.js middleware prevent browser back-button leaks.

### Audit-event catalogue (extensible)
- `login.success` / `login.failed` / `login.bad_domain` / `login.account_locked`
- `logout` / `logout.global`
- `token.refresh` / `token.revoke`
- `session.expired` / `session.inactivity`
- `user.create` / `user.update` / `user.delete` / `user.activate` / `user.deactivate`
- `role.assign` / `role.change` / `role.create` / `role.update` / `role.delete`
- `permission.grant` / `permission.revoke`
- `password.reset.request` / `password.reset.success`
- `audit.export`

---

## 8. Logout Flow

1. Frontend calls `POST /auth/logout` (or `/auth/logout-all`).
2. Backend marks the session row `is_revoked = TRUE` (refresh token hash is now useless).
3. `yc_access`, `yc_refresh`, `yc_session` cookies are cleared.
4. Backend returns a `microsoftLogoutUrl`.
5. Frontend `window.location.href`s to it — Microsoft signs the user out of the SSO session.
6. Microsoft redirects to `AZURE_POST_LOGOUT_REDIRECT_URI` (e.g. `/auth/logged-out`).
7. Backend `/auth/logged-out` redirects to `FRONTEND_URL/login?logged_out=1`.
8. Login page shows ✓ "You have been signed out."

The Next.js middleware sets `Cache-Control: no-store` on every protected page, so the browser's back button can never resurface authenticated content.

---

## 9. Frontend Integration (Next.js)

See [`frontend-example/`](./frontend-example/).

```tsx
// app/layout.tsx
import { AuthProvider } from './AuthContext';
export default function RootLayout({ children }) {
  return <html><body><AuthProvider>{children}</AuthProvider></body></html>;
}

// app/admin/users/page.tsx
import { ProtectedRoute } from './ProtectedRoute';
export default function Page() {
  return (
    <ProtectedRoute permissions={['user.read']}>
      <UsersTable />
    </ProtectedRoute>
  );
}
```

### Auth-aware UI patterns
- **Login button:** `useAuth().loginWithMicrosoft(rememberMe)`.
- **User dropdown:** `useAuth().user.name`, `user.profile_photo_url`, `user.role_label`.
- **Sidebar gating:** filter menu items by `hasRole(...)` / `hasPermission(...)`.
- **Auto-refresh:** the context refreshes the access token every 12 min (TTL is 15 min).
- **Session expired:** if `/auth/me` returns 401 after a refresh attempt, the user is redirected to `/login`.

---

## 10. Production Deployment

### Recommended: Azure App Service + Azure Database for PostgreSQL

1. **Resource group**: `rg-yahwehcare-hrms-prod`.
2. **PostgreSQL Flexible Server**:
   - SKU: `Standard_D2ds_v4` (or burstable `B2s` for low traffic)
   - Storage: 64 GB minimum, autogrow on
   - **Geo-redundant backup** enabled
   - **Private endpoint** in the same VNet as the API
3. **App Service** (Linux, Node 22 stack):
   - Always On: enabled
   - HTTPS Only: enabled, **min TLS 1.2**
   - Health check path: `/health`
   - Identity: System-assigned managed identity → grant access to Key Vault
4. **Azure Key Vault** for secrets (`AZURE_CLIENT_SECRET`, `JWT_SECRET`, `SESSION_SECRET`, `DATABASE_URL`).
   In App Service → Configuration, reference them as `@Microsoft.KeyVault(SecretUri=https://kv-yahwehcare.vault.azure.net/secrets/JWT_SECRET/)`.
5. **Front Door / Application Gateway** in front of App Service for WAF + custom domain + SSL.
6. **Container variant**: push the Docker image to **ACR** → deploy via **Azure Container Apps**. Same env-var convention.

### Production checklist

- [ ] `NODE_ENV=production`
- [ ] `COOKIE_SECURE=true`
- [ ] `COOKIE_SAMESITE=lax` (or `strict` if you don't need cross-site cookies)
- [ ] `COOKIE_DOMAIN=.yourdomain.com` (so both `app.` and `api.` share auth cookies — only if you actually need that)
- [ ] `JWT_SECRET` and `SESSION_SECRET` ≥ 32 random bytes (use `openssl rand -hex 32`)
- [ ] All secrets sourced from Azure Key Vault, never in source control
- [ ] PostgreSQL TLS connection forced (`?sslmode=require`)
- [ ] Backups: daily + PITR, retention ≥ 30 days
- [ ] Azure Monitor + Application Insights wired up; alert on:
  - 5xx error rate > 1%
  - login.failed count anomaly
  - audit.export events (admin review)
- [ ] Rotate `AZURE_CLIENT_SECRET` annually (or sooner) with overlap
- [ ] Set Entra **Conditional Access** policy: require MFA for admin roles, block legacy auth
- [ ] Enable **Microsoft Defender for Cloud** on the resource group
- [ ] CI/CD via GitHub Actions or Azure DevOps:
  1. Lint + type-check
  2. Unit tests (jest)
  3. Integration tests with a postgres service container
  4. Build Docker image
  5. Deploy to staging slot → smoke test `/health` → swap

### Disaster recovery
- PostgreSQL: PITR (default 7 d, extend to 30 d for prod). Document the restore procedure.
- App Service: maintain at least two regions; use Traffic Manager or Front Door multi-origin for failover.
- Key Vault: soft-delete + purge protection ON.
- Audit log retention: at least 12 months in DB, archive older to Azure Blob via scheduled export.

---

## 11. Code Quality

- **TypeScript strict mode** is on (`tsconfig.json` → `"strict": true`).
- **Zod** validates env vars at startup — the process refuses to boot with bad config.
- **Single source of truth** for permissions/roles — the seeder is the contract.
- **Audit logger** is fire-and-forget (try/catch) so it never blocks a request.
- Every route handler that mutates data must call `logAudit(...)`.
- Errors flow through one centralised `errorHandler` — never `console.log` 500s to clients.

### Testing
- **Unit tests** for `emailDomain.ts`, `tokens.ts`, RBAC helpers.
- **Integration tests** with `supertest` against an ephemeral Postgres (use the `pg-mem` or a Docker `postgres:16-alpine` service container in CI).
- **Auth flow tests** stub MSAL's `acquireTokenByCode` and Graph's `/me` response.
- **RBAC tests** create a user with each role and assert which routes return 200/403.

---

## 12. Idempotent Seeder

`npm run seed` is **safe to run repeatedly**:

- Roles use `INSERT ... ON CONFLICT (name) DO UPDATE` — keeps `display_name`/`description` in sync.
- Permissions use `INSERT ... ON CONFLICT (name) DO UPDATE`.
- Role-permission grants are **reset and re-applied** on each run (the seeder owns the contract).
- Bootstrap Super Admins use `INSERT ... ON CONFLICT (email) DO UPDATE` so re-running won't create duplicates but **will** repair their `bootstrap_admin = TRUE` flag if someone tampered.

The seeder records a `system.seed` entry in the audit log on every run.

---

## 13. Common Pitfalls

| Symptom | Fix |
|---|---|
| `AADSTS50011 — redirect URI mismatch` | The URI in `.env` must match **exactly** what's registered in Azure (scheme, host, port, path, trailing slash). |
| `AADSTS65001 — consent required` | Click "Grant admin consent" on the API permissions page. |
| `403 disallowed_domain` after login | User's email isn't in `ALLOWED_EMAIL_DOMAINS`. |
| `401 session_expired` immediately | Check that `JWT_SECRET` is stable across restarts. |
| Cookies not set in browser | In production, `COOKIE_SECURE=true` requires HTTPS. For local dev keep it `false`. |
| CORS errors | `FRONTEND_URL` must exactly match the browser's origin (including port). |

---

## 14. Bootstrap Super Admins

The first run of `npm run seed` creates two Super Admin accounts:

| Name | Email | Department | Auth |
|---|---|---|---|
| **Ron Costa** | `it@yahwehcare.com.au` | Management | Microsoft SSO |
| **Alex** | `alex@yahwehpc.com.au` | Management | Microsoft SSO |

Both are marked `system_created = TRUE` and `bootstrap_admin = TRUE` — they **cannot be deleted or demoted** through the UI or the API. Only another Super Admin can modify them.

These two accounts sign in via Microsoft SSO using their org credentials — no local password is stored.
