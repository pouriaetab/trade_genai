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
- Frontend: vanilla HTML/JS on DESIGN_SYSTEM.css (Claude/Cowork palette), served by the API
- Data: Massive REST API; LLMs: Gemini/Groq/OpenRouter (free), Anthropic/OpenAI/xAI (paid)

## Structure
```
genai_trader/     library — config, data (massive), metrics, llm (registry+client), lessons
backend/app/      FastAPI: main, envelope, kernel, memory
frontend/         index.html, app.js, DESIGN_SYSTEM.css
data/             runtime memory (git-ignored)
```

## Running
```bash
./run.sh                     # http://127.0.0.1:8765
```

## Environment Variables
Copy `.env.example` → `.env.local` (git-ignored). Keys are loaded once and only
ever shown masked.
- `MASSIVE_API_KEY` — market data (required)
- `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` — free LLM tiers
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY` — paid LLM APIs
- Note: a Claude.ai subscription is NOT an API key.

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
