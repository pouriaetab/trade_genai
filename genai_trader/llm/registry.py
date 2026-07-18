"""Model registry — the source of truth for the model picker.

Prices are USD per 1,000,000 tokens (input / output), current as of July 2026.
They change often; treat them as estimates and confirm on each provider's
pricing page. `tier` reflects how you'd realistically call the model:
  - "free"  : usable on the provider's free API tier (rate-limited)
  - "paid"  : requires a funded API key, billed per token

IMPORTANT: a Claude.ai (Pro/Max) *subscription* does NOT grant API access.
API usage is billed separately via the Claude Developer Platform, so Anthropic
models are marked "paid" and need ANTHROPIC_API_KEY.

Note: "Groq" (fast inference for open models, free tier) is a different company
from "Grok" (xAI's model, paid). Both are included.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional

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
}


# --- Helpers --------------------------------------------------------------

def list_providers() -> list[dict]:
    """Providers for the first dropdown (id, label, free-tier flag)."""
    return [
        {"id": p.id, "label": p.label, "has_free_tier": p.has_free_tier,
         "docs_url": p.docs_url, "env_var": p.env_var}
        for p in PROVIDERS.values()
    ]


def models_for(provider_id: str) -> list[dict]:
    """Models for the second dropdown, each with a cost hint for ~1k words."""
    p = PROVIDERS.get(provider_id)
    if not p:
        return []
    out = []
    for m in p.models:
        d = asdict(m)
        d["cost_hint"] = _cost_hint(m)
        out.append(d)
    return out


def get_model(provider_id: str, model_id: str) -> Optional[Model]:
    p = PROVIDERS.get(provider_id)
    if not p:
        return None
    return next((m for m in p.models if m.id == model_id), None)


def words_to_tokens(words: float) -> int:
    return int(round(words * TOKENS_PER_WORD))


def estimate_cost(provider_id: str, model_id: str,
                  words_in: float, words_out: float) -> float:
    """Estimated USD for an exchange of the given word counts."""
    m = get_model(provider_id, model_id)
    if not m:
        return 0.0
    ti = words_to_tokens(words_in)
    to = words_to_tokens(words_out)
    return ti / 1e6 * m.input_price + to / 1e6 * m.output_price


def _cost_hint(m: Model) -> str:
    """Plain-English cost for a typical ~500-in / ~500-out word exchange."""
    if m.tier == "free" and m.input_price == 0 and m.output_price == 0:
        return "free"
    cost = (words_to_tokens(500) / 1e6 * m.input_price
            + words_to_tokens(500) / 1e6 * m.output_price)
    tier_word = "free tier" if m.tier == "free" else "paid"
    if cost < 0.01:
        return f"{tier_word} · ~<$0.01 / 1k-word chat"
    return f"{tier_word} · ~${cost:.2f} / 1k-word chat"
