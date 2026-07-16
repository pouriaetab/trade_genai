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

import sys
from pathlib import Path

# Make the genai_trader library importable when run from anywhere.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
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
FRONTEND = ROOT / "frontend"


# --- request models -------------------------------------------------------

class RunReq(BaseModel):
    code: str


class ChatReq(BaseModel):
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


# --- project memory -------------------------------------------------------

@app.get("/api/v1/projects/{project_id}")
def get_project(project_id: str):
    return ok(memory.get_project(project_id))


@app.put("/api/v1/projects/{project_id}")
def put_project(project_id: str, req: ProjectReq):
    return ok(memory.save_project(project_id, req.model_dump()), message="Saved")


# --- static frontend (served last so /api takes priority) -----------------

if FRONTEND.exists():
    @app.get("/")
    def index():
        return FileResponse(FRONTEND / "index.html")

    app.mount("/", StaticFiles(directory=str(FRONTEND)), name="frontend")
