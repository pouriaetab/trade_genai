"""Secure configuration loading — and the market-data *provider* registry.

Two ways to configure a market-data provider, both first-class:

  1. Technical / `.env.local`: set MASSIVE_API_KEY (and optionally
     MASSIVE_REST_URL) and it's auto-detected on startup as the built-in
     "Massive" provider — no UI needed. This still works exactly as before.
  2. Non-technical / webapp: add, edit, disable, or remove data providers from
     the app's Settings tab. Those entries (name + REST URL) persist in the
     git-ignored `data/providers.json`; their API keys persist in the
     git-ignored `data/secrets.json`, which — like `.env.local` — is never
     committed, printed, or returned in plaintext (only masked).

Only REST APIs shaped like Massive's (the same aggs/dividends endpoint shape,
a common convention several market-data providers share) are understood out
of the box — that's what `genai_trader/data/massive.py` parses. Pointing this
at a different provider using that same shape (Massive is the default here,
but this covers others too) is just a name + URL + key. A provider with a
genuinely different response shape needs a small adapter in that module (a
job for a developer, by design — see the README).

Nothing here ever prints, logs, or repr()s a real key — only a masked form
(`abcd…wxyz`).
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# Project root = parent of this package directory.
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PROVIDERS_FILE = DATA_DIR / "providers.json"
SECRETS_FILE = DATA_DIR / "secrets.json"  # git-ignored — app-entered keys only

BUILTIN_PROVIDER_ID = "massive"
BUILTIN_ENV_VAR = "MASSIVE_API_KEY"
BUILTIN_REST_URL_ENV_VAR = "MASSIVE_REST_URL"
BUILTIN_DEFAULT_REST_URL = "https://api.massive.com"


def _load_dotenv() -> None:
    """Load .env.local (preferred) then .env, without overriding real env vars.

    Uses python-dotenv if available; falls back to a tiny parser so the project
    still works before dependencies are installed.
    """
    candidates = [ROOT / ".env.local", ROOT / ".env"]
    try:
        from dotenv import load_dotenv  # type: ignore

        for path in candidates:
            if path.exists():
                load_dotenv(path, override=False)
        return
    except ImportError:
        pass

    for path in candidates:
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            os.environ.setdefault(key, val)


def _mask(key: str) -> str:
    if not key:
        return "<missing>"
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:4]}…{key[-4:]}"


def _load_json(path: Path, default: dict) -> dict:
    if not path.exists():
        return dict(default)
    try:
        return json.loads(path.read_text())
    except Exception:
        return dict(default)


def _save_json(path: Path, data: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def _providers_state() -> dict:
    return _load_json(PROVIDERS_FILE, {"data_providers": {}, "active_data_provider": None, "disabled": []})


def _secrets_state() -> dict:
    return _load_json(SECRETS_FILE, {"data_providers": {}, "llm_providers": {}})


@dataclass(frozen=True)
class Settings:
    api_key: str = field(repr=False)  # never shown in repr/logs
    rest_url: str = BUILTIN_DEFAULT_REST_URL
    timeout_seconds: float = 45.0

    @property
    def masked_key(self) -> str:
        return _mask(self.api_key)

    def __str__(self) -> str:  # safe: no full key
        return (
            f"Settings(rest_url={self.rest_url!r}, "
            f"timeout_seconds={self.timeout_seconds}, api_key={self.masked_key})"
        )


# --- data provider registry (multi-provider, app + env) --------------------

def list_data_providers() -> list[dict]:
    """Every known data provider: the env-configured built-in plus any added
    from the app, each with a masked key and enabled/configured/active flags.
    """
    _load_dotenv()
    state = _providers_state()
    disabled = set(state.get("disabled", []))
    active_id = state.get("active_data_provider")

    out: list[dict] = []
    env_key = os.environ.get(BUILTIN_ENV_VAR, "").strip()
    rest_url = os.environ.get(BUILTIN_REST_URL_ENV_VAR, BUILTIN_DEFAULT_REST_URL).rstrip("/")
    out.append({
        "id": BUILTIN_PROVIDER_ID, "name": "Massive", "kind": "polygon_compatible",
        "rest_url": rest_url, "source": "env", "env_var": BUILTIN_ENV_VAR,
        "configured": bool(env_key), "masked_key": _mask(env_key),
        "enabled": BUILTIN_PROVIDER_ID not in disabled, "removable": False,
    })

    secrets = _secrets_state().get("data_providers", {})
    for pid, p in state.get("data_providers", {}).items():
        key = secrets.get(pid, "")
        out.append({
            "id": pid, "name": p.get("name", pid), "kind": p.get("kind", "polygon_compatible"),
            "rest_url": p.get("rest_url", ""), "source": "app", "env_var": None,
            "configured": bool(key), "masked_key": _mask(key),
            "enabled": pid not in disabled, "removable": True,
        })

    if active_id is None:
        chosen = next((p for p in out if p["enabled"] and p["configured"]), None)
        active_id = chosen["id"] if chosen else None
    for p in out:
        p["active"] = p["id"] == active_id
    return out


def add_data_provider(name: str, rest_url: str, api_key: str, kind: str = "polygon_compatible") -> dict:
    if not name.strip() or not rest_url.strip() or not api_key.strip():
        raise ValueError("name, rest_url, and api_key are all required.")
    state = _providers_state()
    state.setdefault("data_providers", {})
    base_pid = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-") or "provider"
    pid, i = base_pid, 2
    while pid == BUILTIN_PROVIDER_ID or pid in state["data_providers"]:
        pid = f"{base_pid}-{i}"
        i += 1
    state["data_providers"][pid] = {"name": name.strip(), "rest_url": rest_url.strip().rstrip("/"), "kind": kind}
    _save_json(PROVIDERS_FILE, state)

    secrets = _secrets_state()
    secrets.setdefault("data_providers", {})[pid] = api_key.strip()
    _save_json(SECRETS_FILE, secrets)
    return {"id": pid, **state["data_providers"][pid]}


def remove_data_provider(provider_id: str) -> None:
    if provider_id == BUILTIN_PROVIDER_ID:
        # The built-in comes from .env.local, so "removing" it just disables it.
        set_data_provider_enabled(provider_id, False)
        return
    state = _providers_state()
    state.get("data_providers", {}).pop(provider_id, None)
    if state.get("active_data_provider") == provider_id:
        state["active_data_provider"] = None
    _save_json(PROVIDERS_FILE, state)

    secrets = _secrets_state()
    secrets.get("data_providers", {}).pop(provider_id, None)
    _save_json(SECRETS_FILE, secrets)


def set_data_provider_enabled(provider_id: str, enabled: bool) -> None:
    state = _providers_state()
    disabled = set(state.get("disabled", []))
    if enabled:
        disabled.discard(provider_id)
    else:
        disabled.add(provider_id)
    state["disabled"] = sorted(disabled)
    _save_json(PROVIDERS_FILE, state)


def set_active_data_provider(provider_id: str) -> None:
    state = _providers_state()
    state["active_data_provider"] = provider_id
    _save_json(PROVIDERS_FILE, state)


def get_active_data_provider_settings() -> Settings:
    """Resolve whichever data provider is active (or the first enabled +
    configured one) into a Settings the data client can use.
    """
    _load_dotenv()
    providers = list_data_providers()
    chosen = next((p for p in providers if p["active"] and p["enabled"] and p["configured"]), None)
    if not chosen:
        chosen = next((p for p in providers if p["enabled"] and p["configured"]), None)
    if not chosen:
        raise RuntimeError(
            "No market-data provider is configured. Add MASSIVE_API_KEY to .env.local, "
            "or add a data provider from the app's Settings tab."
        )
    if chosen["id"] == BUILTIN_PROVIDER_ID:
        api_key = os.environ.get(BUILTIN_ENV_VAR, "").strip()
    else:
        api_key = _secrets_state().get("data_providers", {}).get(chosen["id"], "")
    timeout = float(os.environ.get("MASSIVE_TIMEOUT_SECONDS", "45"))
    return Settings(api_key=api_key, rest_url=chosen["rest_url"], timeout_seconds=timeout)


def get_settings() -> Settings:
    """Back-compat entry point used throughout genai_trader — resolves to
    whichever data provider is currently active."""
    return get_active_data_provider_settings()
