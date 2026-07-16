# trade_genai

A hands-on lab for the Wiley book **_Generative AI for Trading and Asset
Management_** (Medina Ruiz & Chan). Run the book's code in a live kernel, pull
market data from the **Massive** (formerly Polygon) API, and chat with **free or
paid LLMs** side-by-side while you learn — each project keeps its own memory.

Built to the same conventions as `control_deck` (design system, `/api/v1`
endpoints, `run.sh`) so it can fold into that deck later.

## Quick start

```bash
cp .env.example .env.local     # then add your keys
./run.sh                       # → http://127.0.0.1:8765
```

`run.sh` creates the venv, installs deps, and starts the API (which also serves
the UI).

## What's inside

```
genai_trader/        reusable library
  config.py          secure key loading (masked, never logged)
  data/massive.py    Massive REST client + split/dividend adjustment
  metrics.py         daily_returns, sharpe_ratio, cumulative_returns
  llm/               model registry + provider-agnostic chat client
  lessons/           ch01_spy_returns.py  (more per chapter)
backend/app/         FastAPI: main, envelope, kernel, memory
frontend/            index.html, app.js, DESIGN_SYSTEM.css
data/                per-project memory (git-ignored)
```

The app is organized into **tabs (projects)**: *Learn · Ch 1–2* is live today
(notebook cells + model chat + memory); *Strategies* and *Asset management* are
scaffolded for later chapters.

## Your keys stay private

- All keys live in `.env.local`, matched by `.env.*` in `.gitignore` — never
  committed. Only `.env.example` (placeholders) is tracked.
- Keys are loaded once and only ever shown **masked** (e.g. `E7qN…mGYS`) — never
  printed, logged, or sent to the browser.
- No absolute paths or secrets are hard-coded anywhere in the repo.

## Models: free vs. paid

The chat picker has two dropdowns — provider, then model — each labelled `free`
or `paid` with a cost hint. Add a key in `.env.local` to enable a provider:

| Provider | Tier | Key | Notes |
|----------|------|-----|-------|
| Google Gemini | free | `GEMINI_API_KEY` | generous free tier, 1M context |
| Groq | free | `GROQ_API_KEY` | fast open models (Llama) |
| OpenRouter | free | `OPENROUTER_API_KEY` | many models, one key |
| Anthropic Claude | paid | `ANTHROPIC_API_KEY` | needs API key — **not** a Claude.ai subscription |
| OpenAI | paid | `OPENAI_API_KEY` | GPT-5 family |
| xAI Grok | paid | `XAI_API_KEY` | 1M-context flagship |

Prices in `genai_trader/llm/registry.py` are current as of July 2026 — verify on
each provider's pricing page.

## Chapter 1 lesson (terminal)

```bash
python -m genai_trader.lessons.ch01_spy_returns
```

Last 100 trading days of SPY, **split + dividend adjusted**, daily returns, and a
tidy `[date, daily_return]` table. (Massive's `adjusted=true` covers splits only,
so the client also applies the standard dividend back-adjustment.)

## Folding into control_deck

The backend is a plain FastAPI app (`backend.app.main:app`) with a small JSON API,
so control_deck can mount it or call its endpoints. Nothing here touches
control_deck — point me at it when you're ready to wire them together.
