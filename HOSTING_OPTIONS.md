# Cost-Effective Hosting Options for Yahweh Care HRMS

A practical comparison of where to host this app cheaply, with full deploy instructions for the top picks. All options support Microsoft Entra SSO without modification.

---

## TL;DR — three recommended setups

| # | Stack | Cost/mo AUD | Best for |
|---|---|---:|---|
| 1 | **Hetzner Cloud + Cloudflare Tunnel** | **~$8** | Best value. 2 vCPU + 4 GB RAM. Recommended. |
| 2 | **Oracle Cloud Always Free** | **$0** | Truly free forever. 4 ARM cores + 24 GB RAM. |
| 3 | **Railway** | **~$8** | Easiest. `git push` → deployed. Includes managed Postgres. |

Everything below is for self-managed VPS deploys. If you want managed PaaS, scroll to **Railway** or **Render**.

---

## Option 1 — Hetzner Cloud + Cloudflare Tunnel (RECOMMENDED — ~$8/mo)

### Why this combo
- **Hetzner CX22** = 2 vCPU + 4 GB RAM + 40 GB SSD + 20 TB traffic — **€4.51/mo (~$7.50 AUD)**
- **Cloudflare Tunnel** = free HTTPS, free DDoS protection, free DNS, free CDN — no need to open ports or buy SSL
- Postgres runs in Docker alongside the app — no extra cost
- Total: just the Hetzner VPS

### Setup (30 min, one-time)

#### 1. Create the server

1. Sign up at https://www.hetzner.com/cloud
2. **Add Server** → choose:
   - Location: **Helsinki** or **Falkenstein** (~250-280 ms to AU; Cloudflare CDN masks the latency for static content)
   - Image: **Ubuntu 24.04**
   - Type: **CX22** (€4.51/mo) — 2 vCPU / 4 GB RAM / 40 GB
   - SSH key: paste your `~/.ssh/id_rsa.pub`
3. Click **Create & Buy Now**. Note the public IPv4.

#### 2. Lock the server down

SSH in and run:

```bash
ssh root@<your-ip>

# Update + install Docker
apt update && apt upgrade -y
apt install -y docker.io docker-compose-plugin ufw fail2ban
systemctl enable --now docker

# Firewall: only allow SSH
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw enable
# Cloudflare Tunnel doesn't need open ports — outbound only.

# Create a non-root user
adduser --gecos "" yahweh
usermod -aG docker yahweh
mkdir -p /home/yahweh/.ssh
cp ~/.ssh/authorized_keys /home/yahweh/.ssh/
chown -R yahweh:yahweh /home/yahweh/.ssh
chmod 700 /home/yahweh/.ssh

# Disable root SSH login
sed -i 's/^PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# Switch to the user
su - yahweh
```

#### 3. Clone the repo and configure

```bash
cd ~
git clone https://github.com/Subho06031991/yahwehcare-hrms.git
cd yahwehcare-hrms/backend-hrms
cp .env.example .env

# Generate strong secrets
JWT=$(openssl rand -hex 32)
SESSION=$(openssl rand -hex 32)
DB_PASS=$(openssl rand -base64 24)

# Edit .env — replace placeholders with real values
cat > .env <<EOF
NODE_ENV=production
PORT=4001
BACKEND_URL=https://api.hrms.yahwehcare.com.au
FRONTEND_URL=https://hrms.yahwehcare.com.au
DATABASE_URL=postgresql://yahweh:$DB_PASS@postgres:5432/yahweahcare

JWT_SECRET=$JWT
SESSION_SECRET=$SESSION
COOKIE_DOMAIN=.yahwehcare.com.au
COOKIE_SECURE=true
COOKIE_SAMESITE=lax

# From your Microsoft Entra app
AZURE_CLIENT_ID=<paste-from-azure-portal>
AZURE_CLIENT_SECRET=<paste-from-azure-portal>
AZURE_TENANT_ID=<paste-from-azure-portal>
AZURE_REDIRECT_URI=https://api.hrms.yahwehcare.com.au/auth/microsoft/callback
AZURE_POST_LOGOUT_REDIRECT_URI=https://hrms.yahwehcare.com.au/auth/logged-out
AZURE_SCOPES=openid profile email User.Read

ALLOWED_EMAIL_DOMAINS=yahwehcare.com.au,yahwehpc.com.au
EOF

# Tighten .env permissions — secrets live here
chmod 600 .env
```

#### 4. Update docker-compose.yml to use a stable password

Edit `~/yahwehcare-hrms/backend-hrms/docker-compose.yml`:

```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: yahweahcare
      POSTGRES_USER: yahweh
      POSTGRES_PASSWORD: ${DB_PASS}      # from .env via shell
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks: [internal]

  hrms-auth:
    build: .
    restart: unless-stopped
    env_file: .env
    networks: [internal]
    depends_on: [postgres]

  frontend:
    image: node:20-alpine
    restart: unless-stopped
    working_dir: /app
    volumes: ['../frontend:/app:ro']
    command: ["node", "server.js"]
    networks: [internal]

volumes:
  pgdata:

networks:
  internal:
    driver: bridge
```

#### 5. Bring it up

```bash
export DB_PASS=$DB_PASS   # use the value from step 3
docker compose up -d --build
docker compose logs -f hrms-auth   # watch it start

# In another shell, apply schema + seed
docker compose exec hrms-auth npm run init-db
docker compose exec hrms-auth npm run seed
```

You should see:
```
✓ Schema applied
✓ 5 roles upserted
✓ 25 permissions upserted
✓ Ron Costa (it@yahwehcare.com.au) — bootstrap super admin
✓ Alex (alex@yahwehpc.com.au) — bootstrap super admin
```

#### 6. Set up Cloudflare Tunnel (free HTTPS + DNS)

1. Sign up at https://dash.cloudflare.com (free)
2. Add your domain `yahwehcare.com.au` → update nameservers at your registrar (one-time, 1-24 hrs propagation)
3. Go to **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**
4. Name: `yahwehcare-hrms`, choose **Cloudflared**, copy the install command
5. SSH into your Hetzner server and run the command shown (something like `docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <long-token>`)
6. In Cloudflare dashboard, add **two Public Hostnames** for the tunnel:
   - `hrms.yahwehcare.com.au` → `http://frontend:3000`
   - `api.hrms.yahwehcare.com.au` → `http://hrms-auth:4001`
7. Cloudflare auto-provisions a TLS certificate for each. DNS records are added for you.

Add cloudflared to docker-compose so it restarts with the rest:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token <YOUR_TUNNEL_TOKEN>
    networks: [internal]
```

#### 7. Update Microsoft Entra app

In Entra portal → your app → **Authentication**:

- Add redirect URI: `https://api.hrms.yahwehcare.com.au/auth/microsoft/callback`
- Add front-channel logout URL: `https://api.hrms.yahwehcare.com.au/auth/logged-out`

#### 8. Test

Open `https://hrms.yahwehcare.com.au` in your browser. Click **Sign in with Microsoft**. Done.

### Auto-deploy from GitHub

Add a `git pull && docker compose up -d --build` GitHub webhook OR set up a deploy key + a simple `deploy.sh`:

```bash
# On the server
cat > ~/deploy.sh <<'EOF'
#!/bin/bash
set -e
cd ~/yahwehcare-hrms
git pull
cd backend-hrms
docker compose up -d --build
docker compose exec -T hrms-auth npm run init-db
docker compose exec -T hrms-auth npm run seed
echo "✓ Deployed"
EOF
chmod +x ~/deploy.sh
```

Then add a GitHub Actions step to SSH into the server and run it:

```yaml
- name: Deploy
  uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.SERVER_IP }}
    username: yahweh
    key: ${{ secrets.SSH_PRIVATE_KEY }}
    script: ./deploy.sh
```

### Backups

Daily Postgres dump to local disk (and optionally an S3-compatible bucket like Backblaze B2 — $0.005/GB):

```bash
cat > ~/backup.sh <<'EOF'
#!/bin/bash
DIR=~/backups
mkdir -p $DIR
docker compose -f ~/yahwehcare-hrms/backend-hrms/docker-compose.yml \
  exec -T postgres pg_dump -U yahweh yahweahcare \
  | gzip > $DIR/yahweahcare-$(date +%Y%m%d).sql.gz
# Keep last 30 days
find $DIR -name "yahweahcare-*.sql.gz" -mtime +30 -delete
EOF
chmod +x ~/backup.sh
# Schedule daily at 03:00
(crontab -l 2>/dev/null; echo "0 3 * * * ~/backup.sh") | crontab -
```

For offsite, add a `rclone copy` line at the end pointing to Backblaze B2 (€0.05/GB/mo).

---

## Option 2 — Oracle Cloud Always Free ($0 forever)

Oracle's "Always Free" tier is the most generous in the industry — and it really is free, not a free trial. You get:

- **1× ARM Ampere A1 VM** with up to **4 OCPU + 24 GB RAM** (or split into 4 small VMs)
- **2× AMD VMs** (1/8 OCPU + 1 GB each) — keep these as backup
- **200 GB block storage**
- **10 TB egress per month**
- **Public IPv4**

Equivalent retail price: ~$50-80/mo. Always Free.

**Tradeoffs:**
- Setup is more involved than Hetzner (clunky Oracle UI, capacity issues in popular regions)
- AU regions sometimes have no Free Tier capacity → use Singapore or Tokyo
- ARM-only for the bigger instance — Docker images need ARM64 builds (most do)

### Setup

1. Sign up at https://signup.cloud.oracle.com (needs credit card for verification but won't be charged)
2. Choose home region **Sydney (ap-sydney-1)** or **Singapore (ap-singapore-1)**
3. **Create VM Instance** → **Ampere → A1.Flex**, **4 OCPU / 24 GB RAM**, Ubuntu 22.04 ARM64
4. Add your SSH public key
5. After creation, allow inbound TCP/443 + TCP/80 in the VCN's Security List
6. SSH in and follow the same Docker steps as Hetzner above
7. Cloudflare Tunnel for HTTPS — same as Hetzner

The catch: ARM images. The Yahweh Care backend builds fine on ARM (Node + pg are multi-arch). Just rebuild with:
```bash
docker compose build
```

---

## Option 3 — Railway (~$5-10/mo, easiest)

**Best for:** zero ops, just-want-it-to-work, push-to-deploy.

### How it works
- Push to GitHub → Railway auto-builds + deploys
- Includes managed Postgres (no separate setup)
- TLS, custom domain, env-var management, logs — all in the UI
- Free $5 trial credit, then ~$5-10/mo based on usage

### Setup (10 min)

1. Sign up at https://railway.app (login with GitHub)
2. **New Project → Deploy from GitHub repo → yahwehcare-hrms**
3. Railway detects the Dockerfile in `backend-hrms/` and builds it
4. **+ New → Database → PostgreSQL** — adds a managed Postgres in the same project
5. Railway auto-injects `DATABASE_URL` env var into the backend
6. Set the remaining env vars in **Variables** tab:
   - `JWT_SECRET`, `SESSION_SECRET` (random strings)
   - All `AZURE_*` from your Entra app
   - `FRONTEND_URL`, `BACKEND_URL` (Railway gives you `*.up.railway.app` domains)
   - Custom domain in **Settings → Domains** — paste `hrms.yahwehcare.com.au` (free TLS via Let's Encrypt)
7. **Deploy** — first deploy takes ~3 min
8. Run the seed:
   ```bash
   # Railway CLI
   npm i -g @railway/cli
   railway login
   railway run --service backend-hrms npm run init-db
   railway run --service backend-hrms npm run seed
   ```
9. For the frontend, repeat steps 2-4 but for the `frontend/` folder — Railway will detect `server.js` and run it

**Tradeoff:** US region only (~200 ms to AU). Pair with Cloudflare in front for CDN if you want lower static-asset latency.

---

## Option 4 — Render (~$14/mo)

Similar to Railway but with EU/US regions and a separate free tier:

- **Web Service** (backend-hrms) — $7/mo for "Starter" — 512 MB RAM, always-on
- **PostgreSQL** — $7/mo for "Basic" — 1 GB DB
- **Static Site** (frontend) — free (CDN-cached)

Setup is similar: connect GitHub, Render detects Dockerfile, you set env vars, it deploys.

**Tradeoff:** No Australian region. Free tier sleeps after 15 min idle (paid tiers don't).

---

## Option 5 — DigitalOcean Droplet (Sydney region!)

If you want Australian data residency on a budget:

- **Basic Droplet** — $6/mo — 1 vCPU + 1 GB RAM + 25 GB SSD + 1 TB transfer — Sydney region
- **Managed Postgres** — $15/mo (optional; or self-host on the droplet for free)

Setup is identical to Hetzner. Sydney latency is excellent (<20 ms from anywhere in AU).

---

## Cost summary, all-in

| Setup | Compute | DB | Domain | TLS | Total/mo |
|---|---|---|---|---|---:|
| **Hetzner CX22 + Cloudflare** | €4.51 (~$7.50) | self-hosted (free) | $10/yr (~$0.85/mo) | Free (CF) | **~$8.50** |
| **Oracle Always Free + Cloudflare** | $0 | self-hosted (free) | $10/yr | Free (CF) | **~$0.85** |
| **Railway** | ~$5-7 | included | $10/yr | Free | **~$8** |
| **DigitalOcean (Sydney)** | $6 | $15 managed, or self-host | $10/yr | Free (LE) | **~$6-22** |
| **Render** | $7 | $7 | $10/yr | Free (LE) | **~$15** |
| **Azure App Service B1** | ~$15 | ~$20 managed | $0 (azurewebsites.net) | Free (App Service) | **~$35** |

---

## My recommendation

**For Yahweh Care HRMS specifically:**

1. **If you're comfortable with Linux:** Hetzner CX22 + Cloudflare Tunnel. ~$8/mo, best performance/$, no surprises.
2. **If you want to spend $0:** Oracle Cloud Always Free. Most generous free tier anywhere. AU region available if you can grab capacity.
3. **If you don't want to touch a server:** Railway. ~$8/mo, push-to-deploy, includes managed Postgres.

All three support:
- ✓ Microsoft Entra SSO (just update redirect URIs)
- ✓ Custom domain with TLS
- ✓ The exact same Docker images you already have
- ✓ GitHub Actions deploy from your existing pipeline

If you tell me which one you want to go with, I'll write you the **exact deploy script + GitHub Actions workflow** for that target — no guessing required.
