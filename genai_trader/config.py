"""Secure configuration loading.

The Massive (formerly Polygon) API key is read from `.env.local`, which is
git-ignored. The key is NEVER printed, logged, or returned by __repr__ — only a
masked form is ever exposed, so it can't leak into notebook output, the webapp,
or tracebacks.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

# Project root = parent of this package directory.
ROOT = Path(__file__).resolve().parent.parent


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


@dataclass(frozen=True)
class Settings:
    api_key: str = field(repr=False)  # never shown in repr/logs
    rest_url: str = "https://api.massive.com"
    timeout_seconds: float = 45.0

    @property
    def masked_key(self) -> str:
        if not self.api_key:
            return "<missing>"
        if len(self.api_key) <= 8:
            return "*" * len(self.api_key)
        return f"{self.api_key[:4]}…{self.api_key[-4:]}"

    def __str__(self) -> str:  # safe: no full key
        return (
            f"Settings(rest_url={self.rest_url!r}, "
            f"timeout_seconds={self.timeout_seconds}, api_key={self.masked_key})"
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings, loading .env.local on first call."""
    _load_dotenv()
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "MASSIVE_API_KEY is not set. Copy .env.example to .env.local and "
            "add your Massive key (see README)."
        )
    rest_url = os.environ.get("MASSIVE_REST_URL", "https://api.massive.com").rstrip("/")
    timeout = float(os.environ.get("MASSIVE_TIMEOUT_SECONDS", "45"))
    return Settings(api_key=api_key, rest_url=rest_url, timeout_seconds=timeout)
