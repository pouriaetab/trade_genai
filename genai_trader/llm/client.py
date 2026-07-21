"""Provider-agnostic chat client.

`chat(provider, model, messages)` sends an OpenAI-style message list to any
supported provider and returns a normalized dict. For curated providers the
API key is read from the provider's env var (loaded from .env.local) at call
time — never hard-coded. For a custom provider added via the app's Settings
tab, the key is read from the git-ignored `data/secrets.json` store instead.

Built-in wire formats: gemini, anthropic, and "OpenAI-compatible" (used by
groq, xai, openrouter, openai, and any custom provider added with
compat="openai" — that's most providers, since the OpenAI chat/completions
schema is a de facto standard).

On an HTTP error we raise ProviderError with the provider's own message (not a
bare status code), and for Gemini we append the models your key can actually
use so a wrong model name is self-correcting.

`list_available_models(provider_id)` calls a provider's own list-models
endpoint (best-effort) — this is what backs the "Refresh" action in Settings,
letting the model picker pick up new releases (or drop retired ones) without a
code change.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess

import requests

from ..config import _load_dotenv
from . import overlay
from .registry import PROVIDERS, get_model

DEFAULT_TIMEOUT = 120  # long code-generation replies can take a while to finish streaming
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"


class ProviderError(RuntimeError):
    """Raised when a provider isn't configured or the request fails."""


def _post(label: str, url: str, **kwargs) -> requests.Response:
    """requests.post with provider-agnostic, actionable error messages for the
    two most common failure modes (slow reply, no network) instead of a raw
    stack trace bubbling up to the UI."""
    kwargs.setdefault("timeout", DEFAULT_TIMEOUT)
    try:
        return requests.post(url, **kwargs)
    except requests.exceptions.Timeout:
        timeout = kwargs["timeout"]
        raise ProviderError(
            f"{label} didn't reply within {timeout}s. This usually means the prompt/response "
            f"is unusually long or the provider is slow right now — try again, shorten the "
            f"prompt, or switch to a faster model (e.g. a Flash/Haiku/Mini variant)."
        )
    except requests.exceptions.ConnectionError:
        raise ProviderError(f"Couldn't reach {label} — check your internet connection and try again.")


def _api_key(provider_id: str) -> str:
    """Env var takes priority (the technical path); a key entered in the app's
    Settings tab (stored in overlay/data/secrets.json) is the fallback — so
    either route works, for built-in or custom providers alike."""
    _load_dotenv()
    p = PROVIDERS.get(provider_id)
    if p:
        key = os.environ.get(p.env_var, "").strip() or overlay.get_llm_secret(provider_id)
        if not key:
            raise ProviderError(
                f"No API key for {p.label}. Add {p.env_var} to .env.local, or add a key "
                f"in Settings. See {p.docs_url}."
            )
        return key
    cp = overlay.get_custom_provider(provider_id)
    if not cp:
        raise ProviderError(f"Unknown provider: {provider_id}")
    key = overlay.get_llm_secret(provider_id)
    if not key:
        raise ProviderError(f"No API key for {cp.get('label', provider_id)}. Add one in Settings.")
    return key


def _claude_code_available() -> bool:
    return shutil.which("claude") is not None


def provider_ready(provider_id: str) -> bool:
    _load_dotenv()
    p = PROVIDERS.get(provider_id)
    if p:
        has_key = bool(os.environ.get(p.env_var, "").strip() or overlay.get_llm_secret(provider_id))
        if provider_id == "claude_code":
            # Also needs the `claude` CLI itself on PATH — a token alone isn't
            # enough, unlike every other provider here (which are plain HTTP).
            return has_key and _claude_code_available()
        return has_key
    return bool(overlay.get_llm_secret(provider_id))


def _normalize_usage(provider: str, usage: dict) -> dict:
    """Provider token-usage shapes differ; normalize to {input_tokens, output_tokens}
    so the UI can show real token counts (not just a word-count estimate)."""
    if not usage:
        return {"input_tokens": None, "output_tokens": None}
    if provider in ("anthropic", "claude_code"):
        return {"input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens")}
    if provider == "gemini":
        return {"input_tokens": usage.get("promptTokenCount"), "output_tokens": usage.get("candidatesTokenCount")}
    # OpenAI-compatible (openai, groq, xai, openrouter, custom providers)
    return {"input_tokens": usage.get("prompt_tokens"), "output_tokens": usage.get("completion_tokens")}


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

_OPENAI_COMPAT_URLS = {
    "openai": "https://api.openai.com/v1/chat/completions",
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "xai": "https://api.x.ai/v1/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
}
_OPENAI_COMPAT_MODELS_URLS = {
    "openai": "https://api.openai.com/v1/models",
    "groq": "https://api.groq.com/openai/v1/models",
    "xai": "https://api.x.ai/v1/models",
    "openrouter": "https://openrouter.ai/api/v1/models",
}


def _chat_openai_compat_url(url: str, label: str, key: str, model: str,
                            messages: list[dict], max_tokens: int, temperature: float) -> dict:
    body = {"model": model, "messages": messages,
            "max_tokens": max_tokens, "temperature": temperature}
    r = _post(label, url, json=body,
              headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
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
    r = _post("Claude", "https://api.anthropic.com/v1/messages", json=body,
              headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                       "Content-Type": "application/json"})
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
    r = _post("Gemini", url, json=body, headers={"Content-Type": "application/json"})
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


# --- Claude via the local Claude Code CLI (Claude.ai subscription) --------
#
# Unlike every other provider above, this isn't an HTTP call: it shells out to
# the `claude` binary in non-interactive mode, authenticated with
# CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) instead of a Developer
# Platform API key. Verified against the real CLI's `-p --output-format json`
# schema: {"is_error": bool, "result": "<reply text>", "usage": {...},
# "total_cost_usd": <equivalent API cost, not what you're actually billed
# under a subscription>, "session_id": "..."}.
#
# Tradeoffs vs. every other provider here, worth knowing:
#  - Each call starts the CLI fresh (a few seconds of overhead beyond
#    whatever Claude itself takes) — there's no persistent connection to reuse.
#  - Tools are explicitly disabled (--tools "") so this only ever answers in
#    text/code, the same contract as every other provider — it never touches
#    files or runs shell commands in your project on its own.
#  - Treated as one-shot per call: the full conversation so far is flattened
#    into a single prompt string rather than using the CLI's own
#    --resume/session mechanism, matching how every other provider here is
#    called (this app already reconstructs full context per turn).

def _claude_code_env() -> dict:
    return {**os.environ, "CLAUDE_CODE_OAUTH_TOKEN": _api_key("claude_code")}


def _flatten_for_cli(messages: list[dict]) -> tuple[str, str]:
    system = "\n".join(m["content"] for m in messages if m["role"] == "system").strip()
    convo = [m for m in messages if m["role"] != "system"]
    lines = [
        ("User" if m["role"] == "user" else "Assistant") + ": " + m["content"]
        for m in convo[:-1]
    ]
    transcript = "\n\n".join(lines)
    last = convo[-1]["content"] if convo else ""
    prompt = (transcript + "\n\n" if transcript else "") + last
    return system, prompt


def _chat_claude_code(model: str, messages: list[dict], max_tokens: int, temperature: float) -> dict:
    if not _claude_code_available():
        raise ProviderError(
            "The `claude` CLI isn't installed or isn't on PATH. Install it with "
            "`npm install -g @anthropic-ai/claude-code`, confirm it works with `claude --version`, "
            "then try again."
        )
    env = _claude_code_env()  # raises ProviderError if CLAUDE_CODE_OAUTH_TOKEN is missing
    system, prompt = _flatten_for_cli(messages)
    if not system:
        system = "You are a helpful quant research assistant. Answer directly; do not use tools."
    cmd = [
        "claude", "-p", prompt,
        "--output-format", "json",
        "--model", model,
        "--tools", "",  # text/code answers only — never touches files or runs shell commands
        "--system-prompt", system,
        "--no-session-persistence",
    ]
    try:
        result = subprocess.run(
            cmd, input="", capture_output=True, text=True, timeout=DEFAULT_TIMEOUT, env=env,
        )
    except subprocess.TimeoutExpired:
        raise ProviderError(
            f"Claude Code didn't reply within {DEFAULT_TIMEOUT}s — try again or shorten the prompt."
        )
    except FileNotFoundError:
        raise ProviderError("The `claude` CLI isn't installed or isn't on PATH.")

    try:
        data = json.loads(result.stdout)
    except Exception:
        detail = (result.stdout or result.stderr or "").strip()[:400]
        raise ProviderError(f"Claude Code CLI returned unexpected output: {detail or '(empty)'}")

    if data.get("is_error"):
        raise ProviderError(f"Claude Code error: {data.get('result') or 'unknown error'}")

    usage = data.get("usage") or {}
    return {
        "text": data.get("result", ""),
        "usage": {"input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens")},
    }


def chat(provider: str, model: str, messages: list[dict],
         max_tokens: int = 4096, temperature: float = 0.7) -> dict:
    """Send a chat request. `messages` = [{"role","content"}]. Returns
    {provider, model, text, usage}."""
    label = PROVIDERS[provider].label if provider in PROVIDERS else provider
    if provider in _OPENAI_COMPAT_URLS:
        result = _chat_openai_compat_url(
            _OPENAI_COMPAT_URLS[provider], label, _api_key(provider), model, messages, max_tokens, temperature
        )
    elif provider == "anthropic":
        result = _chat_anthropic(model, messages, max_tokens, temperature)
    elif provider == "claude_code":
        result = _chat_claude_code(model, messages, max_tokens, temperature)
    elif provider == "gemini":
        result = _chat_gemini(model, messages, max_tokens, temperature)
    else:
        cp = overlay.get_custom_provider(provider)
        if cp and cp.get("compat", "openai") == "openai" and cp.get("base_url"):
            url = cp["base_url"].rstrip("/") + "/chat/completions"
            result = _chat_openai_compat_url(
                url, cp.get("label", provider), _api_key(provider), model, messages, max_tokens, temperature
            )
        else:
            raise ProviderError(f"Unsupported provider: {provider}")
    result["usage"] = _normalize_usage(provider, result.get("usage") or {})
    return {"provider": provider, "model": model, **result}


# --- model discovery (backs the Settings "Refresh" action) ----------------

def list_available_models(provider_id: str) -> list[str]:
    """Best-effort: ask the provider for the models its key can use right now.

    Returns an empty list if the provider has no key, has no list-models
    endpoint we know how to call, or the request fails — callers should treat
    that as "nothing new to report", not an error.
    """
    _load_dotenv()
    try:
        if provider_id == "gemini":
            key = os.environ.get(PROVIDERS["gemini"].env_var, "").strip()
            return _gemini_models(key) if key else []
        if provider_id == "anthropic":
            key = os.environ.get(PROVIDERS["anthropic"].env_var, "").strip()
            if not key:
                return []
            r = requests.get(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=20,
            )
            if r.status_code >= 400:
                return []
            return [m.get("id") for m in r.json().get("data", []) if m.get("id")]
        url = _OPENAI_COMPAT_MODELS_URLS.get(provider_id)
        if not url:
            cp = overlay.get_custom_provider(provider_id)
            if cp and cp.get("base_url"):
                url = cp["base_url"].rstrip("/") + "/models"
        if not url:
            return []
        key = _api_key(provider_id)
        r = requests.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=20)
        if r.status_code >= 400:
            return []
        return [m.get("id") for m in r.json().get("data", []) if m.get("id")]
    except Exception:
        return []
