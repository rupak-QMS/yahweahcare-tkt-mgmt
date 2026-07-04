#!/usr/bin/env bash
# ============================================================
# Yahweh Care — local dev launcher
#
# Starts both services:
#   • Frontend  →  http://localhost:4000
#   • Backend   →  http://localhost:4002
#
# Usage:
#   chmod +x dev.sh   (first time only)
#   ./dev.sh
# ============================================================

set -e
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT/YCTMBackend"
FRONTEND_DIR="$ROOT/YCTMFrontend"

# ── Trap Ctrl+C so we can kill both child processes cleanly ──
cleanup() {
  echo -e "\n${YELLOW}Shutting down...${NC}"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  echo "Goodbye."
}
trap cleanup INT TERM

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Yahweh Care — Development Server${NC}"
echo -e "${BLUE}============================================${NC}"
echo

# ── Check node_modules exist ───────────────────────────────
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo -e "${YELLOW}Installing YCTMBackend dependencies...${NC}"
  (cd "$BACKEND_DIR" && npm install)
fi

# ── Start HRMS backend (port 4002) ─────────────────────────
echo -e "${GREEN}▶ Starting HRMS backend  →  http://localhost:4002${NC}"
(cd "$BACKEND_DIR" && npm run dev) &
BACKEND_PID=$!

# Give the backend a moment to start before opening the browser
sleep 3

# ── Start Frontend static server (port 4000) ──────────────
echo -e "${GREEN}▶ Starting frontend      →  http://localhost:4000${NC}"
(cd "$FRONTEND_DIR" && node server.js) &
FRONTEND_PID=$!

sleep 1

echo
echo -e "${BLUE}============================================${NC}"
echo -e "${GREEN}  ✓ Both servers are running${NC}"
echo -e "${BLUE}--------------------------------------------${NC}"
echo -e "  Frontend : ${GREEN}http://localhost:4000${NC}"
echo -e "  Backend  : ${GREEN}http://localhost:4002${NC}"
echo -e "${BLUE}--------------------------------------------${NC}"
echo -e "  Sign in with your Microsoft work account"
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop both servers"
echo -e "${BLUE}============================================${NC}"
echo

# ── Open browser (macOS only, skip gracefully on Linux) ───
if command -v open &>/dev/null; then
  sleep 1 && open "http://localhost:4000/" &
fi

# Wait for both processes
wait "$BACKEND_PID" "$FRONTEND_PID"
