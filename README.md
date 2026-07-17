# trade_genai

**A workbench for generative-AI quant research — learn the theory, then build your own.**

trade_genai is a web app that does two things at once. It's a guided lab for
working through *Generative AI for Trading and Asset Management* (Medina Ruiz &
Chan) — run the book's ideas live, see real market data, and ask an AI to explain
the parts that don't click. And it's an open platform for going past the book:
pull in your own datasets, prototype strategies, and turn a plain-English
question into runnable analysis with results in front of you.

The goal is a place to *grow* — from following along, to forming your own
hypotheses, to producing something new.

---

## What you can do with it

- **Ask in plain English, get real results.** "Get the 100 most recent daily
  closes for AAPL and show them." The model writes the Python, a live kernel runs
  it against real data, and you see the table, number, or chart — with a short
  explanation. Then build on it: "now compute daily returns and the Sharpe ratio."
- **Drop into code anytime.** Flip the same panel from Prompt to Code and run
  Python directly. Chat and notebook share one kernel, so anything you fetch by
  asking is available to your code, and vice versa.
- **Compare models while you learn.** A built-in picker spans free tiers (Gemini,
  Groq, OpenRouter) and paid APIs (Anthropic, OpenAI, xAI), each labelled with a
  cost estimate — so you can weigh answers and price as you go.
- **Bring your own data.** The data layer is a thin, swappable client; today it
  pulls split- and dividend-adjusted prices from the Massive API, and it's built
  to extend to other sources and datasets.
- **Keep your thinking.** Each project keeps its own memory — notes and chat
  history persist across restarts, so a line of research survives the session.

## Who it's for

- **Readers of the book** who want to *run* the concepts, not just read them.
- **Anyone learning quantitative analysis** who wants a standalone sandbox to try
  ideas, test intuitions, and see the numbers move.
- **Me** — this is an active portfolio project. It shows how I design software
  (typed data layer, provider-agnostic LLM layer, clean API), how I reason about
  markets, and how I use AI as a tool for research rather than a black box.

---

## Architecture

```
React (Vite) ──JSON /api──> FastAPI backend ──secure key──> LLM provider (Gemini, …)
                                   │
                                   └── live Python kernel + genai_trader library ── Massive market data
```

The browser never holds an API key. It talks to the backend, which reads keys
from a git-ignored file and calls the provider. The same backend runs a
persistent Python kernel that the chat and the notebook both share.

## Project structure

```
genai_trader/        the library (reusable, importable, testable)
  config.py          secure key loading — masked, never logged
  data/massive.py    market-data client + split/dividend adjustment
  metrics.py         daily_returns, sharpe_ratio, cumulative_returns
  llm/               model registry + provider-agnostic chat client
  lessons/           one module per book exercise (ch01_spy_returns, …)
backend/app/         FastAPI — main, envelope, kernel, memory, agent
frontend/            React + Vite app (App.jsx, components/, lib/api.js) + DESIGN_SYSTEM.css
data/                per-project memory (git-ignored)
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

## Models: free and paid

The chat picker has two dropdowns — provider, then model — each labelled `free`
or `paid` with a cost hint. Add a key in `.env.local` to enable a provider:

| Provider | Tier | Key | Notes |
|----------|------|-----|-------|
| Google Gemini | free | `GEMINI_API_KEY` | generous free tier, 1M context |
| Groq | free | `GROQ_API_KEY` | fast open models (Llama) |
| OpenRouter | free | `OPENROUTER_API_KEY` | many models, one key |
| Anthropic Claude | paid | `ANTHROPIC_API_KEY` | needs an API key — a Claude.ai subscription is not one |
| OpenAI | paid | `OPENAI_API_KEY` | GPT-5 family |
| xAI Grok | paid | `XAI_API_KEY` | 1M-context flagship |

Get a free Gemini key at [ai.google.dev](https://ai.google.dev) to start with no
cost. Prices live in `genai_trader/llm/registry.py` — verify on each provider's
page, as they change.

## Keys stay private

Every key lives in `.env.local`, which is git-ignored (only the `.env.example`
template is tracked). Keys are loaded once and only ever shown masked (like
`abcd…wxyz`) — never printed, logged, or sent to the browser. No secrets or local
paths are committed.

## Try Chapter 1 from the terminal

```bash
python -m genai_trader.lessons.ch01_spy_returns
```

Fetches the last 100 trading days of SPY, adjusts for splits *and* dividends,
computes daily returns, and prints the raw data plus a tidy `[date, daily_return]`
table.

## Tech

Python 3.10+ · FastAPI · Pydantic v2 · pandas / numpy · React 18 · Vite 5 · a
provider-agnostic LLM layer. Backend responses use a standard envelope
(`{ success, data, message, timestamp }`).

## Status and roadmap

Early and active. Working today: the Chapter 1–2 lab (notebook + agentic chat +
memory), the market-data layer, and the model registry. Next: more chapter
lessons, a strategies module with backtests, additional data sources, and
streaming chat responses.

---

*Educational and research software. Not investment advice; use at your own risk.*
