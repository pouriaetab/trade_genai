"""Provider-agnostic chat client.

`chat(provider, model, messages)` sends an OpenAI-style message list to any
supported provider and returns a normalized dict. The API key is read from the
provider's env var (loaded from .env.local) at call time — never hard-coded.

Supported: gemini, groq, openrouter, anthropic, openai, xai.
Groq / xAI / OpenRouter use the OpenAI-compatible chat/completions schema.
"""
from __future__ import annotations

import os

import requests

from ..config import _load_dotenv
from .registry import PROVIDERS, get_model

DEFAULT_TIMEOUT = 60


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
    """True if this provider has an API key configured (no request made)."""
    _load_dotenv()
    p = PROVIDERS.get(provider_id)
    return bool(p and os.environ.get(p.env_var, "").strip())


# --- OpenAI-compatible providers -----------------------------------------

_OPENAI_COMPAT = {
    "openai": "https://api.openai.com/v1/chat/completions",
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "xai": "https://api.x.ai/v1/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
}


def _chat_openai_compat(provider_id, model, messages, max_tokens, temperature):
    key = _api_key(provider_id)
    url = _OPENAI_COMPAT[provider_id]
    body = {"model": model, "messages": messages,
            "max_tokens": max_tokens, "temperature": temperature}
    r = requests.post(
        url, json=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        timeout=DEFAULT_TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    choice = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    return {"text": choice, "usage": usage}


def _chat_anthropic(model, messages, max_tokens, temperature):
    key = _api_key("anthropic")
    # Anthropic wants system separate from the message list.
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
    r.raise_for_status()
    data = r.json()
    text = "".join(b.get("text", "") for b in data.get("content", []))
    return {"text": text, "usage": data.get("usage", {})}


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
            "generationConfig": {"maxOutputTokens": max_tokens,
                                 "temperature": temperature}}
    if system:
        body["systemInstruction"] = {"parts": [{"text": "\n".join(system)}]}
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={key}")
    r = requests.post(url, json=body,
                      headers={"Content-Type": "application/json"},
                      timeout=DEFAULT_TIMEOUT)
    r.raise_for_status()
    data = r.json()
    parts = data["candidates"][0]["content"]["parts"]
    text = "".join(p.get("text", "") for p in parts)
    return {"text": text, "usage": data.get("usageMetadata", {})}


def chat(provider: str, model: str, messages: list[dict],
         max_tokens: int = 1024, temperature: float = 0.7) -> dict:
    """Send a chat request. `messages` = [{"role": "user"/"system"/"assistant",
    "content": str}]. Returns {provider, model, text, usage}.
    """
    if get_model(provider, model) is None:
        # Not fatal — allow any model id the provider supports — but warn.
        pass
    if provider in _OPENAI_COMPAT:
        result = _chat_openai_compat(provider, model, messages, max_tokens, temperature)
    elif provider == "anthropic":
        result = _chat_anthropic(model, messages, max_tokens, temperature)
    elif provider == "gemini":
        result = _chat_gemini(model, messages, max_tokens, temperature)
    else:
        raise ProviderError(f"Unsupported provider: {provider}")
    return {"provider": provider, "model": model, **result}
