"""trade_genai API.

Run (from project root):  ./run.sh
Or directly:              PYTHONPATH=. uvicorn backend.app.main:app --reload --port 8765

Endpoints (all under /api/v1, all return the standard envelope):
    GET  /api/v1/status              key + provider readiness (masked)
    GET  /api/v1/models              provider/model registry for the picker
    POST /api/v1/kernel/run          run a code cell
    POST /api/v1/kernel/reset        reset the kernel namespace
    POST /api/v1/chat                send a chat message to a chosen model
    GET  /api/v1/projects/{id}       load a project's memory
    PUT  /api/v1/projects/{id}       save a project's memory
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Make the genai_trader library importable when run from anywhere.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from genai_trader.config import get_settings  # noqa: E402
from genai_trader.llm import (  # noqa: E402
    list_providers, models_for, provider_ready, chat as llm_chat,
    estimate_cost, ProviderError,
)
from .envelope import ok, err  # noqa: E402
from .kernel import KernelSession  # noqa: E402
from . import memory  # noqa: E402

app = FastAPI(title="trade_genai API", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

kernel = KernelSession()
FRONTEND_DIST = ROOT / "frontend" / "dist"  # Vite production build


# --- request models -------------------------------------------------------

class RunReq(BaseModel):
    code: str


class ChatReq(BaseModel):
    provider: str
    model: str
    messages: list[dict]
    max_tokens: int = 1024


class AgentReq(BaseModel):
    provider: str
    model: str
    messages: list[dict]
    max_tokens: int = 1024


class ProjectReq(BaseModel):
    notes: str = ""
    cells: list = []
    chat: list = []


# --- status & registry ----------------------------------------------------

@app.get("/api/v1/status")
def status():
    try:
        s = get_settings()
        massive = {"configured": True, "key": s.masked_key, "rest_url": s.rest_url}
    except Exception as exc:
        massive = {"configured": False, "error": str(exc)}
    providers = [
        {**p, "ready": provider_ready(p["id"])} for p in list_providers()
    ]
    return ok({"massive": massive, "providers": providers})


@app.get("/api/v1/models")
def models():
    data = [
        {**p, "ready": provider_ready(p["id"]), "models": models_for(p["id"])}
        for p in list_providers()
    ]
    return ok(data)


# --- kernel ---------------------------------------------------------------

@app.post("/api/v1/kernel/run")
def kernel_run(req: RunReq):
    return ok(kernel.run(req.code))


@app.post("/api/v1/kernel/reset")
def kernel_reset():
    kernel.reset()
    return ok(message="Kernel reset")


# --- chat -----------------------------------------------------------------

@app.post("/api/v1/chat")
def chat(req: ChatReq):
    try:
        result = llm_chat(req.provider, req.model, req.messages, max_tokens=req.max_tokens)
    except ProviderError as exc:
        return err(str(exc), status=400)
    except Exception as exc:  # upstream API error
        return err(f"Provider request failed: {exc}", status=502)
    # attach a rough cost estimate for the exchange
    words_in = sum(len(m.get("content", "").split()) for m in req.messages)
    words_out = len(result.get("text", "").split())
    result["est_cost_usd"] = round(
        estimate_cost(req.provider, req.model, words_in, words_out), 5
    )
    return ok(result)


# --- agent (chat that can run code in the kernel) -------------------------

KERNEL_SYSTEM = (
    "You are a quant research assistant inside the trade_genai app, with a live "
    "Python kernel.\n\n"
    "For ALL market data use ONLY these preloaded helpers (from `genai_trader`, "
    "backed by the app's configured Massive API key):\n"
    "- get_last_n_trading_days(ticker, n) -> DataFrame "
    "[date, open, high, low, close, volume, vwap, adj_close]; use `adj_close` for returns\n"
    "- get_adjusted_close(ticker, start, end)   # start/end are datetime.date\n"
    "- daily_returns(series), sharpe_ratio(returns), cumulative_returns(returns)\n"
    "- pandas as pd, numpy as np, matplotlib.pyplot as plt\n\n"
    "Do NOT import or use external data libraries such as `polygon`, `yfinance`, "
    "`requests`, `alpaca`, or any other API client — no keys are configured for "
    "them and they fail with auth errors. Only the helpers above have valid access.\n\n"
    "When the user asks for data, a calculation, or a chart, reply with ONE "
    "```python code block that computes it and ends with the object to display "
    "(a DataFrame, a number, or a matplotlib plot). Keep code short; at most one "
    "sentence of explanation outside the block. Example — last 100 daily closes "
    "of SPY:\n"
    "```python\n"
    "df = get_last_n_trading_days(\"SPY\", 100)\n"
    "df[[\"date\", \"adj_close\"]]\n"
    "```\n"
    "The kernel keeps state between turns, so build on earlier variables. If no "
    "computation is needed, just answer in plain English."
)

_CODE_RE = re.compile(r"```(?:python|py)?\s*\n(.*?)```", re.DOTALL)


def _extract_code(text: str):
    m = _CODE_RE.search(text or "")
    return m.group(1).strip() if m else None


@app.post("/api/v1/agent")
def agent(req: AgentReq):
    msgs = [{"role": "system", "content": KERNEL_SYSTEM}] + req.messages
    try:
        result = llm_chat(req.provider, req.model, msgs, max_tokens=req.max_tokens)
    except ProviderError as exc:
        return err(str(exc), status=400)
    except Exception as exc:
        return err(f"Provider request failed: {exc}", status=502)

    text = result.get("text", "")
    code = _extract_code(text)
    execution = kernel.run(code) if code else None

    words_in = sum(len(m.get("content", "").split()) for m in req.messages)
    words_out = len(text.split())
    return ok({
        "provider": req.provider,
        "model": req.model,
        "text": text,
        "code": code,
        "execution": execution,
        "usage": result.get("usage", {}),
        "est_cost_usd": round(estimate_cost(req.provider, req.model, words_in, words_out), 5),
    })


# --- project memory -------------------------------------------------------

@app.get("/api/v1/projects/{project_id}")
def get_project(project_id: str):
    return ok(memory.get_project(project_id))


@app.put("/api/v1/projects/{project_id}")
def put_project(project_id: str, req: ProjectReq):
    return ok(memory.save_project(project_id, req.model_dump()), message="Saved")


# --- static frontend (served last so /api takes priority) -----------------
# In dev, Vite serves the UI on FRONTEND_PORT and proxies /api here, so this
# mount is unused. For a standalone single-port deploy, `pnpm build` produces
# frontend/dist and this serves it.

if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
