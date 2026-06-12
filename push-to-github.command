#!/bin/bash
cd "$(dirname "$0")"
rm -f .git/HEAD.lock .git/index.lock
echo "Adding files..."
git add frontend/index.html
git add backend-hrms/src/__tests__/frontend.ready_to_close.test.ts
echo "Committing..."
git commit -m "feat: Ready to Close tab — resolved tickets for creator to close inline (+ 23 unit tests)"
echo "Pushing to GitHub..."
git push origin main
echo ""
echo "Done. Press any key to close."
read -n 1
