#!/usr/bin/env bash
# ============================================================
# One-shot script to push the Yahweh Care HRMS to a new GitHub repo.
# ============================================================
#
# Run from the project root:
#   chmod +x .github/scripts/bootstrap-repo.sh
#   ./.github/scripts/bootstrap-repo.sh
#
# Requires:
#   - git (already on macOS)
#   - GitHub CLI: `brew install gh` then `gh auth login`
# ============================================================

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

# ── Pre-flight ─────────────────────────────────────────────
if [ ! -d backend-hrms ] || [ ! -d frontend ]; then
  echo -e "${RED}✗ Run this from the project root (the folder with backend-hrms/ and frontend/)${NC}"
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo -e "${YELLOW}⚠ GitHub CLI not installed. Install with: brew install gh${NC}"
  echo "  Continuing with git only — you'll push manually."
  USE_GH=false
else
  USE_GH=true
fi

# ── Identity ───────────────────────────────────────────────
if ! git config --global user.name >/dev/null; then
  read -p "Your name (for git commits): " NAME
  read -p "Your email: " EMAIL
  git config --global user.name "$NAME"
  git config --global user.email "$EMAIL"
fi

# ── Existing .git handling ─────────────────────────────────
if [ -d .git ]; then
  echo -e "${YELLOW}⚠ This folder already has a .git directory.${NC}"
  read -p "  Reset it and start fresh? [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]] && rm -rf .git
fi

# ── Init ───────────────────────────────────────────────────
echo -e "${GREEN}→ Initialising git repo...${NC}"
git init -b main
git add .
git status --short | head -30
echo

# ── Commit ─────────────────────────────────────────────────
echo -e "${GREEN}→ Creating initial commit...${NC}"
git commit -m "Initial commit: Yahweh Care HRMS

- backend-hrms/ — TypeScript + Express + MSAL Microsoft Entra SSO
- frontend/      — React single-file ticket management UI
- yc_tkt_mgmt    — PostgreSQL schema with HRMS auth tables
- RBAC           — Super Admin / Admin / HR / Manager / Employee
- Bootstrap admins: Ron Costa, Alex
- CI/CD          — GitHub Actions → Azure App Service"

# ── Repo creation ──────────────────────────────────────────
if [ "$USE_GH" = true ]; then
  read -p "GitHub repo name [yahwehcare-hrms]: " REPO_NAME
  REPO_NAME=${REPO_NAME:-yahwehcare-hrms}
  read -p "Visibility (private/public) [private]: " VIS
  VIS=${VIS:-private}

  echo -e "${GREEN}→ Creating GitHub repo via gh CLI...${NC}"
  gh repo create "$REPO_NAME" --"$VIS" --source=. --remote=origin --push

  REPO_URL=$(gh repo view --json url --jq .url)
  echo -e "${GREEN}✓ Pushed to ${REPO_URL}${NC}"
  echo
  echo "Next steps:"
  echo "  1. Open $REPO_URL/settings/secrets/actions"
  echo "  2. Add the 5 GitHub secrets listed in DEPLOYMENT.md (Part 5)"
  echo "  3. See DEPLOYMENT.md to provision Azure resources"
else
  echo
  echo -e "${YELLOW}Manual push required:${NC}"
  echo "  1. Create an empty repo on https://github.com/new"
  echo "  2. Then run:"
  echo "     git remote add origin https://github.com/<your-username>/<repo-name>.git"
  echo "     git push -u origin main"
fi
