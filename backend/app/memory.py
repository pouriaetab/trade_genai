"""Lightweight JSON-file storage for project memory.

Each "project" (a tab in the UI, e.g. Chapters 1-2) keeps notes, saved cells,
and chat history. Persisted to data/memory.json so it survives restarts —
demonstrating the "memory" property the app advertises. Small scale, no DB.
"""
from __future__ import annotations

import json
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
