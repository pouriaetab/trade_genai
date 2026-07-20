"""Persisted, user-editable overlay on top of the curated LLM registry.

`registry.py` ships a curated list of recent models from a handful of major
providers — a sane, working-out-of-the-box default. This module lets that
default be *changed*, from the app or by hand, without touching code:

  - remove any provider or model (including the curated defaults)
  - add a fully custom provider (any OpenAI-chat-compatible API — most
    providers, e.g. Together/Fireworks/DeepSeek-direct/Perplexity, speak this)
  - add a custom model under any provider
  - "discover" a provider's currently-available models by calling its real
    list-models endpoint, so the picker can pick up new releases (or drop
    retired ones) without a code change

Everything here persists in the git-ignored `data/model_registry.json`
(structure/labels only) and `data/secrets.json` (API keys for app-added
providers — never the curated ones, which stay in `.env.local`).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "data"
OVERLAY_FILE = DATA_DIR / "model_registry.json"
SECRETS_FILE = DATA_DIR / "secrets.json"

_DEFAULT_OVERLAY = {
    "removed_providers": [],
    "removed_models": {},        # {provider_id: [model_id, ...]}
    "custom_providers": {},      # {provider_id: {label, env_var, has_free_tier, docs_url, base_url, compat}}
    "custom_models": {},         # {provider_id: [{id, label, tier, input_price, output_price, context, note}]}
    "discovered_models": {},     # {provider_id: [model_id, ...]}  — from the last "refresh" call
}


def _load_json(path: Path, default: dict) -> dict:
    if not path.exists():
        return json.loads(json.dumps(default))  # deep copy
    try:
        return json.loads(path.read_text())
    except Exception:
        return json.loads(json.dumps(default))


def _save_json(path: Path, data: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def load() -> dict:
    ov = _load_json(OVERLAY_FILE, _DEFAULT_OVERLAY)
    for k, v in _DEFAULT_OVERLAY.items():
        ov.setdefault(k, json.loads(json.dumps(v)))
    return ov


def save(ov: dict) -> None:
    _save_json(OVERLAY_FILE, ov)


def _secrets() -> dict:
    return _load_json(SECRETS_FILE, {"data_providers": {}, "llm_providers": {}})


def _save_secrets(s: dict) -> None:
    _save_json(SECRETS_FILE, s)


def get_llm_secret(provider_id: str) -> str:
    return _secrets().get("llm_providers", {}).get(provider_id, "")


def set_llm_secret(provider_id: str, api_key: str) -> None:
    s = _secrets()
    s.setdefault("llm_providers", {})[provider_id] = api_key.strip()
    _save_secrets(s)


def get_custom_provider(provider_id: str) -> dict | None:
    return load().get("custom_providers", {}).get(provider_id)


# --- mutations ---------------------------------------------------------

def remove_provider(provider_id: str) -> None:
    ov = load()
    if provider_id in ov.get("custom_providers", {}):
        ov["custom_providers"].pop(provider_id, None)
        ov.get("custom_models", {}).pop(provider_id, None)
        ov.get("discovered_models", {}).pop(provider_id, None)
        s = _secrets()
        s.get("llm_providers", {}).pop(provider_id, None)
        _save_secrets(s)
    else:
        removed = set(ov.get("removed_providers", []))
        removed.add(provider_id)
        ov["removed_providers"] = sorted(removed)
    save(ov)


def restore_provider(provider_id: str) -> None:
    """Un-remove a curated default provider."""
    ov = load()
    ov["removed_providers"] = [p for p in ov.get("removed_providers", []) if p != provider_id]
    save(ov)


def remove_model(provider_id: str, model_id: str) -> None:
    ov = load()
    ov.setdefault("removed_models", {}).setdefault(provider_id, [])
    if model_id not in ov["removed_models"][provider_id]:
        ov["removed_models"][provider_id].append(model_id)
    # also drop it from custom/discovered if it lives there
    ov.get("custom_models", {}).get(provider_id, [])[:] = [
        m for m in ov.get("custom_models", {}).get(provider_id, []) if m["id"] != model_id
    ]
    ov.get("discovered_models", {}).get(provider_id, [])[:] = [
        m for m in ov.get("discovered_models", {}).get(provider_id, []) if m != model_id
    ]
    save(ov)


def restore_model(provider_id: str, model_id: str) -> None:
    ov = load()
    lst = ov.get("removed_models", {}).get(provider_id, [])
    ov.setdefault("removed_models", {})[provider_id] = [m for m in lst if m != model_id]
    save(ov)


def add_custom_provider(label: str, base_url: str, api_key: str, compat: str = "openai",
                        has_free_tier: bool = False, docs_url: str = "") -> dict:
    if not label.strip() or not base_url.strip():
        raise ValueError("label and base_url are required.")
    ov = load()
    base_id = re.sub(r"[^a-z0-9]+", "-", label.strip().lower()).strip("-") or "provider"
    from .registry import PROVIDERS  # local import avoids a circular import at module load
    pid, i = base_id, 2
    while pid in PROVIDERS or pid in ov.get("custom_providers", {}):
        pid = f"{base_id}-{i}"
        i += 1
    ov.setdefault("custom_providers", {})[pid] = {
        "label": label.strip(), "base_url": base_url.strip().rstrip("/"),
        "compat": compat, "has_free_tier": has_free_tier, "docs_url": docs_url,
    }
    save(ov)
    if api_key.strip():
        set_llm_secret(pid, api_key)
    return {"id": pid, **ov["custom_providers"][pid]}


def add_custom_model(provider_id: str, model_id: str, label: str = "", tier: str = "paid",
                     input_price: float = 0.0, output_price: float = 0.0,
                     context: int = 128_000, note: str = "") -> dict:
    if not model_id.strip():
        raise ValueError("model_id is required.")
    ov = load()
    entry = {
        "id": model_id.strip(), "label": label.strip() or model_id.strip(), "tier": tier,
        "input_price": float(input_price), "output_price": float(output_price),
        "context": int(context), "note": note,
    }
    lst = ov.setdefault("custom_models", {}).setdefault(provider_id, [])
    lst[:] = [m for m in lst if m["id"] != entry["id"]] + [entry]
    save(ov)
    return entry


def set_discovered_models(provider_id: str, model_ids: list[str]) -> None:
    ov = load()
    ov.setdefault("discovered_models", {})[provider_id] = sorted(set(model_ids))
    save(ov)
