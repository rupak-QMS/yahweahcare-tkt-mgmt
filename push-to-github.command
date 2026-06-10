#!/bin/bash
cd "$(dirname "$0")"
rm -f .git/HEAD.lock .git/index.lock
echo "Adding files..."
git add frontend/index.html backend-hrms/src/modules/tickets/tickets.routes.ts backend-hrms/src/modules/schedules/schedules.routes.ts
echo "Committing..."
git commit -m "fix: enforce Assigned to Me tab strictly — Number() type-safe comparison + null-guard + backend scope=assigned_to_me"
echo "Pushing to GitHub..."
git push origin main
echo ""
echo "Done. Press any key to close."
read -n 1
