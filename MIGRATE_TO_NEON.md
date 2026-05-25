# Migrate Local Postgres → Neon

Move your existing `yahweahcare` database (with the `yc_tkt_mgmt` schema, users, tickets, audit log, etc.) from local PostgreSQL to a Neon serverless Postgres in the cloud.

Takes about **5 minutes**. Zero data loss. Reversible.

---

## Step 1 — Get a Neon connection string (2 min)

1. Sign up at https://console.neon.tech (free, no credit card)
2. Click **Create a project**:
   - **Project name:** `yahwehcare-hrms`
   - **Postgres version:** `16` (matches your local)
   - **Region:** `AWS Asia Pacific 2 (Sydney)` — closest to AU
   - **Database name:** `yahweahcare`
3. After creation, on the dashboard right side you'll see a **Connection string**. Click "Show password" and copy it. It looks like:
   ```
   postgresql://yahweahcare_owner:NPg_xxxxxxxxx@ep-cool-dawn-12345-pooler.ap-southeast-2.aws.neon.tech/yahweahcare?sslmode=require
   ```

## Step 2 — Run the migration script (3 min)

Open Terminal:

```bash
cd ~/Downloads/Yahweahcare/backend-hrms/scripts
chmod +x migrate-to-neon.sh
./migrate-to-neon.sh
```

The script will:

1. ✅ Verify `pg_dump` and `psql` are installed
2. 📝 Ask for your **local** Postgres details (defaults to `yahweahcare` on `localhost:5432` as your Mac user)
3. 📝 Ask you to paste the **Neon** connection string
4. 🔍 Test both connections
5. 📊 Show a summary of what's about to be migrated (tables and row counts)
6. ❓ Confirm before doing anything destructive
7. 💾 Dump the `yc_tkt_mgmt` schema with `pg_dump` (saved to `/tmp/yahweahcare-<timestamp>.sql`)
8. ⬆️  Restore it into Neon (strips owner/extension lines that Neon doesn't allow)
9. ✅ **Verify** row counts match table-by-table

Example output:
```
  Table                          | Local      | Neon       | Match?
  -------------------------------+------------+------------+--------
  activity                       |         12 |         12 | ✓
  audit_logs                     |         47 |         47 | ✓
  categories                     |          7 |          7 | ✓
  comments                       |          3 |          3 | ✓
  permissions                    |         25 |         25 | ✓
  priorities                     |          4 |          4 | ✓
  role_permissions               |         78 |         78 | ✓
  roles                          |          5 |          5 | ✓
  sessions                       |          0 |          0 | ✓
  statuses                       |          6 |          6 | ✓
  tickets                        |         29 |         29 | ✓
  users                          |         11 |         11 | ✓

╔════════════════════════════════════════════╗
║  ✅ Migration successful — all rows match  ║
╚════════════════════════════════════════════╝
```

## Step 3 — Point the backend at Neon (1 min)

Update `backend-hrms/.env`:

```bash
cd ~/Downloads/Yahweahcare/backend-hrms

# Backup the current .env
cp .env .env.local-backup

# Edit and replace the DATABASE_URL line — open in your editor or use sed:
sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=<your-neon-connection-string>|" .env
```

Or just open `.env` in any editor and replace the `DATABASE_URL=` line with your Neon connection string.

**Restart the backend:**
```bash
# If npm run dev is already running, Ctrl+C to stop it, then:
npm run dev
```

You should see:
```
✓ HRMS auth service listening on http://localhost:4001
```

The pool will auto-detect Neon's `neon.tech` host and switch to the serverless driver.

## Step 4 — Verify (30 sec)

```bash
curl http://localhost:4001/health
# {"ok":true,"time":"2026-..."}
```

Then open `http://localhost:3000` in the browser and click **Sign in with Microsoft**. You should land on the dashboard with all your existing tickets, staff, audit log entries — everything intact, just now stored in Neon.

---

## What was migrated

The script migrates the entire `yc_tkt_mgmt` schema, which includes:

- ✅ `users` — all staff including Ron Costa, Alex, plus any you added
- ✅ `tickets` — every ticket with status, assignee, priority
- ✅ `comments` — all ticket comments
- ✅ `activity` — full audit trail per ticket
- ✅ `audit_logs` — every login, role change, security event
- ✅ `notifications` — pending email/push notifications
- ✅ `sessions` — active user sessions (you might want to clear these after migration)
- ✅ `roles` + `permissions` + `role_permissions` — full RBAC config
- ✅ `categories`, `priorities`, `statuses` — lookup tables
- ✅ `scheduled_reports` — any configured report schedules
- ✅ `attachments` — file metadata (the actual blobs live separately)
- ✅ All indexes, foreign keys, and the `v_open_tickets` view

The local copy is **not** deleted — it stays as a backup. To remove it after you're confident Neon is working:

```bash
dropdb yahweahcare
```

---

## If something goes wrong

The script captures errors to `/tmp/neon-restore.log`. Common issues:

| Error | Cause | Fix |
|---|---|---|
| `permission denied for schema public` | Neon roles work differently | Already handled by the script (`--no-owner --no-privileges`) |
| `extension "uuid-ossp" does not exist` | We don't use this — false alarm | Already stripped by the script |
| `relation already exists` | Neon already has the schema | Re-run script and answer "y" when asked to replace |
| `connection terminated unexpectedly` | Neon endpoint suspended (cold start) | First request wakes it — wait 30s and retry |
| `pg_dump version mismatch` | Different Postgres major versions | Upgrade local Postgres or use Neon's matching version |

To roll back (point back at local):

```bash
cd ~/Downloads/Yahweahcare/backend-hrms
mv .env.local-backup .env   # restore the original
npm run dev
```

Your local Postgres data is untouched.

---

## Cost after migration

| Tier | Storage | Cost/mo |
|---|---|---|
| **Neon Free** | 0.5 GB, 1 project, 191 compute-hours | **$0** |
| **Neon Launch** | 10 GB, unlimited projects, 300 compute-hours | **~$19 AUD** |
| **Neon Scale** | 50 GB, advanced features | **~$69 AUD** |

For < 100 staff and a normal HRMS workload, the **Free tier is enough** for the first 6-12 months. Neon's auto-suspend (default 5 min idle) means you're typically only charged for active usage on paid tiers.

---

## Configure Neon for production use

After migration, in the Neon console:

1. **Branching** — create a `staging` branch for testing schema changes safely
2. **Auto-suspend** — Settings → Compute → set "Suspend compute after" to 5 min (default) to maximize free tier
3. **Point-in-time restore** — Settings → Recovery → enable if you upgraded to Launch tier
4. **IP allow list** — Settings → IP allow → optionally restrict access to your office/Vercel IPs

---

## Files in this migration

- `backend-hrms/scripts/migrate-to-neon.sh` — the migration script
- `backend-hrms/src/db/pool.ts` — auto-detects Neon URL and switches driver
- `backend-hrms/src/db/schema.sql` — applied as part of migration (via the dump)
- `backend-hrms/.env` — update `DATABASE_URL` here
- This file — the guide

After migration is verified, you can delete the local Postgres database with `dropdb yahweahcare` and stop the local postgres service: `brew services stop postgresql@16`.
