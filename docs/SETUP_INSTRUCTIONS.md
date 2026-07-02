# Yahweahcare Setup Instructions

## Prerequisites
Before running the application, ensure you have installed:
- **Node.js** (v14 or higher) - [Download here](https://nodejs.org/)
- **PostgreSQL** (v12 or higher) - [Download here](https://www.postgresql.org/download/)

## Step 1: Set Up PostgreSQL Database

### macOS / Linux
```bash
# Start PostgreSQL service (if using Homebrew)
brew services start postgresql

# Connect to PostgreSQL
psql postgres

# Inside psql, create the database
CREATE DATABASE yahweahcare;
CREATE USER subhankarmondal WITH PASSWORD 'your-password';
ALTER ROLE subhankarmondal SET client_encoding TO 'utf8';
ALTER ROLE subhankarmondal SET default_transaction_isolation TO 'read committed';
ALTER ROLE subhankarmondal SET default_transaction_deferrable TO on;
ALTER ROLE subhankarmondal SET default_time_zone TO 'UTC';
ALTER USER subhankarmondal WITH SUPERUSER;

# Exit psql
\q
```

### Windows
1. During PostgreSQL installation, note the password you set for the `postgres` user
2. Open PostgreSQL Command Line (psql)
3. Run the above SQL commands

## Step 2: Configure Backend Environment

Navigate to the backend directory and verify `.env` file:

```bash
cd Yahweahcare/backend
cat .env
```

The `.env` file should contain:
```
PORT=4001
DATABASE_URL=postgresql://subhankarmondal@localhost:5432/yahweahcare
JWT_SECRET=local-dev-secrett
```

If the DATABASE_URL doesn't match your PostgreSQL setup, update it accordingly.

## Step 3: Initialize Database

```bash
cd Yahweahcare/backend

# Install dependencies (if not already done)
npm install

# Initialize database schema
npm run init-db

# Seed with sample data
npm run seed
```

You should see output confirming the database has been set up with tables and sample data.

## Step 4: Start the Backend Server

```bash
cd Yahweahcare/backend

# Start the backend (development mode with auto-reload)
npm run dev

# Or for production mode
npm start
```

You should see:
```
✓ Backend server running on port 4001
```

Keep this terminal open and running.

## Step 5: Start the Frontend Server (in a new terminal)

```bash
cd Yahweahcare/frontend

# Install dependencies (if not already done)
npm install

# Start the frontend server
node server.js
```

You should see:
```
✓ Yahweh Care frontend running at http://localhost:3000
  HRMS backend expected at http://localhost:4000
```

## Step 6: Access the Application

Open your web browser and navigate to:
```
http://localhost:3000
```

You should see the Yahweahcare login screen. The application is now fully running with:
- ✅ Breadcrumb navigation on all pages
- ✅ Ticket management system
- ✅ Staff performance tracking
- ✅ Team comparison
- ✅ Calendar view with scheduled tickets
- ✅ Logs and audit trails
- ✅ Duplicate detection
- ✅ Approval workflow

## Features Implemented

### Navigation
- **Breadcrumbs**: All pages include breadcrumb trails that allow quick navigation
  - Dashboard breadcrumbs: Single item showing current page
  - Detail pages: Multi-level breadcrumbs (e.g., Dashboard > Tickets > Ticket #123)
  - Clickable breadcrumbs: Navigate back to previous pages

### Tickets
- Create and manage tickets
- View ticket details with full history
- Assign tickets to staff members
- Set priorities and deadlines
- Track resolution status

### Staff Management
- View staff performance metrics (resolution rate, SLA compliance, etc.)
- Compare team performance
- View individual staff details and workload

### Calendar & Logs
- Calendar view of ticket deadlines
- Comprehensive audit logs
- Activity tracking

## Troubleshooting

### Port Already in Use
If port 3000 or 4001 is already in use, you can change them:

**Frontend (port 3000)**:
```bash
PORT=3001 node server.js
```

**Backend (port 4001)**:
Update `PORT=4001` in `.env` to your desired port

### Database Connection Issues
1. Verify PostgreSQL is running: `psql -U subhankarmondal -d yahweahcare`
2. Check DATABASE_URL in `.env` matches your setup
3. Ensure the user `subhankarmondal` has access to the database

### Application Not Loading
1. Clear browser cache (Ctrl+F5 or Cmd+Shift+R)
2. Check browser console (F12) for JavaScript errors
3. Verify both frontend and backend servers are running
4. Check that backend is accessible: `curl http://localhost:4001`

## Development

The application is now ready for development. Changes to:
- **Backend** (`backend/server.js`): Auto-reload with `npm run dev`
- **Frontend** (`frontend/index.html`): Refresh browser to see changes

Enjoy using Yahweahcare! 🎉
