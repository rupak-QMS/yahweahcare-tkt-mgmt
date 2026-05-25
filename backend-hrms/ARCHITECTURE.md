# Architecture

## 1. High-level system

```
                    ┌──────────────────────────────────────────┐
                    │           Microsoft Entra ID             │
                    │  (Identity Provider — OAuth 2.0 / OIDC)  │
                    └──────────────────┬───────────────────────┘
                                       │ SSO + Graph API
                                       │
        ┌────────────────────┐         │         ┌─────────────────────────┐
        │   Browser (User)   │◄────────┼────────►│   Yahwehcare HRMS API   │
        │ Next.js + AuthCtx  │  Cookies│ JWT     │  Node.js + Express + TS │
        └──────────┬─────────┘         │         └────────────┬────────────┘
                   │                                          │
                   │ HTTPS only                               │ TLS
                   │                                          │
                   ▼                                          ▼
        ┌──────────────────────┐               ┌────────────────────────────┐
        │  Azure Front Door    │               │  Azure Database for        │
        │  + WAF + custom DNS  │               │  PostgreSQL (yc_tkt_mgmt)  │
        └──────────────────────┘               └────────────────────────────┘
```

## 2. Login sequence

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant FE as Next.js Frontend
    participant API as HRMS API
    participant ENTRA as Microsoft Entra ID
    participant GRAPH as Microsoft Graph
    participant DB as PostgreSQL

    User->>FE: Click "Sign in with Microsoft"
    FE->>API: GET /auth/microsoft?remember=1
    API->>API: generate state + PKCE verifier/challenge
    API-->>User: 302 → login.microsoftonline.com (challenge=S256)
    User->>ENTRA: authenticate (with MFA)
    ENTRA-->>User: 302 → /auth/microsoft/callback?code=…&state=…
    User->>API: GET /auth/microsoft/callback
    API->>API: verify state matches stored
    API->>ENTRA: POST /token (auth code + PKCE verifier)
    ENTRA-->>API: id_token + access_token + refresh_token
    API->>GRAPH: GET /me (with access_token)
    GRAPH-->>API: user profile { id, displayName, mail, jobTitle, department }
    API->>GRAPH: GET /me/photo/$value
    GRAPH-->>API: photo bytes
    API->>API: validate email domain (yahwehcare/yahwehpc)
    API->>DB: SELECT or INSERT user (sync from Graph)
    API->>API: mint access JWT (15m) + refresh JWT (30d)
    API->>DB: INSERT INTO yc_tkt_mgmt.sessions (refresh hash, jti)
    API->>DB: INSERT INTO yc_tkt_mgmt.audit_logs (login.success)
    API-->>User: 302 → /dashboard + Set-Cookie: yc_access, yc_refresh
    User->>FE: GET /dashboard (cookies attached)
    FE->>API: GET /auth/me
    API-->>FE: user + permissions
```

## 3. Token rotation

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant API as HRMS API
    participant DB as PostgreSQL

    FE->>API: POST /auth/refresh (yc_refresh cookie)
    API->>API: verify JWT signature + expiry
    API->>DB: SELECT session WHERE id = sid
    API->>API: bcrypt.compare(token, refresh_token_hash)
    Note over API: ❌ Mismatch → revoke session (theft suspected)
    API->>API: sign new access + new refresh
    API->>DB: UPDATE session SET refresh_hash = NEW, jti = NEW
    API-->>FE: Set-Cookie (new access + refresh)
```

## 4. RBAC decision tree

```
        Request
           │
           ▼
   ┌────────────────┐
   │  requireAuth   │
   │  (JWT + sess.) │
   └───────┬────────┘
           │ req.auth populated
           ▼
   ┌────────────────────────────────┐
   │ requireRole / requirePermission│
   └───────┬────────────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
   allow      deny + audit
           (403 forbidden)
```

## 5. ER diagram

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│   roles     │1───*───<│ role_permissions │>───*───1│ permissions │
└──────┬──────┘         └──────────────────┘         └─────────────┘
       │ 1
       │
       │ *
┌──────┴──────────────┐         ┌──────────────┐
│       users         │1───*───<│   sessions   │
│  (yc_tkt_mgmt)      │         └──────────────┘
│ ─────────────────── │
│ id, email, name,    │
│ role_id,            │1───*───<┐
│ microsoft_id,       │         │
│ tenant_id,          │   ┌─────┴────────┐
│ system_created,     │   │  audit_logs  │
│ bootstrap_admin,    │   └──────────────┘
│ active, …           │
└─────────────────────┘   ┌──────────────┐
                          │ failed_logins│  ◄ by IP / email
                          └──────────────┘
```

## 6. Deployment topology (Azure)

```
                       ┌────────────────────┐
                       │ Azure Front Door + │  ◄ HTTPS, WAF, custom domain
                       │  WAF policy        │
                       └─────────┬──────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
      ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
      │ App Service  │   │ App Service  │   │ App Service  │
      │  (West US)   │   │ (East US 2)  │   │  (UK South)  │
      │  Hot         │   │ Standby      │   │ Standby      │
      └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
             │                  │                  │
             └──────────────────┼──────────────────┘
                                │ Private endpoint
                                ▼
                  ┌──────────────────────────────┐
                  │ Azure DB for PostgreSQL FS   │
                  │ (yc_tkt_mgmt schema)         │
                  │ + read replica (different AZ)│
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ Azure Key Vault              │
                  │ (JWT_SECRET, CLIENT_SECRET,  │
                  │  DATABASE_URL, ...)          │
                  └──────────────────────────────┘
```

## 7. Security posture summary

| Layer | Controls |
|---|---|
| Network | Azure Front Door WAF, IP allowlist for admin endpoints, private endpoints for DB |
| Transport | TLS 1.2+, HSTS, secure cookies in production |
| AuthN | Microsoft Entra ID SSO, optional MFA via Conditional Access, PKCE, state |
| AuthZ | RBAC (5 roles), permission-level gates, audited role changes, super-admin protection |
| Session | HTTP-only/Secure/SameSite cookies, JWT with `jti`, refresh rotation, theft detection, inactivity timeout |
| Data | Encrypted at rest (Azure storage), TLS to DB, schema isolation (`yc_tkt_mgmt`) |
| Observability | Audit log table, Application Insights, alerts on anomalous login.failed rate |
| DR | Daily backups, PITR, geo-redundant storage, multi-region deployment |
```
