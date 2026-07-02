# Yahweahcare — Azure Production Deployment Guide

## Architecture Overview

```
GitHub (main branch)
        │
        ├── GitHub Actions ──► Azure Static Web Apps  (Frontend)
        │                         yahweahcare.azurestaticapps.net
        │
        └── GitHub Actions ──► Azure App Service       (Backend API)
                                  yahweahcare-api.azurewebsites.net
                                        │
                                        └── Azure Database for PostgreSQL
                                              yahweahcare-db.postgres.database.azure.com
```

---

## Prerequisites

1. [Azure account](https://portal.azure.com) — free tier is fine to start
2. [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed locally
3. [Node.js 18+](https://nodejs.org) on your machine
4. Access to your GitHub repo: `https://github.com/hostsubho/yahweahcare-tkt-mgmt`

---

## Phase 1 — Azure Setup (One-time)

### 1.1 Login and create a Resource Group

```bash
az login

# Create a resource group (everything lives here)
az group create \
  --name yahweahcare-rg \
  --location australiaeast
```

> Use `australiaeast` (Sydney) for the lowest latency for Australian users.

---

### 1.2 Create Azure Database for PostgreSQL — Flexible Server

```bash
az postgres flexible-server create \
  --resource-group yahweahcare-rg \
  --name yahweahcare-db \
  --location australiaeast \
  --admin-user ycadmin \
  --admin-password "YourStr0ngP@ssword!" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 16 \
  --storage-size 32 \
  --public-access 0.0.0.0
```

**Note:** `--public-access 0.0.0.0` allows all IPs initially (for setup). Lock it down later.

Once created, get your connection string:
```bash
az postgres flexible-server show-connection-string \
  --server-name yahweahcare-db \
  --admin-user ycadmin \
  --admin-password "YourStr0ngP@ssword!" \
  --database-name neondb
```

Your `DATABASE_URL` will look like:
```
postgresql://ycadmin:YourStr0ngP@ssword!@yahweahcare-db.postgres.database.azure.com/neondb?sslmode=require
```

---

### 1.3 Create the database and run migrations

```bash
# Create the database
az postgres flexible-server db create \
  --resource-group yahweahcare-rg \
  --server-name yahweahcare-db \
  --database-name neondb

# Set env var and run migrations from your local machine
cd /path/to/Yahweahcare/api

DATABASE_URL="postgresql://ycadmin:YourStr0ngP@ssword!@yahweahcare-db.postgres.database.azure.com/neondb?sslmode=require" \
  node run-migrations.js

# Optionally seed initial data
DATABASE_URL="postgresql://..." node seed-enterprise.js
```

---

### 1.4 Create App Service for the Backend API

```bash
# Create an App Service Plan (B1 = Basic tier, ~$13/month)
az appservice plan create \
  --resource-group yahweahcare-rg \
  --name yahweahcare-plan \
  --location australiaeast \
  --sku B1 \
  --is-linux

# Create the Web App (Node 18 LTS)
az webapp create \
  --resource-group yahweahcare-rg \
  --plan yahweahcare-plan \
  --name yahweahcare-api \
  --runtime "NODE:18-lts" \
  --deployment-source-branch main
```

**Set environment variables on App Service:**

```bash
az webapp config appsettings set \
  --resource-group yahweahcare-rg \
  --name yahweahcare-api \
  --settings \
    DATABASE_URL="postgresql://ycadmin:YourStr0ngP@ssword!@yahweahcare-db.postgres.database.azure.com/neondb?sslmode=require" \
    JWT_SECRET="replace-with-a-long-random-secret-min-32-chars" \
    CORS_ORIGIN="https://yahweahcare.azurestaticapps.net" \
    NODE_ENV="production" \
    PORT="8080" \
    VAPID_PUBLIC_KEY="your-vapid-public-key" \
    VAPID_PRIVATE_KEY="your-vapid-private-key" \
    VAPID_SUBJECT="mailto:admin@yahweahcare.com.au" \
    RESEND_API_KEY="your-resend-api-key"
```

**Set the startup command:**
```bash
az webapp config set \
  --resource-group yahweahcare-rg \
  --name yahweahcare-api \
  --startup-file "node api/server.js"
```

---

### 1.5 Create Azure Static Web Apps for the Frontend

```bash
az staticwebapp create \
  --resource-group yahweahcare-rg \
  --name yahweahcare \
  --location eastasia \
  --source "https://github.com/hostsubho/yahweahcare-tkt-mgmt" \
  --branch main \
  --app-location "frontend" \
  --output-location "." \
  --login-with-github
```

This command opens a browser to authorise GitHub. After that, Azure automatically creates a GitHub Actions workflow in your repo.

**Set the API URL env variable for Static Web Apps:**
```bash
az staticwebapp appsettings set \
  --name yahweahcare \
  --setting-names \
    REACT_APP_API_URL="https://yahweahcare-api.azurewebsites.net"
```

---

## Phase 2 — Code Changes Required

### 2.1 Frontend — point API calls at Azure backend

In `frontend/src/app-source.jsx`, find the `HRMS_API` constant and make it environment-aware:

```js
// Before (hardcoded Vercel URL)
const HRMS_API = 'https://yahweahcare-tkt-mgmt-hx48.vercel.app/api';

// After (reads from build-time env, falls back to relative /api for same-origin)
const HRMS_API = window.__API_URL__ || '/api';
```

Then in `frontend/index.html`, inject it before the app loads:
```html
<script>
  window.__API_URL__ = 'https://yahweahcare-api.azurewebsites.net/api';
</script>
```

Or better — keep it in `staticwebapp.config.json` (see Phase 3).

### 2.2 Backend — ensure PORT uses environment variable

`backend/server.js` already has:
```js
const PORT = process.env.PORT || 4000;
```
Azure App Service injects `PORT` automatically — no change needed.

### 2.3 Backend — add a web.config for IIS routing (optional)

Azure App Service on Linux doesn't need this, but add a `package.json` `start` script if not already present:

```json
// backend/package.json  — already correct:
"scripts": {
  "start": "node server.js"
}
```

---

## Phase 3 — Config Files to Add to the Repo

### 3.1 `frontend/staticwebapp.config.json`
Routes all non-asset requests to `index.html` (SPA fallback), and proxies `/api/*` to the backend.

### 3.2 `.github/workflows/deploy-backend.yml`
Deploys backend to Azure App Service on every push to `main`.

### 3.3 `.github/workflows/deploy-frontend.yml`
Deploys frontend to Azure Static Web Apps on every push to `main`.

These files are already created in your repo — see the `.github/workflows/` directory.

---

## Phase 4 — GitHub Secrets to Add

Go to: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value | Where to get it |
|---|---|---|
| `AZURE_WEBAPP_PUBLISH_PROFILE` | XML publish profile | Azure Portal → App Service → Get publish profile |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Deployment token | Azure Portal → Static Web App → Manage deployment token |
| `DATABASE_URL` | Azure PostgreSQL connection string | Step 1.2 above |
| `JWT_SECRET` | 32+ char random string | `openssl rand -base64 32` |

---

## Phase 5 — Lock Down Security

### 5.1 Restrict DB to App Service only
```bash
# Get the App Service outbound IPs
az webapp show \
  --resource-group yahweahcare-rg \
  --name yahweahcare-api \
  --query outboundIpAddresses

# Add a firewall rule for each IP
az postgres flexible-server firewall-rule create \
  --resource-group yahweahcare-rg \
  --name yahweahcare-db \
  --rule-name allow-appservice \
  --start-ip-address <ip> \
  --end-ip-address <ip>

# Remove the allow-all rule
az postgres flexible-server firewall-rule delete \
  --resource-group yahweahcare-rg \
  --name yahweahcare-db \
  --rule-name AllowAllAzureServicesAndResourcesWithinAzureIps
```

### 5.2 Enable HTTPS-only on App Service
```bash
az webapp update \
  --resource-group yahweahcare-rg \
  --name yahweahcare-api \
  --https-only true
```

---

## Phase 6 — Verify the Deployment

```bash
# Check backend health
curl https://yahweahcare-api.azurewebsites.net/api/health

# Expected response:
# {"ok":true,"time":"2026-06-24T..."}

# Check frontend is live
open https://yahweahcare.azurestaticapps.net
```

---

## Estimated Monthly Cost (Australia East)

| Service | Tier | Est. Cost/month |
|---|---|---|
| Azure App Service | B1 (Basic) | ~$20 AUD |
| Azure Database for PostgreSQL | Standard_B1ms | ~$25 AUD |
| Azure Static Web Apps | Free tier | $0 |
| Bandwidth (egress) | ~10 GB | ~$2 AUD |
| **Total** | | **~$47 AUD/month** |

> Upgrade App Service to P1v3 (~$80 AUD) and DB to Standard_D2s_v3 (~$120 AUD) for full production load.

---

## Custom Domain (Optional)

```bash
# Point your DNS CNAME to:
#   yahweahcare.azurestaticapps.net  (frontend)
#   yahweahcare-api.azurewebsites.net  (backend)

# Then add the domain in Azure:
az staticwebapp hostname set \
  --name yahweahcare \
  --hostname www.yahweahcare.com.au

az webapp config hostname add \
  --resource-group yahweahcare-rg \
  --webapp-name yahweahcare-api \
  --hostname api.yahweahcare.com.au
```

Azure provisions a free TLS certificate automatically.

---

## Quick Reference — All Azure Resource Names

| Resource | Name |
|---|---|
| Resource Group | `yahweahcare-rg` |
| PostgreSQL Server | `yahweahcare-db` |
| App Service Plan | `yahweahcare-plan` |
| App Service (API) | `yahweahcare-api` |
| Static Web App | `yahweahcare` |
| Location | `australiaeast` (Sydney) |
