"""Chapter 1 — first exercise.

Goal: get the last 100 days of SPY daily closing prices, make sure they are
split *and* dividend adjusted, compute daily returns from those adjusted
prices, then show (a) the raw data and (b) a tidy two-column table of
[date, daily_return].

Run standalone:
    python -m genai_trader.lessons.ch01_spy_returns

Or import the pieces in a notebook / the webapp kernel:
    from genai_trader.lessons.ch01_spy_returns import fetch, compute_returns
"""
from __future__ import annotations

import pandas as pd

from ..data.massive import get_last_n_trading_days
from ..metrics import daily_returns, sharpe_ratio

TICKER = "SPY"
N_DAYS = 100


def fetch(ticker: str = TICKER, n: int = N_DAYS) -> pd.DataFrame:
    """Last `n` trading days of `ticker`, split + dividend adjusted.

    Returns the full bar frame including `close` (split-adjusted) and
    `adj_close` (split + dividend adjusted).
    """
    return get_last_n_trading_days(ticker, n)


def compute_returns(bars: pd.DataFrame) -> pd.DataFrame:
    """Two-column [date, daily_return] table from the adjusted close.

    Daily returns need a prior price, so the first of the `n` days has no
    return and is dropped — you get n-1 rows.
    """
    prices = bars.set_index("date")["adj_close"]
    rets = daily_returns(prices)
    return (
        rets.rename("daily_return")
        .reset_index()
        .rename(columns={"index": "date"})
    )


def run(ticker: str = TICKER, n: int = N_DAYS) -> dict:
    """Execute the full exercise and return the artifacts.

    Returns a dict with keys: `raw` (full bars), `returns` (2-col table),
    and `sharpe` (annualized Sharpe of the daily returns, for context).
    """
    bars = fetch(ticker, n)
    returns = compute_returns(bars)
    sr = sharpe_ratio(returns["daily_return"])
    return {"raw": bars, "returns": returns, "sharpe": sr}


if __name__ == "__main__":
    pd.set_option("display.max_rows", 12)
    pd.set_option("display.width", 120)

    result = run()
    raw, returns, sr = result["raw"], result["returns"], result["sharpe"]

    print(f"=== RAW DATA: last {len(raw)} trading days of {TICKER} "
          f"(split + dividend adjusted) ===")
    print(raw.to_string(index=False))
    print()
    print(f"=== DAILY RETURNS from adj_close  ({len(returns)} rows) ===")
    print(returns.to_string(index=False))
    print()
    print(f"Annualized Sharpe (rf=0): {sr:.2f}")
