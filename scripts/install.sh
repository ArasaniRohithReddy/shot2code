#!/usr/bin/env bash
# Install shot2code's development dependencies.
#
# Safe to re-run. Works from any directory - it changes to the repo root first.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Backend: uv manages both the Python toolchain and the virtualenv.
if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

echo "Installing backend dependencies..."
uv sync --project backend

# Chromium powers the optional screenshot-preview tool. Not fatal if it fails.
echo "Installing Chromium for screenshot preview..."
uv run --project backend playwright install --with-deps chromium || \
  echo "Chromium install failed - screenshot preview will be disabled."

# Frontend
if ! command -v pnpm >/dev/null 2>&1; then
  echo "Installing pnpm..."
  npm install -g pnpm
fi

echo "Installing frontend dependencies..."
pnpm -C frontend install

# Desktop shell is optional; only needed to build or run the packaged app.
if [ -d desktop ]; then
  echo "Installing desktop dependencies..."
  npm --prefix desktop install || echo "Desktop deps failed - not needed for web dev."
fi

echo
echo "Done. To start:"
echo "  backend:  cd backend && uv run uvicorn main:app --reload --port 7001"
echo "  frontend: cd frontend && pnpm dev"
