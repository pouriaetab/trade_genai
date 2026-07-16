"""genai_trader — learning + strategy toolkit for the book
"Generative AI for Trading and Asset Management".

Public API is intentionally small so lesson code (and the webapp kernel)
can do:  from genai_trader import get_adjusted_close, daily_returns, sharpe_ratio
"""
from .config import get_settings
from .metrics import daily_returns, sharpe_ratio, cumulative_returns
from .data.massive import (
    MassiveClient,
    get_daily_bars,
    get_dividends,
    get_adjusted_close,
    get_last_n_trading_days,
)

__all__ = [
    "get_settings",
    "daily_returns",
    "sharpe_ratio",
    "cumulative_returns",
    "MassiveClient",
    "get_daily_bars",
    "get_dividends",
    "get_adjusted_close",
    "get_last_n_trading_days",
]

__version__ = "0.1.0"
