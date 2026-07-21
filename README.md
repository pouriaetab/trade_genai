# trade_genai

**A local, plug-and-play webapp for AI-assisted quant research — prototype an idea, then turn it into a working strategy.**

trade_genai is a single-user, run-on-your-own-machine platform built around three tabs:

- **Notebook / Lab** — a free-form scratchpad. Ask a question in plain English or
  drop into raw Python; a live kernel runs it against real market data and shows
  you the table, number, or chart. Good for quick exploration, one-off questions,
  and following any AI-assisted train of thought.
- **R&D** — structured, repeatable strategy workflows. Each strategy exposes its
  own pipeline (fetch data → transform it → compute stats → run) as a click-through
  panel, so you can inspect every intermediate result or run the whole thing in
  one shot. This is where an idea from the Lab graduates into something reusable.
- **Settings** — add, swap, or remove market-data providers and LLM
  providers/models, all from the app, no code or config-file edits required.

Every tab name — and the sub-tabs inside the Lab — is yours to rename; nothing
here is hard-coded to a specific use case. Clone it, add your own API keys, and
it's a self-contained research tool.

---

## What you can do with it

- **Ask in plain English, get real results.** "Get the 100 most recent daily
  closes for AAPL and show them." The model writes the Python, a live kernel runs
  it against real data, and you see the table, number, or chart — with a short
  explanation. Then build on it: "now compute daily returns and the Sharpe ratio."
- **Drop into code anytime.** Flip the same panel from Prompt to Code and run
  Python directly. Chat and notebook share one kernel, so anything you fetch by
  asking is available to your code, and vice versa.
- **Compare models as you go.** A built-in picker spans free tiers (Gemini, Groq,
  OpenRouter) and paid APIs (Anthropic, OpenAI, xAI), each labelled with a cost
  estimate, so you can weigh answers and price together. The header always shows
  which model is currently selected.
- **Build out strategies in R&D.** Efficient Frontier ships as the first
  example: pick symbols and a date range, fetch prices, transform them into daily
  returns, compute annualized stats, then solve and plot the mean-variance
  frontier — one step at a time or all at once. More strategies are meant to be
  added the same way (see `genai_trader/strategies/`).
- **Bring your own data and models — no code required.** A Settings tab lets
  you add, disable, or remove market-data providers and LLM providers/models
  from the app itself: paste a name, URL, and key, and it's available in the
  pickers. Prefer the technical path? `.env.local` still works exactly the
  same way and is auto-detected. Both are first-class; use whichever fits.
- **Keep your thinking.** Each Lab tab keeps its own memory — notes, cells, and
  chat context persist across restarts. Tabs can be archived (hidden but kept)
  or deleted outright, so you can clear clutter without losing work.
- **Doesn't get stuck on a missing package.** scipy, statsmodels, scikit-learn,
  and seaborn are preinstalled for factor models, regressions, and stats work.
  If generated code reaches for something else, the kernel installs it
  automatically the first time and re-runs your code — you'll see a one-line
  note in the output when that happens, instead of a `ModuleNotFoundError`.

## Who it's for

Anyone who wants a private, local, one-window place to explore market data and
trading ideas with an AI pair — without wiring up a notebook server, a data
subscription, and a chat client separately. Point it at your own API keys and
it's a self-contained research desk: ask questions, write code, and grow an
idea from "just checking a number" into a documented strategy pipeline.

---

## Architecture

```
React (Vite) ──JSON /api──> FastAPI backend ──secure key──> LLM provider (Gemini, Claude, …)
                                   │
                                   └── live Python kernel + genai_trader library ── market data API
```

The browser never holds an API key. It talks to the backend, which reads keys
from a git-ignored file and calls the provider. The same backend runs a
persistent Python kernel that the chat and the notebook both share.

## Project structure

```
genai_trader/        the library (reusable, importable, testable)
  config.py          secure key loading + the data-provider registry (env or app-added)
  data/massive.py     market-data client + split/dividend adjustment
  metrics.py          daily_returns, sharpe_ratio, cumulative_returns
  llm/                model registry + provider-agnostic chat client
    overlay.py         user-editable layer on top of the curated registry (add/remove, sticky)
  strategies/          R&D strategy modules (efficient_frontier, …)
  lessons/             optional worked examples
backend/app/          FastAPI — main, envelope, kernel, memory
frontend/             React + Vite app (App.jsx, components/, lib/api.js) + DESIGN_SYSTEM.css
data/                 git-ignored: per-tab memory, plus provider/model settings
  memory.json          Lab tabs (cells, notes) and per-project memory
  providers.json        app-added data providers (no keys)
  model_registry.json    LLM registry overlay (custom/removed providers & models)
  secrets.json           app-entered API keys (never committed, never returned in plaintext)
```

## Quick start

```bash
git clone https://github.com/pouriaetab/trade_genai.git
cd trade_genai
cp .env.example .env.local        # add your keys (see below)
./run.sh                          # backend :8003, frontend :5177
```

`run.sh` sets up the Python venv and frontend deps, then starts both servers.
Open http://127.0.0.1:5177.

## Making it yours

- **Rename the top tabs.** Double-click "Notebook / Lab", "R&D", or "Settings"
  in the top nav to rename them — the label is saved in your browser, no code
  changes needed.
- **Rename or organize Lab tabs.** New tabs default to "Notebook 1", "Notebook
  2", etc. — double-click any tab to rename it to whatever fits (a ticker, a
  question, a date). Use the archive button (⤓) to hide a tab without losing
  its cells, and the "Archived" list to restore or permanently delete it.
- **Add, swap, or remove a market-data provider — from the Settings tab.**
  Give it a name, its REST base URL, and an API key; it's available
  immediately, no restart. Works out of the box for any Polygon-compatible API
  (same aggs/dividends response shape as Massive). Point-and-click for
  non-technical users; `.env.local` (`MASSIVE_API_KEY`, `MASSIVE_REST_URL`)
  still works for anyone who prefers config files, and is auto-detected as the
  built-in "Massive" provider.
- **Add, swap, or remove LLM providers and models — also from Settings.** The
  picker ships with curated recent models from Gemini, Groq, OpenRouter,
  Anthropic, OpenAI, and xAI; remove any of them you don't want. Add a custom
  model id to an existing provider, or add a whole new provider (anything
  speaking the OpenAI-compatible chat schema — most APIs do). "Refresh
  models" pulls a provider's own current model list so new releases show up
  without a code change. Every change here is sticky across restarts,
  stored in the git-ignored `data/` folder alongside your session memory.
- **Add a strategy to R&D.** Each strategy is a small Python module under
  `genai_trader/strategies/` (fetch → transform → stats → result functions) plus
  a matching React component under `frontend/src/components/RD/`, registered in
  `frontend/src/components/RD/index.jsx`. `efficient_frontier.py` is a template
  to copy from.
- **A different data response shape.** The Settings tab handles *any*
  Polygon-compatible REST API without touching code. A genuinely different
  shape needs a small parser added to `genai_trader/data/massive.py` — that's
  the one place that turns a provider's raw JSON into the OHLCV table the rest
  of the app expects.

## Models: free and paid

The chat picker has two dropdowns — provider, then model — each labelled `free`
or `paid` with a cost hint. Add a key in `.env.local` to enable a provider:

| Provider | Tier | Key | Notes |
|----------|------|-----|-------|
| Google Gemini | free | `GEMINI_API_KEY` | generous free tier, large context |
| Groq | free | `GROQ_API_KEY` | fast open models (Llama) |
| OpenRouter | free | `OPENROUTER_API_KEY` | many models, one key |
| Anthropic Claude | paid | `ANTHROPIC_API_KEY` | needs an API key from the Developer Platform — a Claude.ai (Pro/Max) subscription does not grant API access |
| OpenAI | paid | `OPENAI_API_KEY` | GPT-5 family |
| xAI Grok | paid | `XAI_API_KEY` | large-context flagship |
| Claude (via Claude Code) | subscription | `CLAUDE_CODE_OAUTH_TOKEN` | uses a Claude.ai Pro/Max subscription's included usage instead of a billed API key — see below |

Get a free Gemini key at [ai.google.dev](https://ai.google.dev) to start with no
cost. Curated prices live in `genai_trader/llm/registry.py` — verify on each
provider's page, as they change. Every key above can also be entered from the
Settings tab instead of `.env.local` (env still wins if both are set), and any
provider/model can be added or removed there too. The header's "using: …"
pill always shows whichever provider/model is currently selected.

### Already have a Claude.ai subscription (no separate API key)?

The "Anthropic Claude" row above needs a funded Developer Platform key — a
Claude.ai Pro/Max subscription alone won't work there. If you'd rather use
that subscription's included usage instead of paying per token, there's a
second, separate Claude option: **"Claude (via Claude Code, subscription)"**.

1. Install the Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
2. Run `claude setup-token` — this links it to your Claude.ai login and prints
   a long-lived token
3. Put it in `.env.local`: `CLAUDE_CODE_OAUTH_TOKEN="<the token>"`

That's it — it shows up as its own provider in the picker. Worth knowing how
it's different from every other provider here: each request starts the
`claude` CLI fresh (a few seconds of startup overhead beyond whatever Claude
itself takes), it never uses tools (answers in text/code only, same contract
as the API-based providers), and there's no per-token dollar cost shown since
usage comes out of your subscription, not a metered API bill.

## Keys stay private

Every key lives in `.env.local`, which is git-ignored (only the `.env.example`
template is tracked). Keys are loaded once and only ever shown masked (like
`abcd…wxyz`) — never printed, logged, or sent to the browser. The masked key
shown in the header is just a sanity check that the right key loaded; no
secrets or local paths are committed.

## Tech

Python 3.10+ · FastAPI · Pydantic v2 · pandas / numpy · React 18 · Vite 5 · a
provider-agnostic LLM layer. Backend responses use a standard envelope
(`{ success, data, message, timestamp }`).

## Status and roadmap

Early and active. Working today: the Lab (notebook + agentic chat + memory,
with pinning and tab archiving), the market-data layer, the model registry, and
the first R&D strategy (Efficient Frontier). Next: more strategies, backtests,
additional data sources, and streaming chat responses.

---

*Research and educational software. Not investment advice; use at your own risk.*
