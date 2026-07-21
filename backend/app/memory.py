"""Lightweight JSON-file storage for project memory.

Each "project" (a tab in the UI, e.g. Chapters 1-2) keeps notes, saved cells,
and chat history. Persisted to data/memory.json so it survives restarts —
demonstrating the "memory" property the app advertises. Small scale, no DB.
"""
from __future__ import annotations

import json
import re
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # project root
DATA_DIR = ROOT / "data"
STORE = DATA_DIR / "memory.json"

_lock = threading.Lock()


def _load() -> dict:
    if not STORE.exists():
        return {"projects": {}}
    try:
        return json.loads(STORE.read_text())
    except Exception:
        return {"projects": {}}


def _save(state: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    STORE.write_text(json.dumps(state, indent=2))


def get_project(project_id: str) -> dict:
    with _lock:
        state = _load()
        return state["projects"].get(
            project_id, {"notes": "", "cells": [], "chat": []}
        )


def save_project(project_id: str, project: dict) -> dict:
    with _lock:
        state = _load()
        state["projects"][project_id] = project
        _save(state)
        return project


def append_chat(project_id: str, entry: dict) -> dict:
    with _lock:
        state = _load()
        proj = state["projects"].setdefault(
            project_id, {"notes": "", "cells": [], "chat": []}
        )
        proj["chat"].append(entry)
        _save(state)
        return proj


# --- workspace: named tabs (sessions), each with its own cells + notes -----

def get_workspace() -> dict:
    with _lock:
        state = _load()
        return state.get("workspace") or {"sessions": [], "activeId": None}


def save_workspace(workspace: dict) -> dict:
    with _lock:
        state = _load()
        state["workspace"] = workspace
        _save(state)
        return workspace


# --- R&D strategy state: inputs + results per strategy, sticky across restarts

def get_rd_state(strategy_id: str) -> dict:
    with _lock:
        state = _load()
        return state.get("rd_state", {}).get(strategy_id, {})


def save_rd_state(strategy_id: str, rd_state: dict) -> dict:
    with _lock:
        state = _load()
        state.setdefault("rd_state", {})[strategy_id] = rd_state
        _save(state)
        return rd_state


# --- Lab <-> R&D bridge: find Notebook/Lab cells relevant to a strategy ----

def _normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def find_lab_notes(strategy_name: str, max_sessions: int = 5, max_cells: int = 8) -> list[dict]:
    """Lab (Notebook) tabs whose name loosely matches a strategy's name —
    e.g. a tab called "Efficient Frontier" or "EF test" for the "Efficient
    Frontier" strategy. Matching is a simple case/punctuation-insensitive
    substring check in either direction, no fuzzy scoring — good enough for
    "I named my tab about the same as the strategy."

    Pinned cells are preferred (the whole point of pinning); if a matching
    session has none, its most recent few cells are used instead so there's
    still something to look at.
    """
    target = _normalize(strategy_name)
    if not target:
        return []
    with _lock:
        state = _load()
        sessions = (state.get("workspace") or {}).get("sessions", [])

    out = []
    for s in sessions:
        sname = _normalize(s.get("name", ""))
        if not sname:
            continue
        if target not in sname and sname not in target:
            continue
        cells = s.get("cells", []) or []
        pinned = [c for c in cells if c.get("pinned")]
        chosen = pinned if pinned else cells[-max_cells:]
        if not chosen:
            continue
        out.append({
            "session_id": s.get("id"),
            "session_name": s.get("name"),
            "used_pinned": bool(pinned),
            "cells": [
                {
                    "kind": c.get("kind"), "input": c.get("input"),
                    "code": c.get("code"), "answer": c.get("answer"),
                }
                for c in chosen[:max_cells]
            ],
        })
        if len(out) >= max_sessions:
            break
    return out


# --- R&D custom strategies: user-added, editable code strategies -----------

def list_custom_strategies() -> list[dict]:
    with _lock:
        state = _load()
        return list(state.get("rd_strategies", {}).values())


def get_custom_strategy(strategy_id: str) -> dict | None:
    with _lock:
        state = _load()
        return state.get("rd_strategies", {}).get(strategy_id)


def save_custom_strategy(strategy_id: str, strategy: dict) -> dict:
    with _lock:
        state = _load()
        state.setdefault("rd_strategies", {})[strategy_id] = strategy
        _save(state)
        return strategy


def delete_custom_strategy(strategy_id: str) -> None:
    with _lock:
        state = _load()
        state.get("rd_strategies", {}).pop(strategy_id, None)
        state.get("rd_state", {}).pop(strategy_id, None)
        _save(state)
