"""Multi-provider LLM layer: model registry + a provider-agnostic chat client.

The registry describes every model the app can offer (provider, tier, pricing,
context window) so the UI can render two dependent dropdowns — provider first,
then its models — with free/paid badges and a plain-English cost estimate.

The client sends a chat request to whichever provider you pick, reading that
provider's API key from the environment. No keys are stored in code.
"""
from .registry import (
    PROVIDERS,
    list_providers,
    models_for,
    get_model,
    estimate_cost,
    cost_from_tokens,
    words_to_tokens,
)
from .client import chat, provider_ready, ProviderError, list_available_models
from . import overlay

__all__ = [
    "PROVIDERS",
    "list_providers",
    "models_for",
    "get_model",
    "estimate_cost",
    "cost_from_tokens",
    "words_to_tokens",
    "chat",
    "provider_ready",
    "ProviderError",
    "list_available_models",
    "overlay",
]
