# Deploy Yahweh Care HRMS to Vercel + Neon

End-to-end deployment guide. Total time: ~45 minutes. Total cost: **$0–$20/mo**.

---

## Architecture

```
   Browser
     │
     ▼
   ┌──────────────────────────────────┐
   │  Vercel (frontend project)       │   yahwehcare-hrms-web.vercel.app
   │  Static file: YCTMFrontend/index.html│   (or your custom domain)
   └────────────┬─────────────────────┘
                │ fetch with credentials
                ▼
   ┌──────────────────────────────────┐
   │  Vercel (backend project)        │   yahwehcare-hrms-api.vercel.app
   │  Serverless function:            │
   │   api/index.ts → Express app     │
   └────────────┬─────────────────────┘
                │ pg via @neondatabase/serverless
                ▼
   ┌──────────────────────────────────┐
   │  Neon Postgres                   │   xxx.ap-southeast-2.aws.neon.tech
   │  yc_tkt_mgmt schema              │
   └──────────────────────────────────┘
```

---

## Cost summary

| Service | Free tier | Paid tier | Notes |
|---|---|---|---|
| **Vercel** | Personal/Hobby — non-commercial only | **Pro $20/mo** — required for commercial HRMS use | One Pro seat covers all your projects |
| **Neon Postgres** | 0.5 GB storage, 3 GB egress, 1 project — free **forever** | Launch $19/mo (10 GB) / Scale $69/mo | Free is enough for <50 users + small audit log |
| **Total (commercial)** | — | **~$20–$39 AUD/mo** | Best DX of any hosting option |

---

## Step 1 — Create the Neon Postgres database (5 min)

1. Sign up at https://console.neon.tech (free, no credit card)
2. **Create Project**:
   - Name: `yahwehcare-hrms`
   - Postgres version: **16**
   - Region: **Asia Pacific (Sydney)** — closest to AU
3. After creation, you'll see a connection string like:
   ```
   postgresql://yahweh_owner:xxxxxxxxx@ep-cool-dawn-12345.ap-southeast-2.aws.neon.tech/yahweahcare?sslmode=require
   ```
   **Copy this — you'll need it as `DATABASE_URL`.**

4. Click **SQL Editor** in the sidebar
5. Open `YCTMBackend/src/db/schema.sql` from your local machine, copy its contents, paste into the Neon SQL editor, click **Run**
6. You should see "Success" and the schema is now in place

Verify by running this in the SQL editor:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'yc_tkt_mgmt' ORDER BY table_name;
```

You should see 10 tables: `activity`, `attachments`, `audit_logs`, `categories`, `comments`, `notifications`, `priorities`, `role_permissions`, `roles`, `permissions`, `sessions`, `statuses`, `tickets`, `users`, etc.

---

## Step 2 — Seed roles, permissions, and bootstrap Super Admins (2 min)

From your local machine:

```bash
cd ~/Downloads/Yahweahcare/YCTMBackend
npm install
# Export the Neon connection string
export DATABASE_URL='<paste-the-connection-string-from-neon>'
npm run seed
```

You should see:
```
✓ 5 roles upserted
✓ 25 permissions upserted
✓ super_admin: 25 permissions
...
✓ Ron Costa (it@yahwehcare.com.au) — bootstrap super admin
✓ Alex (alex@yahwehpc.com.au) — bootstrap super admin
✅ Seed complete.
```

Verify in Neon SQL editor:
```sql
SELECT id, email, name, role, is_admin, bootstrap_admin FROM yc_tkt_mgmt.users;
```

You should see Ron and Alex.

---

## Step 3 — Push to GitHub (if you haven't already)

```bash
cd ~/Downloads/Yahweahcare
./.github/scripts/bootstrap-repo.sh
```

This script pushes the entire project to a fresh GitHub repo (uses `gh` CLI).

If you already have a repo:
```bash
git add -A
git commit -m "Add Vercel + Neon support"
git push origin main
```

---

## Step 4 — Deploy backend to Vercel (5 min)

1. Sign up at https://vercel.com (use GitHub login)
2. Click **Add New → Project**
3. Import your `yahwehcare-hrms` repo
4. **Configure Project**:
   - **Root Directory**: `YCTMBackend` ← important — sets the working directory
   - **Framework Preset**: `Other`
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: leave default
5. **Environment Variables** — add these one at a time:

| Variable | Value | Where it comes from |
|---|---|---|
| `NODE_ENV` | `production` | constant |
| `DATABASE_URL` | `postgresql://...neon.tech/yahweahcare?sslmode=require` | Neon dashboard |
| `JWT_SECRET` | 32+ random hex chars | `openssl rand -hex 32` |
| `SESSION_SECRET` | 32+ random hex chars | `openssl rand -hex 32` |
| `COOKIE_DOMAIN` | `.vercel.app` (or your custom domain root) | depends on domain |
| `COOKIE_SECURE` | `true` | constant |
| `COOKIE_SAMESITE` | `lax` | constant |
| `BACKEND_URL` | (set after first deploy) | from Vercel after deploy |
| `FRONTEND_URL` | (set after frontend deploys) | from Vercel after deploy |
| `AZURE_CLIENT_ID` | App ID from Microsoft Entra | Azure portal |
| `AZURE_CLIENT_SECRET` | Secret value from Microsoft Entra | Azure portal |
| `AZURE_TENANT_ID` | Directory tenant ID | Azure portal |
| `AZURE_REDIRECT_URI` | `https://<backend-vercel-url>/auth/microsoft/callback` | after deploy |
| `AZURE_POST_LOGOUT_REDIRECT_URI` | `https://<frontend-vercel-url>/auth/logged-out` | after deploy |
| `AZURE_SCOPES` | `openid profile email User.Read` | constant |
| `ALLOWED_EMAIL_DOMAINS` | `yahwehcare.com.au,yahwehpc.com.au` | constant |

6. Click **Deploy**. First deploy takes ~2 minutes.
7. Once live, you'll get a URL like `https://yahwehcare-hrms-api-xyz.vercel.app`. **Copy this.**
8. Go back to **Settings → Environment Variables** and update:
   - `BACKEND_URL` = your backend's Vercel URL
   - `AZURE_REDIRECT_URI` = `https://<backend-vercel-url>/auth/microsoft/callback`
9. Click **Deployments → ⋯ → Redeploy** for the changes to take effect.

Test the health endpoint:
```bash
curl https://<your-backend-vercel-url>/health
# {"ok":true,"time":"2026-...","runtime":"vercel"}
```

---

## Step 5 — Deploy frontend to Vercel (3 min)

1. **Add New → Project** again
2. Import the **same repo**
3. Configure:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Other`
   - **Build Command**: leave empty
   - **Output Directory**: `.`
4. **Environment Variables**: none needed (frontend reads API URL from a meta tag — see below)
5. Deploy. You'll get `https://yahwehcare-hrms-web-xyz.vercel.app`.

6. **Tell the frontend where the backend lives** — add a `<meta>` tag to `index.html`:

   Edit `YCTMFrontend/index.html` and insert this line right after `<title>...</title>`:
   ```html
   <meta name="hrms-api" content="https://yahwehcare-hrms-api-xyz.vercel.app" />
   ```
   (Use your backend URL from Step 4.)

7. `git add -A && git commit -m "Configure prod API URL" && git push` — Vercel auto-redeploys on every push to main.

8. Now go to the **backend** project's env vars and update:
   - `FRONTEND_URL` = your frontend's Vercel URL
   - `AZURE_POST_LOGOUT_REDIRECT_URI` = `https://<frontend-vercel-url>/auth/logged-out`
9. Redeploy the backend.

---

## Step 6 — Update Microsoft Entra app

Open https://entra.microsoft.com → your HRMS app → **Authentication**:

1. Add a **Redirect URI** (type: Web):
   `https://<backend-vercel-url>/auth/microsoft/callback`
2. Update **Front-channel logout URL**:
   `https://<backend-vercel-url>/auth/logged-out`
3. **Save**.

Keep the localhost URI registered too if you want local dev to keep working.

---

## Step 7 — Test

1. Open `https://<frontend-vercel-url>` in your browser
2. Click **Sign in with Microsoft**
3. Authenticate with `it@yahwehcare.com.au` (Ron Costa)
4. You should land on the dashboard, logged in via real Microsoft SSO

Verify the audit log:
```sql
SELECT created_at, action, actor_email, success, metadata
FROM yc_tkt_mgmt.audit_logs
ORDER BY created_at DESC LIMIT 5;
```

You should see a `login.success` row.

---

## Step 8 — Custom domain (optional)

Free with Vercel + automatic Let's Encrypt TLS.

1. Vercel project → **Settings → Domains → Add**
2. Enter `hrms.yahwehcare.com.au` (frontend) and `api.hrms.yahwehcare.com.au` (backend)
3. Vercel shows you DNS records — add them to your domain registrar:
   - For root: `A` record to `76.76.21.21`
   - For subdomain: `CNAME` to `cname.vercel-dns.com`
4. Within 1-24 hours DNS propagates and certs auto-provision.

**Don't forget to update** Microsoft Entra Redirect URI and the backend's `FRONTEND_URL` / `BACKEND_URL` env vars to the new custom domain.

---

## Auto-deploy on `git push`

This is automatic on Vercel — every push to `main` triggers a build + deploy for both projects. Preview deployments are created for every pull request.

No GitHub Actions needed for the deploy itself (Vercel handles it), but the `.github/workflows/codeql.yml` for security scanning is still valuable.

If you want CI checks (lint, typecheck) on PRs before Vercel deploys, keep the `deploy-backend.yml` workflow but **remove the deploy job** — just the `ci` job that runs `npm run build`.

---

## Production hardening checklist

- [ ] Custom domain set up with HTTPS
- [ ] Cookie domain set to your custom domain (`COOKIE_DOMAIN=.yahwehcare.com.au`)
- [ ] Conditional Access in Entra: require MFA for all HRMS app sign-ins
- [ ] Vercel **Password Protection** disabled (it conflicts with SSO)
- [ ] Neon **Auto-suspend** set to 5 minutes (saves free compute time)
- [ ] Neon **PITR** retention: free tier gives 24 hr; Launch tier 7 days. Configure under **Settings → Recovery**.
- [ ] Rotate `AZURE_CLIENT_SECRET` annually
- [ ] Enable Vercel **Web Analytics** ($0 for first 2.5k events) for anomaly detection
- [ ] Branch protection on GitHub: require PR review on `main`

---

## Limitations of serverless deployment

A few things to know about running on Vercel functions:

| Limitation | Impact | Workaround |
|---|---|---|
| 10-second timeout (Hobby) | Long DB queries fail | Pro plan = 60s. Audit-log export limited to 50k rows |
| No background workers | The `setInterval` SLA breach checker in `server.ts` doesn't run | Use **Vercel Cron Jobs** — add to `vercel.json`: `"crons": [{"path":"/api/cron/sla-check","schedule":"*/5 * * * *"}]` |
| Cold starts (~150-300ms) | First request after idle is slower | Mostly invisible to users. Pro plan keeps functions warmer |
| In-memory state lost between invocations | The PKCE store can't be a `Map` | Already moved to signed cookies ✓ |
| Each request creates a new pg connection | Connection limits hit fast | Already using `@neondatabase/serverless` with HTTP pooling ✓ |

For Yahweh Care HRMS specifically (internal app, < 200 concurrent users), none of these are real-world problems.

---

## Cron job for SLA breach checker (optional)

Add to `YCTMBackend/vercel.json` to flag overdue tickets every 5 minutes:

```json
"crons": [
  { "path": "/api/cron/sla-check", "schedule": "*/5 * * * *" }
]
```

Then create `YCTMBackend/api/cron/sla-check.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { pool } from '../../src/db/pool';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify it's actually called by Vercel
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { rowCount } = await pool.query(
    `UPDATE yc_tkt_mgmt.tickets
        SET sla_breached = TRUE
      WHERE sla_breached = FALSE
        AND due_at < NOW()
        AND status_id IN (SELECT id FROM yc_tkt_mgmt.statuses WHERE is_closed = FALSE)`
  );
  res.json({ ok: true, breached: rowCount });
}
```

Add `CRON_SECRET` to your Vercel env vars (random 32-char string). Vercel injects this token into cron requests automatically.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Module not found: 'pg'` in build logs | Vercel pruned it as unused | Make sure `pg` is in `dependencies`, not `devDependencies` |
| `Error: connect ETIMEDOUT` | Neon endpoint suspended | First request always wakes Neon (~500ms). Set Neon auto-suspend higher to avoid |
| `AADSTS50011` after deploy | Redirect URI mismatch | Add the Vercel URL to Microsoft Entra → Authentication |
| CORS error: `Origin not allowed` | `FRONTEND_URL` env var wrong | Must exactly match the frontend Vercel URL (no trailing slash) |
| `403 not_authorized` for new user | User not in DB | Use the Add Staff modal (logged in as Ron Costa) to add them first |
| Login redirects then 404 | Frontend missing the meta tag | Make sure `<meta name="hrms-api" content="...">` is in `index.html` |

---

## Summary of files in this project

| File | Purpose |
|---|---|
| `YCTMBackend/vercel.json` | Vercel routing + headers |
| `YCTMBackend/api/index.ts` | Serverless entry — wraps Express |
| `YCTMBackend/src/db/pool.ts` | Auto-selects Neon vs pg driver |
| `YCTMBackend/src/db/schema.sql` | Run once in Neon SQL editor |
| `YCTMBackend/src/db/seed.ts` | Run locally with `DATABASE_URL` set |
| `YCTMFrontend/vercel.json` | Static-site routing + headers |
| `YCTMFrontend/index.html` | Add `<meta name="hrms-api" ...>` after deploy |
| `VERCEL_NEON_DEPLOY.md` | This guide |
