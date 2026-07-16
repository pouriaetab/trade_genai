#!/bin/zsh
# trade_genai — single entry point (control_deck run.sh convention)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Python env
[[ -d ".venv" ]] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

# 2. Config check
[[ -f ".env.local" ]] || { echo "Missing .env.local — copy .env.example and add your keys."; exit 1; }

# 3. Start API (also serves the frontend). genai_trader importable via PYTHONPATH.
export PYTHONPATH="$SCRIPT_DIR"
PORT="${PORT:-8765}"
echo "trade_genai → http://127.0.0.1:${PORT}"
exec uvicorn backend.app.main:app --host 127.0.0.1 --port "${PORT}" --reload
