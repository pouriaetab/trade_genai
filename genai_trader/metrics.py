"""Core return/performance metrics used throughout the lessons.

Kept deliberately small and readable — these are the building blocks the book
introduces (daily returns, Sharpe ratio, cumulative returns).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def daily_returns(prices: pd.Series) -> pd.Series:
    """Simple daily returns from a price series: r_t = P_t / P_{t-1} - 1.

    The first row is NaN (no prior price) and is dropped.
    """
    prices = pd.Series(prices).astype(float)
    return prices.pct_change().dropna()


def log_returns(prices: pd.Series) -> pd.Series:
    """Continuously-compounded (log) returns: r_t = ln(P_t / P_{t-1})."""
    prices = pd.Series(prices).astype(float)
    return np.log(prices / prices.shift(1)).dropna()


def cumulative_returns(returns: pd.Series) -> pd.Series:
    """Growth of $1 given a series of simple returns."""
    return (1.0 + pd.Series(returns).astype(float)).cumprod()


def sharpe_ratio(
    returns: pd.Series,
    risk_free_rate: float = 0.0,
    periods_per_year: int = TRADING_DAYS,
) -> float:
    """Annualized Sharpe ratio.

    The Sharpe ratio measures risk-adjusted return: how much *excess* return
    (over a risk-free rate) you earn per unit of volatility. Higher is better;
    it lets you compare strategies with different risk levels on equal footing.

        Sharpe = mean(excess_returns) / std(excess_returns) * sqrt(periods)

    `returns` are per-period (e.g. daily) simple returns. `risk_free_rate` is
    the annual risk-free rate; it is de-annualized to match the return period.
    """
    r = pd.Series(returns).astype(float).dropna()
    if r.empty or r.std(ddof=1) == 0:
        return float("nan")
    rf_per_period = risk_free_rate / periods_per_year
    excess = r - rf_per_period
    return float(excess.mean() / excess.std(ddof=1) * np.sqrt(periods_per_year))
