# Yahweahcare Ticket Management System

Internal ticket management web app for Yahweh Property Care (NDIS/disability
support provider) — categories, priorities, SLA tracking, staff/org-chart
management, dashboards, scheduled reports, and email/push notifications.

## Architecture

Two independent apps, deployed as **two separate Vercel projects** from this
same repo, both auto-deploying on every push to `main` (no separate deploy
step — `git push` is the deploy):

| Piece | What it is | Where it lives | Deployed URL |
|---|---|---|---|
| Frontend | Single-file React app (Babel + Terser build, no framework/bundler) | `YCTMFrontend/` | `https://yahweahcare-tkt-mgmt.vercel.app` |
| Backend | Express + TypeScript API, runs as Vercel serverless functions | `YCTMBackend/` | `https://yahweahcare-tkt-mgmt-hx48.vercel.app` |
| Database | Neon (serverless Postgres) | schema `yc_tkt_mgmt` | project "neon-byzantium-park" |

There is also a legacy `api/` folder (an older Express backend that used to
run on Azure App Service). It's dead code — the frontend only talks to the
`YCTMBackend` Vercel API — but it's kept in the repo intentionally, along with
its two associated (currently disabled) GitHub Actions workflows.

See **[DEVELOPER_HANDOVER.md](./DEVELOPER_HANDOVER.md)** for the full
architecture, deploy workflow, environment/config, data model notes, and
version history — treat it as the source of truth for anything not covered
here.

## Local development

```bash
cd ~/Downloads/Yahweahcare
chmod +x dev.sh
./dev.sh
```

Starts the frontend (`http://localhost:4000`) and backend
(`http://localhost:4002`) together. First run installs `YCTMBackend`
dependencies automatically. Requires a `.env.local` in `YCTMBackend/` with a
valid `DATABASE_URL` (Neon) and the other secrets listed in
`YCTMBackend/.env.example`.

## Tech stack

- **Frontend:** React 18 (CDN-loaded UMD build), single JSX source file
  compiled via a custom Babel + Terser build script
- **Backend:** Node.js 20+, Express 4, TypeScript 5, Microsoft Entra ID SSO
  (`@azure/msal-node`), JWT auth
- **Database:** Neon serverless Postgres
- **Hosting:** Vercel (both frontend and backend, auto-deploy on push)

## Docs

- `docs/` — implementation notes, deployment guides, and design docs written
  during development. Some describe options that were evaluated and not used
  (e.g. Azure hosting) — `DEVELOPER_HANDOVER.md` reflects the current
  production setup.
