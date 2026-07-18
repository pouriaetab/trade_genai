"""Provider-agnostic chat client.

`chat(provider, model, messages)` sends an OpenAI-style message list to any
supported provider and returns a normalized dict. The API key is read from the
provider's env var (loaded from .env.local) at call time — never hard-coded.

Supported: gemini, groq, openrouter, anthropic, openai, xai.
Groq / xAI / OpenRouter use the OpenAI-compatible chat/completions schema.

On an HTTP error we raise ProviderError with the provider's own message (not a
bare status code), and for Gemini we append the models your key can actually use
so a wrong model name is self-correcting.
"""
from __future__ import annotations

import os

import requests

from ..config import _load_dotenv
from .registry import PROVIDERS, get_model

DEFAULT_TIMEOUT = 60
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"


class ProviderError(RuntimeError):
    """Raised when a provider isn't configured or the request fails."""


def _api_key(provider_id: str) -> str:
    _load_dotenv()
    p = PROVIDERS.get(provider_id)
    if not p:
        raise ProviderError(f"Unknown provider: {provider_id}")
    key = os.environ.get(p.env_var, "").strip()
    if not key:
        raise ProviderError(
            f"No API key for {p.label}. Add {p.env_var} to .env.local to enable it. "
            f"See {p.docs_url}."
        )
    return key


def provider_ready(provider_id: str) -> bool:
    _load_dotenv()
    p = PROVIDERS.get(provider_id)
    return bool(p and os.environ.get(p.env_var, "").strip())


def _err_message(resp) -> str:
    try:
        body = resp.json()
        if isinstance(body, dict):
            e = body.get("error")
            if isinstance(e, dict):
                return e.get("message") or str(e)
            if isinstance(e, str):
                return e
        return str(body)[:400]
    except Exception:
        return (resp.text or "")[:400]


# --- OpenAI-compatible providers -----------------------------------------

_OPENAI_COMPAT = {
    "openai": "https://api.openai.com/v1/chat/completions",
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "xai": "https://api.x.ai/v1/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
}


def _chat_openai_compat(provider_id, label, model, messages, max_tokens, temperature):
    key = _api_key(provider_id)
    body = {"model": model, "messages": messages,
            "max_tokens": max_tokens, "temperature": temperature}
    r = requests.post(
        _OPENAI_COMPAT[provider_id], json=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        timeout=DEFAULT_TIMEOUT,
    )
    if r.status_code >= 400:
        raise ProviderError(f"{label} error {r.status_code}: {_err_message(r)}")
    data = r.json()
    return {"text": data["choices"][0]["message"]["content"], "usage": data.get("usage", {})}


def _chat_anthropic(model, messages, max_tokens, temperature):
    key = _api_key("anthropic")
    system = "\n".join(m["content"] for m in messages if m["role"] == "system")
    convo = [m for m in messages if m["role"] != "system"]
    body = {"model": model, "max_tokens": max_tokens, "temperature": temperature,
            "messages": convo}
    if system:
        body["system"] = system
    r = requests.post(
        "https://api.anthropic.com/v1/messages", json=body,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "Content-Type": "application/json"},
        timeout=DEFAULT_TIMEOUT,
    )
    if r.status_code >= 400:
        raise ProviderError(f"Claude error {r.status_code}: {_err_message(r)}")
    data = r.json()
    text = "".join(b.get("text", "") for b in data.get("content", []))
    return {"text": text, "usage": data.get("usage", {})}


def _gemini_models(key: str) -> list[str]:
    """Model ids the key can use with generateContent (best-effort)."""
    try:
        r = requests.get(f"{GEMINI_BASE}/models?key={key}", timeout=20)
        if r.status_code >= 400:
            return []
        out = []
        for m in r.json().get("models", []):
            if "generateContent" in (m.get("supportedGenerationMethods") or []):
                out.append(m.get("name", "").replace("models/", ""))
        return out
    except Exception:
        return []


def _chat_gemini(model, messages, max_tokens, temperature):
    key = _api_key("gemini")
    contents, system = [], []
    for m in messages:
        if m["role"] == "system":
            system.append(m["content"])
        else:
            role = "user" if m["role"] == "user" else "model"
            contents.append({"role": role, "parts": [{"text": m["content"]}]})
    body = {"contents": contents,
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature}}
    if system:
        body["systemInstruction"] = {"parts": [{"text": "\n".join(system)}]}
    url = f"{GEMINI_BASE}/models/{model}:generateContent?key={key}"
    r = requests.post(url, json=body, headers={"Content-Type": "application/json"},
                      timeout=DEFAULT_TIMEOUT)
    if r.status_code >= 400:
        detail = _err_message(r)
        if r.status_code == 404:
            avail = _gemini_models(key)
            if avail:
                detail += " | Models your key supports: " + ", ".join(avail[:12])
            else:
                detail += (" | Could not list models — check that GEMINI_API_KEY is an "
                           "AI Studio key (starts with 'AIza') from https://aistudio.google.com/apikey")
        raise ProviderError(f"Gemini error {r.status_code}: {detail}")
    data = r.json()
    cands = data.get("candidates") or []
    if not cands:
        raise ProviderError(f"Gemini returned no candidates: {_err_message(r)}")
    parts = cands[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts)
    return {"text": text, "usage": data.get("usageMetadata", {})}


def chat(provider: str, model: str, messages: list[dict],
         max_tokens: int = 1024, temperature: float = 0.7) -> dict:
    """Send a chat request. `messages` = [{"role","content"}]. Returns
    {provider, model, text, usage}."""
    label = PROVIDERS[provider].label if provider in PROVIDERS else provider
    if provider in _OPENAI_COMPAT:
        result = _chat_openai_compat(provider, label, model, messages, max_tokens, temperature)
    elif provider == "anthropic":
        result = _chat_anthropic(model, messages, max_tokens, temperature)
    elif provider == "gemini":
        result = _chat_gemini(model, messages, max_tokens, temperature)
    else:
        raise ProviderError(f"Unsupported provider: {provider}")
    return {"provider": provider, "model": model, **result}
