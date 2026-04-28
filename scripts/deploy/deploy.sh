#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$ROOT_DIR"

echo "==> Building all packages..."
npm run build --workspaces --if-present

echo "==> Running tests..."
npm test --workspaces --if-present

echo "==> Deploying to Firebase (hosting + functions)..."
npx firebase deploy --only hosting,functions

PROJECT_ID=$(npx firebase use 2>/dev/null | grep -oP '(?<=\().*(?=\))' || echo "unknown")
echo ""
echo "==> Deployment complete!"
echo "    Hosting: https://${PROJECT_ID}.web.app"
