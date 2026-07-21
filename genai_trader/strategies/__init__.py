"""Trading strategy building blocks for the R&D tab.

Each module here implements one strategy end-to-end as small, composable
functions (fetch -> transform -> stats -> result) so the web app can expose
every step individually (for the "do it step by step and inspect each
intermediate result" workflow) as well as a single one-shot call.
"""
from __future__ import annotations

from .efficient_frontier import (
    annualize,
    compute_returns,
    fetch_prices,
    risk_free_annual_rate,
    simulate_portfolios,
    simulate_single_asset,
    to_wide_adj_close,
)

__all__ = [
    "fetch_prices",
    "to_wide_adj_close",
    "compute_returns",
    "annualize",
    "risk_free_annual_rate",
    "simulate_portfolios",
    "simulate_single_asset",
]
