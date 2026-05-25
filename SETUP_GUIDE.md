# Yahweahcare — Beginner Setup Guide

This guide gets you from zero to a working ticket management system in about 10 minutes. Everything is on your local Mac — no cloud, no servers.

There are **two ways** to use this project:

- **A. Just see the web app** (30 seconds, no installation) — uses your browser's memory for data
- **B. Run the full system with PostgreSQL** (10 minutes) — proper database, real backend API

Most people should do **A first** to confirm the web app looks right, then **B** when ready for the real database.

---

## A. See the web app immediately (no setup)

1. Open **Finder**
2. Navigate to **Downloads → Yahweahcare → frontend**
3. **Double-click** `index.html`
4. It opens in your browser. You'll see a teal login screen.
5. Click **Ron Mitchell (Manager)** to log in. The dashboard appears with sample tickets.

That's it. The app is fully functional in this mode — you can create tickets, comment, change status, view the dashboard. Data is saved in your browser's local storage.

> If you only see a brief loading spinner and nothing happens after 10 seconds: try a different browser (Chrome/Edge/Firefox work best), or check your internet connection — the page loads React from a CDN.

---

## B. Set up the full system with PostgreSQL

This option gives you a real PostgreSQL database storing tickets, plus a Node.js API backend.

### Step-by-step

**Step 1 — Open Terminal**
- Press `Cmd + Space`, type `Terminal`, press Enter.

**Step 2 — Make sure Homebrew is installed**

```
brew --version
```

If you see a version number, you're good. If you see "command not found":

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It will ask for your Mac password (you won't see characters as you type, that's normal). After it finishes, follow the "Next steps" it prints — usually 2-3 lines starting with `echo` that you need to copy into Terminal.

**Step 3 — Make sure Node.js 22 is installed**

```
node --version
```

If you see `v20.x.x` or `v22.x.x`, you're good. If you see `v26.x.x`, you need to switch to v22:

```
brew install node@22
brew unlink node
brew link --overwrite --force node@22
```

If you see "command not found":

```
brew install node@22
brew link --force node@22
```

Confirm:
```
node --version
```
should show `v22.x.x`.

**Step 4 — Run the one-shot setup script**

This installs PostgreSQL, creates the database, installs all dependencies, seeds demo data, starts the API server, and opens the web app — all automatically.

```
cd ~/Downloads/Yahweahcare
chmod +x start.sh
./start.sh
```

You'll see output like:

```
=========================================
  Yahweahcare Ticket System — Setup
=========================================

[1/7] Checking Node.js...
  ✓ Node v22.x.x

[2/7] Checking PostgreSQL...
  PostgreSQL not found. Installing via Homebrew...
  (this takes 2-3 minutes)
  ✓ PostgreSQL installed and started

[3/7] Creating database 'yahweahcare'...
  ✓ Database created

[4/7] Installing backend dependencies...
  added 95 packages

[5/7] Setting up environment...
  ✓ .env created

[6/7] Creating tables and seeding demo data...
  ✓ Schema applied
  ✓ Lookup tables populated
  ✓ 7 users created
  ✓ 12 tickets created
  Seed complete!

[7/7] Starting API server...
=========================================
  ✓ Setup complete!
=========================================

  Backend API: http://localhost:4000
  Frontend:    /Users/subhankarmondal/Downloads/Yahweahcare/frontend/index.html

  Demo login: ron@wmxsolutions.com.au / Yahweycare2026!

  Opening web app in your browser...
  Press Ctrl+C to stop the server

✓ Yahweahcare API running on http://localhost:4000
```

🎉 **Done!** Your browser opens with the web app, and the backend API is running.

> **Leave the Terminal window open** — the server is running inside it. Closing the window stops the server.

---

## Verifying it all works

**Web app** — you should see the teal Yahweahcare login screen. Click a user to log in.

**API health check** — open a new Terminal tab (`Cmd + T`) and run:
```
curl http://localhost:4000/api/health
```
Should return `{"ok":true,"time":"..."}`.

**Login via API** —
```
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ron@wmxsolutions.com.au","password":"Yahweycare2026!"}'
```
Should return a JWT token and Ron's user object.

**See the database directly** —
```
psql yahweahcare
```
Once inside:
```
\dt
SELECT ticket_number, title, priority_id, status_id FROM tickets;
SELECT name, role, department FROM users;
\q
```

---

## Daily use after setup

Once everything is set up, starting the system later is just one command:

```
cd ~/Downloads/Yahweahcare/backend
npm start
```

Then open `frontend/index.html` in your browser.

To stop the server: press `Ctrl + C` in the Terminal window.

---

## Demo login credentials

All seeded users share the password: **`Yahweycare2026!`**

| Email | Role | Department |
|---|---|---|
| ron@wmxsolutions.com.au | Manager | Operations |
| aisha.p@yahweycare.com.au | Agent | IT Service Desk |
| liam.o@yahweycare.com.au | Agent | Facilities |
| mei.t@yahweycare.com.au | Agent | HR & Payroll |
| jack.w@yahweycare.com.au | Staff | Clinical Care |
| priya.s@yahweycare.com.au | Staff | Community Services |
| noah.b@yahweycare.com.au | Staff | Allied Health |

---

## Resetting everything

To wipe the database and start fresh with demo data:

```
cd ~/Downloads/Yahweahcare/backend
npm run reset
```

To completely remove PostgreSQL data:

```
dropdb yahweahcare
createdb yahweahcare
cd ~/Downloads/Yahweahcare/backend
npm run init-db
npm run seed
```

---

## Troubleshooting

### "command not found: brew"
Homebrew isn't installed. Run the install command from Step 2.

### "command not found: node"
Node.js isn't installed. Run `brew install node@22`.

### "command not found: psql"
PostgreSQL isn't installed. The setup script will install it for you. Or manually:
```
brew install postgresql@16
brew services start postgresql@16
```

### "could not connect to server" / "connection refused"
PostgreSQL isn't running:
```
brew services start postgresql@16
```

### "database 'yahweahcare' does not exist"
The database wasn't created. Run:
```
createdb yahweahcare
cd ~/Downloads/Yahweahcare/backend
npm run init-db
npm run seed
```

### "Error: Cannot find module 'pg'"
Backend dependencies aren't installed:
```
cd ~/Downloads/Yahweahcare/backend
npm install
```

### "EADDRINUSE: address already in use :::4000"
The API server is already running in another Terminal tab. Either use the existing tab, or stop it (`Ctrl + C`) and start fresh.

### Web app shows a blank screen
The most common cause is the CDN scripts haven't loaded. Try:
1. Reload the page (`Cmd + R`)
2. Try a different browser (Chrome, Edge, or Firefox)
3. Check your internet — the page loads React from CDN
4. Right-click → Inspect → Console tab — paste any red errors back to me

### The web app shows old data after I reset the database
The current frontend uses browser localStorage for demo mode. To see the database data, the frontend needs to be wired to the API — which is a follow-up task. For now, clear browser storage:
- Chrome: Cmd+Shift+Delete → "Cookies and other site data" → Clear data
- Or: right-click → Inspect → Application tab → Local Storage → delete the yahweahcare key

---

## What's where

```
~/Downloads/Yahweahcare/
├── README.md                ← high-level overview
├── SETUP_GUIDE.md           ← this file
├── start.sh                 ← one-shot setup script
├── frontend/
│   └── index.html           ← the web app (open this in browser)
└── backend/
    ├── server.js            ← REST API
    ├── schema.sql           ← PostgreSQL tables
    ├── init-db.js           ← creates the database
    ├── seed.js              ← inserts demo data
    ├── package.json         ← list of dependencies
    └── .env                 ← config (auto-created)
```

---

If you get stuck, paste the **exact** error message and I'll help you fix it.
