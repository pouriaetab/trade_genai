#!/bin/zsh
# trade_genai — single entry point (control_deck run.sh convention).
# Honors BACKEND_PORT / FRONTEND_PORT injected by control_deck; falls back to
# standalone defaults. Starts the FastAPI backend + the Vite React frontend.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PORT="${BACKEND_PORT:-8003}"
FRONTEND_PORT="${FRONTEND_PORT:-5177}"

# 1. Python env
[[ -d ".venv" ]] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

# 2. Config check
[[ -f ".env.local" ]] || { echo "Missing .env.local — copy .env.example and add your keys."; exit 1; }

# 3. Frontend deps (first run only)
if [[ ! -d "frontend/node_modules" ]]; then
  echo "Installing frontend deps…"
  ( cd frontend && (command -v pnpm >/dev/null && pnpm install || npm install) )
fi

export PYTHONPATH="$SCRIPT_DIR"
export BACKEND_PORT FRONTEND_PORT

trap 'kill $(jobs -p) 2>/dev/null; echo "\ntrade_genai stopped"; exit 0' EXIT INT TERM

echo "backend  → http://127.0.0.1:${BACKEND_PORT}"
uvicorn backend.app.main:app --host 127.0.0.1 --port "${BACKEND_PORT}" --reload &

sleep 2
echo "frontend → http://127.0.0.1:${FRONTEND_PORT}"
( cd frontend && (command -v pnpm >/dev/null && pnpm dev || npm run dev) ) &

wait
