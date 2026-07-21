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
    GET  /api/v1/workspace           load all workspace tabs (Lab/Notebook)
    PUT  /api/v1/workspace           save all workspace tabs
    GET  /api/v1/strategies          R&D strategy registry
    POST /api/v1/rd/ef/fetch         Efficient Frontier: fetch prices
    POST /api/v1/rd/ef/returns       Efficient Frontier: prices -> returns
    POST /api/v1/rd/ef/stats         Efficient Frontier: returns -> annual stats
    POST /api/v1/rd/ef/risk-free     Efficient Frontier: a proxy symbol -> its annualized rate
    POST /api/v1/rd/ef/frontier      Efficient Frontier: stats -> simulated portfolios
    POST /api/v1/rd/ef/run           Efficient Frontier: whole pipeline at once
    GET  /api/v1/rd/state/{id}       load a strategy's sticky UI state (inputs/results)
    PUT  /api/v1/rd/state/{id}       save a strategy's sticky UI state
    GET  /api/v1/rd/lab-notes        Notebook/Lab tabs + pinned cells matching a strategy name
    GET    /api/v1/rd/strategies            list user-added custom strategies
    POST   /api/v1/rd/strategies             add one (seeded from a matching Lab tab if code omitted)
    PUT    /api/v1/rd/strategies/{id}        edit a custom strategy's code/summary
    DELETE /api/v1/rd/strategies/{id}        remove a custom strategy

    Settings — add/remove providers from the app, no code or .env edits needed:
    GET    /api/v1/settings/data-providers            list market-data providers
    POST   /api/v1/settings/data-providers             add one
    DELETE /api/v1/settings/data-providers/{id}        remove (or disable the built-in)
    PUT    /api/v1/settings/data-providers/{id}/enabled toggle on/off
    PUT    /api/v1/settings/data-providers/{id}/active  make it the active one
    GET    /api/v1/settings/llm-providers               list LLM providers + models
    POST   /api/v1/settings/llm-providers                add a custom provider
    DELETE /api/v1/settings/llm-providers/{id}          remove (default or custom)
    POST   /api/v1/settings/llm-providers/{id}/restore   un-remove a default provider
    PUT    /api/v1/settings/llm-providers/{id}/key       set/replace its API key from the app
    POST   /api/v1/settings/llm-providers/{id}/models    add a custom model
    DELETE /api/v1/settings/llm-providers/{id}/models/{model_id}   remove a model
    POST   /api/v1/settings/llm-providers/{id}/models/{model_id}/restore
    POST   /api/v1/settings/llm-providers/{id}/refresh   pull the provider's current model list
"""
from __future__ import annotations

import datetime as dt
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
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from genai_trader import config as cfg  # noqa: E402
from genai_trader.llm import (  # noqa: E402
    list_providers, models_for, provider_ready, chat as llm_chat,
    estimate_cost, cost_from_tokens, ProviderError, list_available_models, overlay as llm_overlay,
)
from genai_trader import strategies as strat  # noqa: E402
from .envelope import ok, err  # noqa: E402
from .kernel import KernelSession  # noqa: E402
from . import memory  # noqa: E402

app = FastAPI(title="trade_genai API", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

# The kernel imports matplotlib, which builds a font cache the very first time
# it runs in a fresh environment (or after the cache dir is cleared) — a
# one-time delay of several seconds to ~1 minute, not something that scales
# with how many Notebook/Lab tabs exist or how much is saved. It happens here,
# before the server starts accepting requests, so it's absorbed into startup
# rather than surprising you on your first chart. Every run after the first on
# the same machine should be fast.
print("Starting kernel (first run on a machine may take up to a minute while "
      "matplotlib builds its font cache — this is one-time, unrelated to how "
      "many tabs or cells you have saved)...", flush=True)
kernel = KernelSession()
print("Kernel ready.", flush=True)
FRONTEND_DIST = ROOT / "frontend" / "dist"  # Vite production build


# --- request models -------------------------------------------------------

class RunReq(BaseModel):
    code: str


class ChatReq(BaseModel):
    provider: str
    model: str
    messages: list[dict]
    max_tokens: int = 4096


class AgentReq(BaseModel):
    provider: str
    model: str
    messages: list[dict]
    max_tokens: int = 4096


class ProjectReq(BaseModel):
    notes: str = ""
    cells: list = []
    chat: list = []


class WorkspaceReq(BaseModel):
    sessions: list = []
    activeId: str | None = None


class EFFetchReq(BaseModel):
    symbols: list[str]
    start: str  # YYYY-MM-DD
    end: str


class EFReturnsReq(BaseModel):
    wide: dict
    kind: str = "simple"  # "simple" | "log"


class EFStatsReq(BaseModel):
    returns: dict
    periods_per_year: int = 252


class EFRiskFreeReq(BaseModel):
    symbol: str
    start: str
    end: str


class EFFrontierReq(BaseModel):
    annual_returns: dict
    cov_matrix: dict
    risk_free_rate: float = 0.0
    risk_free_label: str = "Risk-Free"
    n_portfolios: int = 10_000
    exclude: list[str] = []


class EFRunReq(BaseModel):
    symbols: list[str]
    start: str
    end: str
    kind: str = "simple"
    risk_free_rate: float = 0.0
    risk_free_label: str = "Risk-Free"
    n_portfolios: int = 10_000
    exclude: list[str] = []


class RDStateReq(BaseModel):
    state: dict = {}


class LabNotesQuery(BaseModel):
    name: str


class RDStrategyReq(BaseModel):
    name: str
    summary: str = ""
    code: str = ""


class DataProviderReq(BaseModel):
    name: str
    rest_url: str
    api_key: str
    kind: str = "polygon_compatible"


class EnabledReq(BaseModel):
    enabled: bool


class LLMProviderReq(BaseModel):
    label: str
    base_url: str
    api_key: str = ""
    compat: str = "openai"
    has_free_tier: bool = False
    docs_url: str = ""


class LLMKeyReq(BaseModel):
    api_key: str


class LLMModelReq(BaseModel):
    id: str
    label: str = ""
    tier: str = "paid"
    input_price: float = 0.0
    output_price: float = 0.0
    context: int = 128_000
    note: str = ""


# --- status & registry ----------------------------------------------------

@app.get("/api/v1/status")
def status():
    data_providers = cfg.list_data_providers()
    providers = [
        {**p, "ready": provider_ready(p["id"])} for p in list_providers()
    ]
    return ok({"data_providers": data_providers, "providers": providers})


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

def _attach_cost(result: dict, provider: str, model: str, messages: list[dict]) -> dict:
    """Prefer the provider's own reported token counts for cost (accurate);
    fall back to a word-count estimate only if the provider didn't report usage."""
    usage = result.get("usage") or {}
    tok_in, tok_out = usage.get("input_tokens"), usage.get("output_tokens")
    if tok_in is not None and tok_out is not None:
        cost = cost_from_tokens(provider, model, tok_in, tok_out)
    else:
        words_in = sum(len(m.get("content", "").split()) for m in messages)
        words_out = len(result.get("text", "").split())
        cost = estimate_cost(provider, model, words_in, words_out)
    result["est_cost_usd"] = round(cost, 5)
    return result


@app.post("/api/v1/chat")
def chat(req: ChatReq):
    try:
        result = llm_chat(req.provider, req.model, req.messages, max_tokens=req.max_tokens)
    except ProviderError as exc:
        return err(str(exc), status=400)
    except Exception as exc:  # upstream API error
        return err(f"Provider request failed: {exc}", status=502)
    return ok(_attach_cost(result, req.provider, req.model, req.messages))


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

    priced = _attach_cost(dict(result), req.provider, req.model, req.messages)
    return ok({
        "provider": req.provider,
        "model": req.model,
        "text": text,
        "code": code,
        "execution": execution,
        "usage": priced.get("usage", {}),
        "est_cost_usd": priced["est_cost_usd"],
    })


# --- project memory -------------------------------------------------------

@app.get("/api/v1/projects/{project_id}")
def get_project(project_id: str):
    return ok(memory.get_project(project_id))


@app.put("/api/v1/projects/{project_id}")
def put_project(project_id: str, req: ProjectReq):
    return ok(memory.save_project(project_id, req.model_dump()), message="Saved")


# --- workspace (named tabs / sessions) ------------------------------------

@app.get("/api/v1/workspace")
def get_workspace():
    return ok(memory.get_workspace())


@app.put("/api/v1/workspace")
def put_workspace(req: WorkspaceReq):
    return ok(memory.save_workspace(req.model_dump()), message="Saved")


# --- R&D: strategy registry + Efficient Frontier pipeline ------------------
# A "table" over the wire is {index, index_name, columns, data} — a date-indexed
# DataFrame in JSON form (NaN -> null). Each pipeline step below is exposed as
# its own endpoint so the UI can run/inspect one step at a time, plus a single
# /run endpoint that does the whole pipeline in one call.

def _table(df: "pd.DataFrame", index_name: str = "date") -> dict:
    idx = df.index
    index = idx.strftime("%Y-%m-%d").tolist() if hasattr(idx, "strftime") else [str(x) for x in idx]
    data = [[None if pd.isna(v) else float(v) for v in row] for row in df.to_numpy()]
    return {"index": index, "index_name": index_name, "columns": [str(c) for c in df.columns], "data": data}


def _wide_from_table(t: dict, index_is_date: bool = True) -> "pd.DataFrame":
    index = pd.to_datetime(t["index"]) if index_is_date else t["index"]
    return pd.DataFrame(t["data"], columns=t["columns"], index=index)


def _parse_symbols(symbols: list[str]) -> list[str]:
    return [s.strip().upper() for s in symbols if s and s.strip()]


@app.get("/api/v1/strategies")
def strategies():
    return ok([
        {
            "id": "efficient_frontier",
            "name": "Efficient Frontier",
            "summary": "Fetch a symbol basket, transform prices into returns, then "
                       "simulate long-only random portfolios to find the best allocation.",
        },
    ])


@app.post("/api/v1/rd/ef/fetch")
def ef_fetch(req: EFFetchReq):
    symbols = _parse_symbols(req.symbols)
    if not symbols:
        return err("Provide at least one symbol.", status=400)
    try:
        start = dt.date.fromisoformat(req.start)
        end = dt.date.fromisoformat(req.end)
    except ValueError:
        return err("Dates must be YYYY-MM-DD.", status=400)
    try:
        long_df = strat.fetch_prices(symbols, start, end)
    except Exception as exc:
        return err(f"Fetch failed: {exc}", status=502)
    if long_df.empty:
        return err("No data returned for these symbols / date range.", status=400)
    wide = strat.to_wide_adj_close(long_df)
    preview = long_df.copy()
    preview["date"] = preview["date"].dt.strftime("%Y-%m-%d")
    return ok({
        "raw_preview": preview.head(20).to_dict(orient="records"),
        "raw_row_count": int(len(long_df)),
        "wide": _table(wide),
    })


@app.post("/api/v1/rd/ef/returns")
def ef_returns(req: EFReturnsReq):
    try:
        wide = _wide_from_table(req.wide)
        returns = strat.compute_returns(wide, kind=req.kind)
        if returns.empty:
            return err("Not enough overlapping data to compute returns.", status=400)
        return ok({"returns": _table(returns)})
    except Exception as exc:
        return err(f"Transform failed: {exc}", status=400)


@app.post("/api/v1/rd/ef/stats")
def ef_stats(req: EFStatsReq):
    try:
        returns = _wide_from_table(req.returns)
        annual_returns, cov = strat.annualize(returns, periods_per_year=req.periods_per_year)
        return ok({
            "annual_returns": {k: float(v) for k, v in annual_returns.items()},
            "cov_matrix": _table(cov, index_name="symbol"),
        })
    except Exception as exc:
        return err(f"Stats failed: {exc}", status=400)


@app.post("/api/v1/rd/ef/risk-free")
def ef_risk_free(req: EFRiskFreeReq):
    """Real, data-backed risk-free rate from a proxy symbol (e.g. BIL, SHY) —
    its own annualized mean return over the same window, so you're not
    guessing a percentage."""
    try:
        start = dt.date.fromisoformat(req.start)
        end = dt.date.fromisoformat(req.end)
    except ValueError:
        return err("Dates must be YYYY-MM-DD.", status=400)
    try:
        rate = strat.risk_free_annual_rate(req.symbol.strip().upper(), start, end)
        return ok({"symbol": req.symbol.strip().upper(), "annual_rate": rate})
    except ValueError as exc:
        return err(str(exc), status=400)
    except Exception as exc:
        return err(f"Fetch failed: {exc}", status=502)


def _apply_exclude(annual_returns: pd.Series, cov: pd.DataFrame, exclude: list[str]):
    """Drop manually-excluded symbols from the return vector and covariance
    matrix right before simulation — lets the user rule out a stock from the
    result without re-fetching or re-transforming anything upstream."""
    if not exclude:
        return annual_returns, cov
    drop = {s.strip().upper() for s in exclude if s and s.strip()}
    keep = [s for s in annual_returns.index if s.upper() not in drop]
    if not keep:
        raise ValueError("Excluding all symbols leaves nothing to simulate — keep at least one.")
    return annual_returns.reindex(keep), cov.reindex(index=keep, columns=keep)


def _simulate(annual_returns: pd.Series, cov: pd.DataFrame, risk_free_rate: float,
             risk_free_label: str, n_portfolios: int) -> dict:
    """Branches on symbol count: 2+ risky assets get the normal random-portfolio
    simulation; exactly 1 gets blended with the risk-free asset instead (see
    simulate_single_asset's docstring for why that case is handled differently)."""
    if len(annual_returns) == 1:
        symbol = annual_returns.index[0]
        mu = float(annual_returns.iloc[0])
        vol = float(np.sqrt(cov.iloc[0, 0]))
        return strat.simulate_single_asset(
            symbol, mu, vol, risk_free_label or "Risk-Free", risk_free_rate, n_portfolios=n_portfolios
        )
    return strat.simulate_portfolios(
        annual_returns, cov, risk_free_rate=risk_free_rate, n_portfolios=n_portfolios
    )


@app.post("/api/v1/rd/ef/frontier")
def ef_frontier(req: EFFrontierReq):
    try:
        mu = pd.Series(req.annual_returns)
        cov = _wide_from_table(req.cov_matrix, index_is_date=False)
        mu, cov = _apply_exclude(mu, cov, req.exclude)
        result = _simulate(mu, cov, req.risk_free_rate, req.risk_free_label, req.n_portfolios)
        return ok(result)
    except ValueError as exc:
        return err(str(exc), status=400)
    except Exception as exc:
        return err(f"Simulation failed: {exc}", status=400)


@app.post("/api/v1/rd/ef/run")
def ef_run(req: EFRunReq):
    """Whole pipeline in one call: fetch -> returns -> stats -> simulate."""
    symbols = _parse_symbols(req.symbols)
    if not symbols:
        return err("Provide at least one symbol.", status=400)
    try:
        start = dt.date.fromisoformat(req.start)
        end = dt.date.fromisoformat(req.end)
    except ValueError:
        return err("Dates must be YYYY-MM-DD.", status=400)
    try:
        long_df = strat.fetch_prices(symbols, start, end)
        if long_df.empty:
            return err("No data returned for these symbols / date range.", status=400)
        wide = strat.to_wide_adj_close(long_df)
        returns = strat.compute_returns(wide, kind=req.kind)
        if returns.empty:
            return err("Not enough overlapping data to compute returns.", status=400)
        annual_returns, cov = strat.annualize(returns)
        sim_returns, sim_cov = _apply_exclude(annual_returns, cov, req.exclude)
        sim = _simulate(sim_returns, sim_cov, req.risk_free_rate, req.risk_free_label, req.n_portfolios)
        preview = long_df.copy()
        preview["date"] = preview["date"].dt.strftime("%Y-%m-%d")
        return ok({
            "raw_preview": preview.head(20).to_dict(orient="records"),
            "raw_row_count": int(len(long_df)),
            "wide": _table(wide),
            "returns": _table(returns),
            "annual_returns": {k: float(v) for k, v in annual_returns.items()},
            "cov_matrix": _table(cov, index_name="symbol"),
            **sim,
        })
    except ValueError as exc:
        return err(str(exc), status=400)
    except Exception as exc:
        return err(f"Run failed: {exc}", status=502)


# --- R&D strategy state: sticky inputs/results across sessions -------------

@app.get("/api/v1/rd/state/{strategy_id}")
def get_rd_state_ep(strategy_id: str):
    return ok(memory.get_rd_state(strategy_id))


@app.put("/api/v1/rd/state/{strategy_id}")
def put_rd_state_ep(strategy_id: str, req: RDStateReq):
    return ok(memory.save_rd_state(strategy_id, req.state), message="Saved")


# --- Lab <-> R&D bridge -----------------------------------------------------

@app.get("/api/v1/rd/lab-notes")
def rd_lab_notes(name: str):
    """Notebook/Lab tabs whose name loosely matches a strategy name, with their
    pinned (or most recent) cells — a read-only reference so R&D work can build
    on what was already tried and liked in the Lab."""
    return ok({"matches": memory.find_lab_notes(name)})


# --- R&D custom strategies: user-added editable-code strategies ------------

def _rd_strategy_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return slug or "strategy"


@app.get("/api/v1/rd/strategies")
def rd_strategies_list():
    return ok(memory.list_custom_strategies())


@app.post("/api/v1/rd/strategies")
def rd_strategies_create(req: RDStrategyReq):
    if not req.name.strip():
        return err("Strategy name is required.", status=400)
    strategy_id = _rd_strategy_id(req.name)
    if memory.get_custom_strategy(strategy_id):
        return err("A custom strategy with this name already exists.", status=409)
    lab_matches = memory.find_lab_notes(req.name)
    code = req.code
    seeded_from = None
    if not code and lab_matches:
        # Seed from the first matching (done) Lab tab's most recent code cell,
        # if the user didn't already paste something in themselves.
        for cell in reversed(lab_matches[0]["cells"]):
            if cell.get("code"):
                code = cell["code"]
                seeded_from = lab_matches[0]["session_name"]
                break
    strategy = {
        "id": strategy_id, "name": req.name.strip(),
        "summary": req.summary.strip(), "code": code,
        # Name-matching isn't verification — flag it so the UI can prompt a
        # review rather than implying the pulled-in code is already correct
        # for this strategy.
        "seeded_from": seeded_from, "reviewed": seeded_from is None,
    }
    memory.save_custom_strategy(strategy_id, strategy)
    return ok(strategy, message="Strategy created")


@app.put("/api/v1/rd/strategies/{strategy_id}")
def rd_strategies_update(strategy_id: str, req: RDStrategyReq):
    existing = memory.get_custom_strategy(strategy_id)
    if not existing:
        return err("Strategy not found.", status=404)
    strategy = {
        "id": strategy_id, "name": req.name.strip(),
        "summary": req.summary.strip(), "code": req.code,
        "seeded_from": existing.get("seeded_from"),
        # Saving from the UI means the user has looked at (and presumably
        # vetted) the code, so the review nudge doesn't need to keep showing.
        "reviewed": True,
    }
    memory.save_custom_strategy(strategy_id, strategy)
    return ok(strategy, message="Saved")


@app.delete("/api/v1/rd/strategies/{strategy_id}")
def rd_strategies_delete(strategy_id: str):
    memory.delete_custom_strategy(strategy_id)
    return ok(message="Deleted")


# --- Settings: data providers + LLM providers/models, editable from the app -
# Everything here is additive/removable at runtime and persists in the
# git-ignored data/*.json files (see genai_trader/config.py and
# genai_trader/llm/overlay.py) — no restart or code edit required. Keys
# entered here never come back in plaintext, only masked.

@app.get("/api/v1/settings/data-providers")
def list_data_providers_ep():
    return ok({"providers": cfg.list_data_providers()})


@app.post("/api/v1/settings/data-providers")
def add_data_provider_ep(req: DataProviderReq):
    try:
        p = cfg.add_data_provider(req.name, req.rest_url, req.api_key, req.kind)
        return ok(p, message="Added")
    except ValueError as exc:
        return err(str(exc), status=400)


@app.delete("/api/v1/settings/data-providers/{provider_id}")
def remove_data_provider_ep(provider_id: str):
    cfg.remove_data_provider(provider_id)
    return ok(message="Removed")


@app.put("/api/v1/settings/data-providers/{provider_id}/enabled")
def set_data_provider_enabled_ep(provider_id: str, req: EnabledReq):
    cfg.set_data_provider_enabled(provider_id, req.enabled)
    return ok(message="Updated")


@app.put("/api/v1/settings/data-providers/{provider_id}/active")
def set_active_data_provider_ep(provider_id: str):
    cfg.set_active_data_provider(provider_id)
    return ok(message="Active provider set")


@app.get("/api/v1/settings/llm-providers")
def list_llm_providers_ep():
    data = [
        {**p, "ready": provider_ready(p["id"]), "models": models_for(p["id"])}
        for p in list_providers()
    ]
    return ok(data)


@app.post("/api/v1/settings/llm-providers")
def add_llm_provider_ep(req: LLMProviderReq):
    try:
        p = llm_overlay.add_custom_provider(
            req.label, req.base_url, req.api_key, compat=req.compat,
            has_free_tier=req.has_free_tier, docs_url=req.docs_url,
        )
        return ok(p, message="Added")
    except ValueError as exc:
        return err(str(exc), status=400)


@app.delete("/api/v1/settings/llm-providers/{provider_id}")
def remove_llm_provider_ep(provider_id: str):
    llm_overlay.remove_provider(provider_id)
    return ok(message="Removed")


@app.post("/api/v1/settings/llm-providers/{provider_id}/restore")
def restore_llm_provider_ep(provider_id: str):
    llm_overlay.restore_provider(provider_id)
    return ok(message="Restored")


@app.put("/api/v1/settings/llm-providers/{provider_id}/key")
def set_llm_provider_key_ep(provider_id: str, req: LLMKeyReq):
    """Set/replace a provider's API key from the app — works for built-in
    providers too (a non-technical alternative to editing .env.local; the
    env var still wins if both are set)."""
    llm_overlay.set_llm_secret(provider_id, req.api_key)
    return ok(message="Key saved")


@app.post("/api/v1/settings/llm-providers/{provider_id}/models")
def add_llm_model_ep(provider_id: str, req: LLMModelReq):
    try:
        m = llm_overlay.add_custom_model(
            provider_id, req.id, label=req.label, tier=req.tier,
            input_price=req.input_price, output_price=req.output_price,
            context=req.context, note=req.note,
        )
        return ok(m, message="Added")
    except ValueError as exc:
        return err(str(exc), status=400)


@app.delete("/api/v1/settings/llm-providers/{provider_id}/models/{model_id}")
def remove_llm_model_ep(provider_id: str, model_id: str):
    llm_overlay.remove_model(provider_id, model_id)
    return ok(message="Removed")


@app.post("/api/v1/settings/llm-providers/{provider_id}/models/{model_id}/restore")
def restore_llm_model_ep(provider_id: str, model_id: str):
    llm_overlay.restore_model(provider_id, model_id)
    return ok(message="Restored")


@app.post("/api/v1/settings/llm-providers/{provider_id}/refresh")
def refresh_llm_provider_ep(provider_id: str):
    """Pull the provider's own current model list (best-effort) and merge it
    in as "discovered" models — this is how new releases show up, and how
    models the provider has retired quietly drop off, without a code change.
    """
    ids = list_available_models(provider_id)
    if not ids:
        return err(
            "Couldn't fetch this provider's model list — check its API key, "
            "or it may not expose a list-models endpoint this app knows how to call.",
            status=400,
        )
    llm_overlay.set_discovered_models(provider_id, ids)
    return ok({"discovered": ids}, message=f"Found {len(ids)} models")


# --- static frontend (served last so /api takes priority) -----------------
# In dev, Vite serves the UI on FRONTEND_PORT and proxies /api here, so this
# mount is unused. For a standalone single-port deploy, `pnpm build` produces
# frontend/dist and this serves it.

if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
