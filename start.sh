#!/usr/bin/env bash
# ============================================================
# Yahweahcare — one-shot setup script
# Installs PostgreSQL (via Homebrew), creates the database,
# installs backend deps, runs migrations, seeds demo data,
# starts the API server, and opens the web app.
# ============================================================

set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}  Yahweahcare Ticket System — Setup${NC}"
echo -e "${BLUE}=========================================${NC}"
echo

# ---- 1. Check Node.js ----
echo -e "${YELLOW}[1/7]${NC} Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not installed.${NC}"
  echo "  Install it with: brew install node@22"
  exit 1
fi
NODE_VERSION=$(node --version)
echo "  ✓ Node $NODE_VERSION"

# ---- 2. Check / install PostgreSQL ----
echo
echo -e "${YELLOW}[2/7]${NC} Checking PostgreSQL..."
if ! command -v psql &>/dev/null; then
  echo "  PostgreSQL not found. Installing via Homebrew..."
  if ! command -v brew &>/dev/null; then
    echo -e "${RED}✗ Homebrew not found. Install it from https://brew.sh first.${NC}"
    exit 1
  fi
  brew install postgresql@16
  brew services start postgresql@16
  echo "  ✓ PostgreSQL installed and started"
  echo "  (Waiting 3 seconds for PostgreSQL to be ready...)"
  sleep 3
else
  echo "  ✓ PostgreSQL already installed ($(psql --version))"
  # Make sure it's running
  if ! pg_isready -q 2>/dev/null; then
    echo "  Starting PostgreSQL..."
    brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
    sleep 2
  fi
fi

# ---- 3. Create database ----
echo
echo -e "${YELLOW}[3/7]${NC} Creating database 'yahweahcare'..."
if psql -lqt | cut -d \| -f 1 | grep -qw yahweahcare; then
  echo "  Database 'yahweahcare' already exists."
  read -p "  Drop and recreate? [y/N] " yn
  if [[ "$yn" =~ ^[Yy]$ ]]; then
    dropdb yahweahcare
    createdb yahweahcare
    echo "  ✓ Database recreated"
  fi
else
  createdb yahweahcare
  echo "  ✓ Database created"
fi

# ---- 4. Install backend dependencies ----
echo
echo -e "${YELLOW}[4/7]${NC} Installing backend dependencies..."
cd "$PROJECT_DIR/backend"
if [ ! -d node_modules ]; then
  npm install
else
  echo "  ✓ Dependencies already installed (delete backend/node_modules to reinstall)"
fi

# ---- 5. Create .env if missing ----
echo
echo -e "${YELLOW}[5/7]${NC} Setting up environment..."
if [ ! -f .env ]; then
  cp .env.example .env
  # Use the Postgres default for local Mac install (no auth needed)
  sed -i.bak "s|DATABASE_URL=.*|DATABASE_URL=postgresql://$USER@localhost:5432/yahweahcare|" .env
  rm -f .env.bak
  echo "  ✓ .env created with local PostgreSQL connection"
else
  echo "  ✓ .env already exists"
fi

# ---- 6. Init DB & seed ----
echo
echo -e "${YELLOW}[6/7]${NC} Creating tables and seeding demo data..."
npm run init-db
npm run seed

# ---- 7. Start server ----
echo
echo -e "${YELLOW}[7/7]${NC} Starting API server..."
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  ✓ Setup complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo
echo "  Backend API: http://localhost:4000"
echo "  Frontend:    $PROJECT_DIR/frontend/index.html"
echo
echo "  Demo login: ron@wmxsolutions.com.au / Yahweycare2026!"
echo
echo "  Opening web app in your browser..."
open "$PROJECT_DIR/frontend/index.html"
echo
echo "  Press Ctrl+C to stop the server"
echo

npm start
