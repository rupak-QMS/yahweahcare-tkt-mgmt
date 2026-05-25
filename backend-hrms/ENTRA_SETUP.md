# Microsoft Entra ID — Quick Setup Cheat Sheet

Step-by-step app registration for the HRMS auth service. Takes 10-15 min.

## 1. Register the application

1. Sign in to https://entra.microsoft.com as a Global / Cloud Application Administrator.
2. **Identity** → **Applications** → **App registrations** → **+ New registration**.
3. Fill in:
   - **Name:** `Yahwehcare HRMS`
   - **Supported account types:**
     `Accounts in this organizational directory only` (single-tenant) — strongly recommended
   - **Redirect URI:** Platform = `Web`,
     URI = `https://api.yourdomain.com/auth/microsoft/callback`
     (Also add `http://localhost:4001/auth/microsoft/callback` for local dev.)
4. Click **Register**.

Copy these from the **Overview** page:
| Field | Goes into |
|---|---|
| Application (client) ID  | `AZURE_CLIENT_ID` |
| Directory (tenant) ID    | `AZURE_TENANT_ID` |

## 2. Create a client secret

1. Left nav → **Certificates & secrets** → **Client secrets** → **+ New client secret**.
2. Description: `hrms-prod-secret`. Expires: 6 or 12 months.
3. **Copy the Value column** immediately (not the Secret ID).
4. Paste into `AZURE_CLIENT_SECRET`.

> ⚠️ Microsoft only displays the Value once. If you lose it, generate a new one and rotate.

## 3. API permissions

1. Left nav → **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**.
2. Tick:
   - `openid`
   - `profile`
   - `email`
   - `offline_access` *(for refresh token)*
   - `User.Read` *(to fetch /me from Graph)*
3. Click **Grant admin consent for <your tenant>**.
4. All entries should now show a green "Granted" status.

## 4. Token configuration (optional but recommended)

1. Left nav → **Token configuration** → **+ Add optional claim** → **ID** token.
2. Add: `email`, `family_name`, `given_name`, `preferred_username`.
3. Some claims may need `profile` consent — accept the prompt.

## 5. Authentication / logout

1. Left nav → **Authentication**.
2. Under **Front-channel logout URL** add:
   `https://api.yourdomain.com/auth/logged-out`
3. Make sure **Implicit grant** is **off** (we use auth code + PKCE).
4. **Save**.

## 6. Restrict who can sign in (optional)

1. **Enterprise applications** → find your app → **Properties**.
2. Set **Assignment required?** to **Yes**.
3. **Users and groups** → assign your `Yahwehcare Employees` group.

## 7. Conditional Access (recommended for production)

Create a policy that requires MFA for users assigned to the HRMS app:
1. **Protection** → **Conditional Access** → **+ New policy**.
2. Name: `Require MFA — Yahwehcare HRMS`.
3. Assignments → **Users**: All users (exclude break-glass accounts!).
4. Assignments → **Cloud apps**: select your `Yahwehcare HRMS` app.
5. Access controls → **Grant** → require MFA.
6. Enable policy.

## 8. Verify locally

```bash
cp .env.example .env
# Paste the 3 values
npm install
npm run init-db
npm run seed
npm run dev
# Browser: http://localhost:4001/auth/microsoft
```

You should:
1. Be redirected to `login.microsoftonline.com`.
2. Sign in with your org account (or test account `it@yahwehcare.com.au`).
3. Land back on `http://localhost:3000/dashboard` (assuming your frontend is running).

Check the audit log:
```sql
SELECT created_at, action, actor_email, success, metadata
FROM yc_tkt_mgmt.audit_logs
ORDER BY created_at DESC LIMIT 10;
```

You should see a `login.success` entry.

## Common errors & fixes

| Microsoft error | Fix |
|---|---|
| `AADSTS50011 The redirect URI specified in the request does not match` | Add the exact URL (including port + scheme) to **Authentication → Redirect URIs**. |
| `AADSTS65001 The user or administrator has not consented to use the application` | Click **Grant admin consent** on the API permissions page. |
| `AADSTS50105 User is not assigned to a role for the application` | You enabled assignment-required; add the user/group under **Enterprise applications → Users and groups**. |
| `AADSTS700016 Application not found in the directory` | `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` mismatch — double-check the values. |
| `invalid_client` | `AZURE_CLIENT_SECRET` is wrong — you may have copied the Secret ID instead of the Value, or the secret expired. |
