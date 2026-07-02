# Yahweahcare — Quick Start Guide

## Prerequisites
- **Node.js** v14+ installed
- **PostgreSQL** v12+ installed and running
- PostgreSQL user `subhankarmondal` with access to `yahweahcare` database

## First-Time Setup (One-Time Only)

```bash
# 1. Initialize the database
cd Yahweahcare/backend
npm install
npm run init-db
npm run seed

# Database is now ready
```

## Running the Application

### Terminal 1: Start Backend (Port 4000)
```bash
cd Yahweahcare/backend
npm run dev
```
Wait for output: `✓ Backend server running on port 4000`

### Terminal 2: Start Frontend (Port 3000)
```bash
cd Yahweahcare/frontend
npm install  # (only needed first time)
node server.js
```
Wait for output: `✓ Yahweh Care frontend running at http://localhost:3000`

### Terminal 3: Open Browser
```
http://localhost:3000
```

## Demo Credentials

Try logging in with:
- **Email**: ron@wmxsolutions.com.au
- **Password**: test123

## What's Ready to Test

✅ **Dashboard**
- Stats cards showing tickets by status
- Recent activity feed
- Quick actions

✅ **Ticket Management**
- Create new tickets
- View all tickets with filters
- View ticket details and history
- Assign tickets to staff
- Set priorities and deadlines

✅ **Breadcrumb Navigation**
- All pages include breadcrumb trails
- Click breadcrumbs to navigate back quickly
- Example: Dashboard > Tickets > Ticket #123

✅ **Staff Performance**
- View individual staff member metrics
- Compare staff performance across team
- See resolution rates, SLA compliance, workload

✅ **Calendar & Scheduling**
- Calendar view of ticket deadlines
- Scheduled maintenance view

✅ **Audit Logs**
- Complete activity history
- Track all changes to tickets

✅ **Approval Workflow**
- Approve or reject ticket actions
- Flag suspicious patterns (duplicate detection)

## Stopping the Application

Press `Ctrl+C` in each terminal to stop the servers.

## Troubleshooting

**Port already in use?**
```bash
# Frontend on different port
PORT=3001 node server.js

# Backend on different port (update .env: PORT=4001)
```

**Database connection error?**
```bash
# Verify PostgreSQL is running and database exists
psql -U subhankarmondal -d yahweahcare
```

**Application not loading?**
1. Press `Ctrl+F5` in browser (hard refresh)
2. Check browser console (F12) for errors
3. Verify both backend and frontend are running
4. Check that backend is accessible: `curl http://localhost:4000`

## Project Structure

```
Yahweahcare/
├── backend/           # Node.js/Express REST API
│   ├── server.js      # Main API server
│   ├── init-db.js     # Database initialization
│   ├── seed.js        # Sample data
│   └── .env           # Configuration (PORT, DATABASE_URL, JWT_SECRET)
├── frontend/          # React SPA
│   ├── index.html     # Single-file React app with Babel transpiler
│   └── server.js      # Simple HTTP server for serving frontend
└── SETUP_INSTRUCTIONS.md  # Detailed setup guide
```

## Next Steps

1. Test the application features by navigating through different pages
2. Check that breadcrumbs appear on all pages and are clickable
3. Create and manage some test tickets
4. Try assigning tickets to different staff members
5. Check staff performance metrics

For detailed setup instructions, see [SETUP_INSTRUCTIONS.md](./SETUP_INSTRUCTIONS.md)
