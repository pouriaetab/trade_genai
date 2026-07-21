"""Model registry — the source of truth for the model picker.

Prices are USD per 1,000,000 tokens (input / output), current as of July 2026.
They change often; treat them as estimates and confirm on each provider's
pricing page. `tier` reflects how you'd realistically call the model:
  - "free"         : usable on the provider's free API tier (rate-limited)
  - "paid"         : requires a funded API key, billed per token
  - "subscription" : uses your Claude.ai Pro/Max plan's included usage via the
                     local Claude Code CLI, not a billed API key (see "claude_code")

IMPORTANT: a Claude.ai (Pro/Max) *subscription* does NOT grant API access to
the Anthropic Claude provider below. That provider's usage is billed
separately via the Claude Developer Platform, so its models are marked "paid"
and need ANTHROPIC_API_KEY. If you only have a Claude.ai subscription (no
funded API key), use the separate "claude_code" provider instead — it talks
to your subscription's included usage through the `claude` CLI.

Note: "Groq" (fast inference for open models, free tier) is a different company
from "Grok" (xAI's model, paid). Both are included.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional

from . import overlay as _overlay

# Rough text<->token conversion. ~1.33 tokens per English word (~0.75 words/token).
TOKENS_PER_WORD = 1.33


@dataclass(frozen=True)
class Model:
    id: str                 # provider's model id (sent to the API)
    label: str              # human name for the dropdown
    tier: str               # "free" | "paid"
    input_price: float      # USD per 1M input tokens (0.0 if free-tier only)
    output_price: float     # USD per 1M output tokens
    context: int            # context window in tokens
    note: str = ""          # one-liner shown under the model


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    env_var: str            # environment variable holding the API key
    has_free_tier: bool
    docs_url: str
    models: list = field(default_factory=list)


# --- The registry ---------------------------------------------------------

PROVIDERS: dict[str, Provider] = {
    "gemini": Provider(
        id="gemini", label="Google Gemini", env_var="GEMINI_API_KEY",
        has_free_tier=True,
        docs_url="https://ai.google.dev/gemini-api/docs",
        models=[
            Model("gemini-flash-latest", "Gemini Flash (latest)", "free", 0.15, 0.60,
                  1_000_000, "Version-stable alias — recommended default, avoids 404s."),
            Model("gemini-2.5-flash", "Gemini 2.5 Flash", "free", 0.15, 0.60,
                  1_000_000, "Free tier ~1,500 req/day. Fast, multimodal."),
            Model("gemini-2.5-pro", "Gemini 2.5 Pro", "free", 2.50, 15.00,
                  1_000_000, "Free tier ~50 req/day; strongest Gemini reasoning."),
            # 1. Your primary 3.5 model (keep this as default)
            Model("gemini-3.5-flash", "Gemini 3.5 Flash", "free", 0.15, 0.60,
                  1_000_000, "Latest 3.5 Flash. Excellent speed and reasoning."),
            # 3. Use 2.0 Flash Lite (Allowed by your key, highly cost/rate efficient)
            Model("gemini-2.0-flash-lite", "Gemini 2.0 Flash-Lite", "free", 0.075, 0.30,
                  1_000_000, "Super fast, lightweight model available on the free tier."),
            # 4. Use 2.0 Flash (Standard speed fallback allowed by your key)
            Model("gemini-2.0-flash", "Gemini 2.0 Flash", "free", 0.15, 0.60,
                  1_000_000, "Standard 2.0 Flash model allowed on your current tier."),
            Model("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite", "free", 0.075, 0.30,
                  1_000_000, "Excellent free fallback — 500 requests per day available."),
            Model("gemini-3-flash", "Gemini 3 Flash", "free", 0.15, 0.60,
                  1_000_000, "Standard preview Flash model with 20 requests per day."),
        ],
    ),
    "groq": Provider(
        id="groq", label="Groq (open models)", env_var="GROQ_API_KEY",
        has_free_tier=True,
        docs_url="https://console.groq.com/docs",
        models=[
            Model("llama-3.3-70b-versatile", "Llama 3.3 70B", "free", 0.0, 0.0,
                  128_000, "Free tier, very fast. Not xAI's Grok."),
            Model("llama-3.1-8b-instant", "Llama 3.1 8B", "free", 0.0, 0.0,
                  128_000, "Free tier; lightest/fastest for quick answers."),
        ],
    ),
    "openrouter": Provider(
        id="openrouter", label="OpenRouter (aggregator)", env_var="OPENROUTER_API_KEY",
        has_free_tier=True,
        docs_url="https://openrouter.ai/docs",
        models=[
            Model("meta-llama/llama-3.3-70b-instruct:free", "Llama 3.3 70B (free)",
                  "free", 0.0, 0.0, 128_000, "One key, many free models. 50 req/day free."),
            Model("deepseek/deepseek-chat", "DeepSeek Chat", "paid", 0.14, 0.28,
                  64_000, "Very cheap paid; strong general model."),
        ],
    ),
    "anthropic": Provider(
        id="anthropic", label="Anthropic Claude", env_var="ANTHROPIC_API_KEY",
        has_free_tier=False,
        docs_url="https://platform.claude.com/docs",
        models=[
            Model("claude-haiku-4-5", "Claude Haiku 4.5", "paid", 1.00, 5.00,
                  200_000, "Fastest/cheapest Claude. Needs API key (not your Pro plan)."),
            Model("claude-sonnet-4-6", "Claude Sonnet 4.6", "paid", 3.00, 15.00,
                  200_000, "Balanced workhorse."),
            Model("claude-opus-4-8", "Claude Opus 4.8", "paid", 5.00, 25.00,
                  200_000, "Deep reasoning; most capable Claude for hard analysis."),
        ],
    ),
    "openai": Provider(
        id="openai", label="OpenAI (ChatGPT)", env_var="OPENAI_API_KEY",
        has_free_tier=False,
        docs_url="https://platform.openai.com/docs",
        models=[
            Model("gpt-5-mini", "GPT-5 Mini", "paid", 0.25, 2.00,
                  400_000, "Cheap, capable default."),
            Model("gpt-5.5", "GPT-5.5", "paid", 5.00, 30.00,
                  400_000, "Flagship; strongest OpenAI reasoning."),
        ],
    ),
    "xai": Provider(
        id="xai", label="xAI Grok", env_var="XAI_API_KEY",
        has_free_tier=False,
        docs_url="https://docs.x.ai",
        models=[
            Model("grok-4.1-fast", "Grok 4.1 Fast", "paid", 0.20, 0.50,
                  256_000, "Cheap and fast."),
            Model("grok-4.3", "Grok 4.3", "paid", 1.25, 2.50,
                  1_000_000, "Flagship; 1M-token context."),
        ],
    ),
    # Different from "anthropic" above: this one uses your Claude.ai (Pro/Max)
    # subscription's included usage via the Claude Code CLI running locally on
    # your machine — a `claude` binary and a token from `claude setup-token`,
    # not a per-token-billed Developer Platform API key. See client.py's
    # _chat_claude_code() for how the request actually gets made (a subprocess,
    # not an HTTP call) and genai_trader/llm/client.py's module docstring area
    # for the caveats (CLI startup overhead, no tool use, one-shot per call).
    "claude_code": Provider(
        id="claude_code", label="Claude (via Claude Code, subscription)",
        env_var="CLAUDE_CODE_OAUTH_TOKEN",
        has_free_tier=False,
        docs_url="https://docs.claude.com/en/docs/claude-code/overview",
        models=[
            Model("sonnet", "Claude Sonnet (latest)", "subscription", 0.0, 0.0,
                  200_000, "Included in your Claude.ai subscription — no per-token API cost. "
                  "Runs via the local `claude` CLI, not the Anthropic API."),
            Model("opus", "Claude Opus (latest)", "subscription", 0.0, 0.0,
                  200_000, "Deepest reasoning; still included in your subscription."),
        ],
    ),
}


# --- Helpers ----------------------------------------------------------------
# Every helper below merges the curated PROVIDERS/Model defaults with the
# user-editable overlay (genai_trader.llm.overlay): removed defaults are
# hidden, custom providers/models are appended, and "discovered" models (from
# a provider's own list-models endpoint, via a Settings "Refresh" action) fill
# in anything new the curated list doesn't have yet. This is what lets a user
# add or remove providers/models from the app, with changes sticking across
# restarts, without touching this file.

def list_providers() -> list[dict]:
    """Providers for the first dropdown (id, label, free-tier flag, source)."""
    ov = _overlay.load()
    removed = set(ov.get("removed_providers", []))
    out = [
        {"id": p.id, "label": p.label, "has_free_tier": p.has_free_tier,
         "docs_url": p.docs_url, "env_var": p.env_var, "source": "default"}
        for p in PROVIDERS.values() if p.id not in removed
    ]
    for pid, cp in ov.get("custom_providers", {}).items():
        out.append({
            "id": pid, "label": cp.get("label", pid), "has_free_tier": bool(cp.get("has_free_tier")),
            "docs_url": cp.get("docs_url", ""), "env_var": None, "source": "custom",
            "compat": cp.get("compat", "openai"), "base_url": cp.get("base_url", ""),
        })
    return out


def models_for(provider_id: str) -> list[dict]:
    """Models for the second dropdown, each with a cost hint and a source tag
    ("default" | "custom" | "discovered")."""
    ov = _overlay.load()
    removed = set(ov.get("removed_models", {}).get(provider_id, []))
    out: list[dict] = []
    p = PROVIDERS.get(provider_id)
    if p:
        for m in p.models:
            if m.id in removed:
                continue
            d = asdict(m)
            d["cost_hint"] = _cost_hint(m)
            d["source"] = "default"
            out.append(d)
    for m in ov.get("custom_models", {}).get(provider_id, []):
        if m["id"] in removed:
            continue
        model = Model(
            id=m["id"], label=m.get("label", m["id"]), tier=m.get("tier", "paid"),
            input_price=float(m.get("input_price", 0.0)), output_price=float(m.get("output_price", 0.0)),
            context=int(m.get("context", 128_000)), note=m.get("note", ""),
        )
        d = asdict(model)
        d["cost_hint"] = _cost_hint(model)
        d["source"] = "custom"
        out.append(d)
    known_ids = {d["id"] for d in out}
    for mid in ov.get("discovered_models", {}).get(provider_id, []):
        if mid in removed or mid in known_ids:
            continue
        out.append({
            "id": mid, "label": mid, "tier": "unknown", "input_price": 0.0, "output_price": 0.0,
            "context": 0, "note": "discovered from the provider's model list — check its pricing page",
            "cost_hint": "check provider pricing", "source": "discovered",
        })
    return out


def get_model(provider_id: str, model_id: str) -> Optional[Model]:
    for d in models_for(provider_id):
        if d["id"] == model_id:
            return Model(id=d["id"], label=d["label"], tier=d["tier"], input_price=d["input_price"],
                        output_price=d["output_price"], context=d["context"], note=d.get("note", ""))
    return None


def words_to_tokens(words: float) -> int:
    return int(round(words * TOKENS_PER_WORD))


def estimate_cost(provider_id: str, model_id: str,
                  words_in: float, words_out: float) -> float:
    """Estimated USD for an exchange, from word counts (used before a real
    token count is known, e.g. for a live "roughly N tokens" hint as you type)."""
    m = get_model(provider_id, model_id)
    if not m:
        return 0.0
    ti = words_to_tokens(words_in)
    to = words_to_tokens(words_out)
    return ti / 1e6 * m.input_price + to / 1e6 * m.output_price


def cost_from_tokens(provider_id: str, model_id: str,
                     input_tokens: int, output_tokens: int) -> float:
    """Actual USD cost from the provider's own reported token counts — more
    accurate than the word-count estimate above, used once a response comes back."""
    m = get_model(provider_id, model_id)
    if not m:
        return 0.0
    return (input_tokens or 0) / 1e6 * m.input_price + (output_tokens or 0) / 1e6 * m.output_price


def _cost_hint(m: Model) -> str:
    """Plain-English cost for a typical ~500-in / ~500-out word exchange."""
    if m.tier == "subscription":
        return "included in your Claude.ai subscription"
    if m.tier == "free" and m.input_price == 0 and m.output_price == 0:
        return "free"
    cost = (words_to_tokens(500) / 1e6 * m.input_price
            + words_to_tokens(500) / 1e6 * m.output_price)
    tier_word = "free tier" if m.tier == "free" else "paid"
    if cost < 0.01:
        return f"{tier_word} · ~<$0.01 / 1k-word chat"
    return f"{tier_word} · ~${cost:.2f} / 1k-word chat"
