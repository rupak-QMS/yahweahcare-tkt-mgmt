# Yahweahcare Ticket Management System

Internal ticket management web app for Yahweahcare — a complete service desk system with categories, priorities, SLA tracking, dashboards, and a real database.

## ⚡ Quick start — see the app NOW (30 seconds)

Open **Finder** → **Downloads** → **Yahweahcare** → **frontend** → **double-click `index.html`**.

That's it. The web app opens in your browser. Click any user to log in. Data is saved in your browser.

## 🚀 Full setup with PostgreSQL database (10 minutes)

```bash
cd ~/Downloads/Yahweahcare
chmod +x start.sh
./start.sh
```

The script installs PostgreSQL (via Homebrew), creates the database, sets up everything, and opens the web app. See **SETUP_GUIDE.md** for the beginner-friendly version of every step.

## What's included

| Path | What it does |
|---|---|
| `frontend/index.html` | Single-file React web app — open directly in browser |
| `backend/server.js` | Node.js + Express REST API with JWT authentication |
| `backend/schema.sql` | PostgreSQL schema (9 tables, 1 view) |
| `backend/init-db.js` | Creates tables and lookup data |
| `backend/seed.js` | Inserts 7 demo users and 12 realistic tickets |
| `start.sh` | One-shot installer/setup script |
| `SETUP_GUIDE.md` | Step-by-step beginner instructions |

## Tech stack

- **Frontend:** React 18, Tailwind CSS, Recharts (charts)
- **Backend:** Node.js, Express, JWT auth, bcrypt
- **Database:** PostgreSQL 16
- **All running locally on your Mac**

## Demo login

All seeded users share password `Yahweycare2026!`.

Most useful demo accounts:
- `ron@wmxsolutions.com.au` (Manager)
- `aisha.p@yahweycare.com.au` (IT Agent)
- `jack.w@yahweycare.com.au` (Staff)

## Features

- Ticket CRUD with categories (IT, HR, Facilities, Care, Clinical, Finance, General)
- Priority levels with automatic SLA deadlines (Critical 2h, High 8h, Medium 24h, Low 72h)
- Status workflow (New → Assigned → In Progress → Waiting → Resolved → Closed)
- Comments thread on each ticket
- Full activity audit log
- Manager dashboard with charts (open by priority, by category, agent workload)
- SLA breach detection with visual indicators
- Notifications queue (ready for MS Graph / Teams webhook integration)
- Role-based access (staff see their own, agents see all, managers get reports)
- CSV report export

## Need help?

See **SETUP_GUIDE.md** for step-by-step instructions and a troubleshooting section.
