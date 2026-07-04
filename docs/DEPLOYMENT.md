# Yahweh Care — Deployment Guide (GitHub Actions → Azure)

End-to-end production deployment using **GitHub Actions** for CI/CD, **Azure App Service** for hosting, and **Azure Database for PostgreSQL Flexible Server** for the database.

---

## Architecture

```
   GitHub repo  ──push to main──►  GitHub Actions  ──OIDC─►  Azure
                                        │
                                        ├── Run tests + build TS
                                        ├── psql apply schema.sql to Postgres
                                        ├── ts-node seed.ts (idempotent)
                                        ├── az webapp deploy backend  → App Service "yahwehcare-hrms-api"
                                        └── az webapp deploy frontend → App Service "yahwehcare-hrms-web"
                                                                              │
                                                                              ▼
                                                              Azure Front Door + WAF
                                                                              │
                                                                              ▼
                                                                  https://hrms.yahwehcare.com.au
```

---

## Part 1 — Create the GitHub repository

If you already have an empty `Subho06031991/yahwehcare` repo and just need to push the code:

```bash
cd ~/Downloads/Yahweahcare
chmod +x .github/scripts/bootstrap-repo.sh
./.github/scripts/bootstrap-repo.sh
```

The script will:
1. `git init` if needed
2. Create `main` branch
3. Stage everything (respecting `.gitignore`)
4. Configure your git identity
5. Push to the GitHub repo you specify

Or do it manually:

```bash
cd ~/Downloads/Yahweahcare
git init -b main
git config user.name "Ron Mitchell"
git config user.email "ron@wmxsolutions.com.au"
git add .
git commit -m "Initial commit: Yahweh Care HRMS"
gh repo create Subho06031991/yahwehcare-hrms --private --source=. --remote=origin
git push -u origin main
```

> You'll need [GitHub CLI (`gh`)](https://cli.github.com/) installed: `brew install gh` then `gh auth login`.

---

## Part 2 — Provision Azure resources (one-time)

You'll create five resources. Open **Azure Cloud Shell** (top-right of portal) or local Azure CLI:

```bash
# 1. Login + select subscription
az login
az account set --subscription "<your-subscription-id>"

# 2. Variables — change these
RG="rg-yahwehcare-hrms-prod"
LOC="australiaeast"               # closest Azure region to AU
APP_API="yahwehcare-hrms-api"     # must be globally unique
APP_WEB="yahwehcare-hrms-web"
DB_SERVER="yahwehcare-pg-prod"    # globally unique
DB_NAME="yahweahcare"
DB_ADMIN="ycadmin"
DB_PASSWORD="$(openssl rand -base64 24)"
PLAN="asp-yahwehcare-hrms"

# 3. Resource group
az group create -n $RG -l $LOC

# 4. App Service plan (Linux, B2 — burstable, cheap)
az appservice plan create -g $RG -n $PLAN \
  --sku B2 --is-linux

# 5. Backend Web App
az webapp create -g $RG -p $PLAN -n $APP_API \
  --runtime "NODE:20-lts"
az webapp config set -g $RG -n $APP_API \
  --always-on true --http20-enabled true --min-tls-version 1.2
az webapp config appsettings set -g $RG -n $APP_API --settings \
  SCM_DO_BUILD_DURING_DEPLOYMENT=true \
  WEBSITE_NODE_DEFAULT_VERSION=~20

# 6. Frontend Web App
az webapp create -g $RG -p $PLAN -n $APP_WEB \
  --runtime "NODE:20-lts"
az webapp config set -g $RG -n $APP_WEB \
  --always-on true --http20-enabled true --min-tls-version 1.2

# 7. PostgreSQL Flexible Server (Burstable B1ms — ~$15/mo)
az postgres flexible-server create -g $RG -n $DB_SERVER \
  --location $LOC \
  --tier Burstable --sku-name Standard_B1ms \
  --storage-size 32 \
  --version 16 \
  --admin-user $DB_ADMIN \
  --admin-password "$DB_PASSWORD" \
  --public-access 0.0.0.0    # allow Azure services; restrict later
az postgres flexible-server db create -g $RG -s $DB_SERVER -d $DB_NAME

# 8. Key Vault for secrets
KV="kv-yahwehcare-hrms"
az keyvault create -g $RG -n $KV -l $LOC \
  --enable-rbac-authorization true

# 9. Save the secrets you'll need
DB_HOST="$DB_SERVER.postgres.database.azure.com"
DATABASE_URL="postgresql://$DB_ADMIN:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME?sslmode=require"
JWT_SECRET="$(openssl rand -hex 32)"
SESSION_SECRET="$(openssl rand -hex 32)"

az keyvault secret set --vault-name $KV --name DATABASE-URL --value "$DATABASE_URL"
az keyvault secret set --vault-name $KV --name JWT-SECRET    --value "$JWT_SECRET"
az keyvault secret set --vault-name $KV --name SESSION-SECRET --value "$SESSION_SECRET"

echo "Save these — you'll need them for GitHub secrets:"
echo "AZURE_TENANT_ID=$(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID=$(az account show --query id -o tsv)"
echo "DB password: $DB_PASSWORD"
```

---

## Part 3 — Wire App Service to Key Vault + set env vars

Grant the Web Apps' managed identities access to Key Vault, then reference the secrets:

```bash
# Backend
az webapp identity assign -g $RG -n $APP_API
API_PRINCIPAL=$(az webapp identity show -g $RG -n $APP_API --query principalId -o tsv)
az role assignment create --role "Key Vault Secrets User" \
  --assignee $API_PRINCIPAL \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RG/providers/Microsoft.KeyVault/vaults/$KV"

# Then set the env vars on the backend App Service
KV_BASE="https://$KV.vault.azure.net/secrets"
az webapp config appsettings set -g $RG -n $APP_API --settings \
  NODE_ENV=production \
  PORT=8080 \
  BACKEND_URL="https://$APP_API.azurewebsites.net" \
  FRONTEND_URL="https://$APP_WEB.azurewebsites.net" \
  COOKIE_SECURE=true \
  COOKIE_SAMESITE=lax \
  COOKIE_DOMAIN=.yahwehcare.com.au \
  ALLOWED_EMAIL_DOMAINS="yahwehcare.com.au,yahwehpc.com.au" \
  AZURE_REDIRECT_URI="https://$APP_API.azurewebsites.net/auth/microsoft/callback" \
  AZURE_POST_LOGOUT_REDIRECT_URI="https://$APP_WEB.azurewebsites.net/auth/logged-out" \
  AZURE_SCOPES="openid profile email User.Read" \
  DATABASE_URL="@Microsoft.KeyVault(SecretUri=$KV_BASE/DATABASE-URL/)" \
  JWT_SECRET="@Microsoft.KeyVault(SecretUri=$KV_BASE/JWT-SECRET/)" \
  SESSION_SECRET="@Microsoft.KeyVault(SecretUri=$KV_BASE/SESSION-SECRET/)" \
  AZURE_CLIENT_ID="@Microsoft.KeyVault(SecretUri=$KV_BASE/AZURE-CLIENT-ID/)" \
  AZURE_CLIENT_SECRET="@Microsoft.KeyVault(SecretUri=$KV_BASE/AZURE-CLIENT-SECRET/)" \
  AZURE_TENANT_ID="@Microsoft.KeyVault(SecretUri=$KV_BASE/AZURE-TENANT-ID/)"
```

> Push your Entra app's `clientId`, `clientSecret`, and `tenantId` into Key Vault too:
> ```bash
> az keyvault secret set --vault-name $KV --name AZURE-CLIENT-ID     --value "<your-app-client-id>"
> az keyvault secret set --vault-name $KV --name AZURE-CLIENT-SECRET --value "<the-secret-value>"
> az keyvault secret set --vault-name $KV --name AZURE-TENANT-ID     --value "<your-tenant-id>"
> ```

---

## Part 4 — Set up OIDC for passwordless GitHub Actions → Azure auth

This is the **modern, secret-free** way to authenticate from GitHub Actions to Azure. No client secrets in GitHub.

```bash
APP_NAME="github-actions-yahwehcare-hrms"
# 1. Create an AAD app for GitHub Actions
APP_ID=$(az ad app create --display-name $APP_NAME --query appId -o tsv)
SP_ID=$(az ad sp create --id $APP_ID --query id -o tsv)

# 2. Grant Contributor on the resource group
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
az role assignment create --role Contributor \
  --assignee $APP_ID \
  --scope /subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RG

# 3. Create the federated credential trusting your GitHub repo's main branch
GITHUB_REPO="Subho06031991/yahwehcare-hrms"      # ← your repo
az ad app federated-credential create --id $APP_ID --parameters '{
  "name":     "github-main",
  "issuer":   "https://token.actions.githubusercontent.com",
  "subject":  "repo:'"$GITHUB_REPO"':ref:refs/heads/main",
  "audiences":["api://AzureADTokenExchange"]
}'

echo "AZURE_CLIENT_ID = $APP_ID"
echo "AZURE_TENANT_ID = $(az account show --query tenantId -o tsv)"
echo "AZURE_SUBSCRIPTION_ID = $SUBSCRIPTION_ID"
```

---

## Part 5 — Add GitHub repo secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value |
|---|---|
| `AZURE_CLIENT_ID`        | The `APP_ID` from Part 4 |
| `AZURE_TENANT_ID`        | Your AAD tenant ID |
| `AZURE_SUBSCRIPTION_ID`  | Your subscription ID |
| `PROD_DATABASE_URL`      | `postgresql://ycadmin:<password>@yahwehcare-pg-prod.postgres.database.azure.com:5432/yahweahcare?sslmode=require` |
| `PROD_BACKEND_URL`       | `https://yahwehcare-hrms-api.azurewebsites.net` |

Quick CLI version:

```bash
gh secret set AZURE_CLIENT_ID       --body "$APP_ID"        --repo $GITHUB_REPO
gh secret set AZURE_TENANT_ID       --body "$(az account show --query tenantId -o tsv)" --repo $GITHUB_REPO
gh secret set AZURE_SUBSCRIPTION_ID --body "$SUBSCRIPTION_ID" --repo $GITHUB_REPO
gh secret set PROD_DATABASE_URL     --body "$DATABASE_URL"  --repo $GITHUB_REPO
gh secret set PROD_BACKEND_URL      --body "https://$APP_API.azurewebsites.net" --repo $GITHUB_REPO
```

---

## Part 6 — Update Microsoft Entra app for production URLs

In the [Entra portal](https://entra.microsoft.com) → your HRMS app → **Authentication**:

1. Add a **Redirect URI** (type: Web):
   `https://yahwehcare-hrms-api.azurewebsites.net/auth/microsoft/callback`
2. Update the **Front-channel logout URL**:
   `https://yahwehcare-hrms-api.azurewebsites.net/auth/logged-out`
3. **Save**

Keep the localhost URI too if you want local dev to continue working.

---

## Part 7 — First deploy

Just push to `main`:

```bash
git add -A
git commit -m "Wire up CI/CD"
git push origin main
```

GitHub Actions will:
1. Build and test the backend (`ci` job)
2. Apply the PostgreSQL schema (`psql ... -f schema.sql`)
3. Seed roles, permissions, and the two bootstrap Super Admins
4. Deploy backend code to `yahwehcare-hrms-api`
5. Deploy frontend to `yahwehcare-hrms-web`
6. Probe `/health` to confirm everything's up

Watch progress at: `https://github.com/Subho06031991/yahwehcare-hrms/actions`

---

## Part 8 — Custom domain + SSL (optional but recommended)

```bash
# Map https://hrms.yahwehcare.com.au → frontend
az webapp config hostname add -g $RG --webapp-name $APP_WEB \
  --hostname hrms.yahwehcare.com.au

# Map https://api.hrms.yahwehcare.com.au → backend
az webapp config hostname add -g $RG --webapp-name $APP_API \
  --hostname api.hrms.yahwehcare.com.au

# Auto-provision free TLS certs (App Service Managed Certificate)
az webapp config ssl create -g $RG --name $APP_WEB --hostname hrms.yahwehcare.com.au
az webapp config ssl create -g $RG --name $APP_API --hostname api.hrms.yahwehcare.com.au

# Bind the certs
THUMB_WEB=$(az webapp config ssl list -g $RG --query "[?name=='hrms.yahwehcare.com.au'].thumbprint" -o tsv)
THUMB_API=$(az webapp config ssl list -g $RG --query "[?name=='api.hrms.yahwehcare.com.au'].thumbprint" -o tsv)
az webapp config ssl bind -g $RG --name $APP_WEB --certificate-thumbprint $THUMB_WEB --ssl-type SNI
az webapp config ssl bind -g $RG --name $APP_API --certificate-thumbprint $THUMB_API --ssl-type SNI
```

Then **also** update:
- The Entra app's Redirect URI to `https://api.hrms.yahwehcare.com.au/auth/microsoft/callback`
- App Service environment variables: `BACKEND_URL`, `FRONTEND_URL`, `AZURE_REDIRECT_URI`, `AZURE_POST_LOGOUT_REDIRECT_URI`
- GitHub secret `PROD_BACKEND_URL`

---

## Part 9 — Production hardening checklist

- [ ] **HTTPS only**: `az webapp update -g $RG -n $APP_API --https-only true` (and same for web)
- [ ] **Min TLS version**: 1.2 (set above)
- [ ] **App Service IP restriction**: optionally restrict admin endpoints to your office IP
- [ ] **Postgres firewall**: remove `0.0.0.0` rule; add only Azure-internal traffic + a VNet integration
- [ ] **Backup**: Postgres has automatic daily backups, 7-day retention by default — bump to 30 days
- [ ] **Monitor**: enable Application Insights on both App Services
- [ ] **Alerts**: 5xx error rate, failed login spike, high CPU/memory
- [ ] **Secrets rotation**: schedule Entra client secret rotation in your calendar (6-12 months)
- [ ] **Conditional Access**: in Entra, require MFA for app sign-ins
- [ ] **Branch protection**: GitHub → Settings → Branches → require PR review on `main`

---

## Part 10 — Rollback

Two options if a deploy goes bad:

**Quick** — App Service deployment slots:

```bash
# Create a staging slot
az webapp deployment slot create -g $RG -n $APP_API --slot staging
# Deploy to staging first, smoke test, then swap
az webapp deployment slot swap -g $RG -n $APP_API --slot staging --target-slot production
# If staging is bad, just don't swap. If you already swapped, swap back.
```

(Update `deploy-backend.yml`'s `azure/webapps-deploy` to target `--slot staging` and add a swap step.)

**Standard** — revert + re-push:

```bash
git revert HEAD
git push origin main
# Pipeline redeploys automatically
```

---

## Costs (Australia East, approx AUD/month)

| Resource | SKU | Approx cost |
|---|---|---|
| App Service plan B2 (both apps share) | Linux | ~$70 |
| PostgreSQL Flexible Server | Burstable B1ms, 32GB | ~$25 |
| Key Vault | First 10,000 ops/month | <$1 |
| Application Insights | First 5GB/month | Free |
| GitHub Actions | 2,000 min/mo private | Free |
| **Total** | | **~$95/mo** |

Bump to **App Service P1v3** + **GeneralPurpose D2s** Postgres for production-grade: ~$300/mo.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy succeeds but app crashes | Missing env var | Check `az webapp log tail -g $RG -n $APP_API` |
| `AADSTS50011 redirect URI mismatch` | Entra URI doesn't match | Add the App Service URL to Entra's Redirect URIs |
| `ECONNREFUSED 127.0.0.1:5432` in logs | App can't reach Postgres | Verify `DATABASE_URL` and Postgres firewall rules |
| `Error: invalid_client` | Wrong `AZURE_CLIENT_SECRET` | Regenerate secret in Entra → update Key Vault |
| Health probe fails after deploy | App still starting | App Service "always on" must be enabled + cold start can take 30-60s |
| GitHub Actions `Error: Unable to find subscription` | OIDC federated credential wrong | Check the `subject` claim matches `repo:OWNER/REPO:ref:refs/heads/main` |

---

## Files in this repo related to deployment

- `.github/workflows/deploy-backend.yml` — Backend CI/CD
- `.github/workflows/deploy-frontend.yml` — Frontend CI/CD
- `.github/workflows/codeql.yml` — Security scanning
- `.github/dependabot.yml` — Automated dependency updates
- `YCTMBackend/Dockerfile` — Container image (alternative deploy path via ACR + Container Apps)
- `YCTMBackend/docker-compose.yml` — Local stack for dev
- This file — Step-by-step deployment guide
