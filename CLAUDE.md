# trade_genai

## Overview
A hands-on lab for the Wiley book *Generative AI for Trading and Asset Management*
(Medina Ruiz & Chan). It pairs a reusable Python library (`genai_trader`) with a
web app: run book code in a persistent kernel, pull market data from the Massive
(formerly Polygon) API, and chat with free or paid LLMs while you learn — with
per-project memory. Built to control_deck conventions so it can fold into that
deck later.

## Tech Stack
- Backend: FastAPI + Uvicorn, Pydantic v2 (Python 3.10+)
- Library: pandas, numpy, requests, matplotlib
- Frontend: React 18 + Vite 5 + pnpm, DESIGN_SYSTEM.css (Claude/Cowork palette)
- Data: Massive REST API; LLMs: Gemini/Groq/OpenRouter (free), Anthropic/OpenAI/xAI (paid)
- Chat architecture: React → JSON over /api → FastAPI → secure key → provider API

## Structure
```
genai_trader/     library — config, data (massive), metrics, llm (registry+client), lessons
backend/app/      FastAPI: main, envelope, kernel, memory
frontend/         Vite React app (src/App.jsx, components/, lib/api.js) + DESIGN_SYSTEM.css
data/             runtime memory (git-ignored)
```

## Running
```bash
./run.sh          # backend :8003 (or $BACKEND_PORT), frontend :5177 (or $FRONTEND_PORT)
```
Honors BACKEND_PORT / FRONTEND_PORT injected by control_deck.

## Environment Variables
Copy `.env.example` → `.env.local` (git-ignored). Keys are loaded once and only
ever shown masked.
- `MASSIVE_API_KEY` — market data (required)
- `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` — free LLM tiers
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY` — paid LLM APIs
- `CLAUDE_CODE_OAUTH_TOKEN` — Claude via a Claude.ai Pro/Max subscription
  instead of a billed API key (from `claude setup-token`; requires the
  `claude` CLI installed locally). Separate "Claude (via Claude Code,
  subscription)" provider — see `genai_trader/llm/client.py`'s
  `_chat_claude_code()`.
- Note: a Claude.ai subscription is NOT an API key for the plain `anthropic`
  provider — that one always needs `ANTHROPIC_API_KEY`.

## API Endpoints (all under /api/v1, standard envelope)
- `GET  /api/v1/status` — Massive + provider readiness (masked)
- `GET  /api/v1/models` — provider/model registry for the picker
- `POST /api/v1/kernel/run` · `POST /api/v1/kernel/reset` — code kernel
- `POST /api/v1/chat` — chat with a chosen model
- `GET|PUT /api/v1/projects/{id}` — per-project memory

## Testing
```bash
python -m genai_trader.lessons.ch01_spy_returns   # end-to-end lesson (needs Massive key)
pytest                                             # once tests are added under tests/
```

## Notes
- The code kernel runs arbitrary Python with no sandbox — local, single-user only.
- Response format: `{ success, data, message, timestamp }`.
- The kernel (`backend/app/kernel.py`) auto-installs a missing package on
  `ModuleNotFoundError` (via `pip install` into the running interpreter's env)
  and retries the cell once, up to 4 distinct packages per run. scipy,
  statsmodels, scikit-learn, and seaborn are preinstalled via
  `requirements.txt` so common quant/stats code doesn't hit an install delay.
