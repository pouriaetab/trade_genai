"""Efficient Frontier — random-portfolio (Monte Carlo) mean-variance simulation.

Pipeline (each step is a standalone function so the UI can run them one at a
time and inspect the intermediate result, or call all of them in sequence):

    fetch_prices          symbols + date range  -> long-form OHLCV (+ adj_close)
    to_wide_adj_close     long-form             -> wide table, date index, one column per symbol
    compute_returns       wide prices           -> daily returns (simple or log)
    annualize             daily returns         -> annual_returns (mean), cov_matrix (annualized)
    risk_free_annual_rate a proxy symbol        -> its own annualized mean return (e.g. BIL)
    simulate_portfolios   annual_returns + cov  -> N random long-only portfolios, best/safest picked out
    simulate_single_asset one asset + risk-free -> allocation sweep between the two

Long-only by construction: each simulated portfolio's weights are drawn
uniformly at random and normalized to sum to 1 (the same "random portfolios"
method used throughout the book), so every weight is between 0% and 100% —
no shorting, matching how most people actually want to read "portfolio
allocation %".
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from ..data.massive import get_adjusted_close

TRADING_DAYS = 252
DEFAULT_N_PORTFOLIOS = 10_000
MAX_CHART_POINTS = 2_000  # cap what's sent back for the scatter plot; best/worst are exact regardless


def fetch_prices(symbols: list[str], start: dt.date, end: dt.date) -> pd.DataFrame:
    """Long-form OHLCV + adj_close for each symbol, stacked and sorted by date.

    Columns: date, symbol, open, high, low, close, volume, vwap, adj_close.
    Symbols with no data in range are silently skipped (e.g. bad ticker).
    """
    frames = []
    for sym in symbols:
        df = get_adjusted_close(sym, start, end)
        if df.empty:
            continue
        df = df.copy()
        df["symbol"] = sym.upper()
        frames.append(df)
    if not frames:
        return pd.DataFrame(
            columns=["date", "symbol", "open", "high", "low", "close",
                     "volume", "vwap", "adj_close"]
        )
    out = pd.concat(frames, ignore_index=True)
    return out.sort_values(["date", "symbol"]).reset_index(drop=True)


def to_wide_adj_close(long_df: pd.DataFrame) -> pd.DataFrame:
    """Pivot long-form prices to date-indexed, one column per symbol (adj_close)."""
    wide = long_df.pivot(index="date", columns="symbol", values="adj_close")
    return wide.sort_index()


def compute_returns(wide: pd.DataFrame, kind: str = "simple") -> pd.DataFrame:
    """Per-symbol returns from a wide adj_close table.

    kind="simple": r_t = P_t/P_{t-1} - 1   kind="log": r_t = ln(P_t/P_{t-1})
    Rows with any missing symbol are dropped so every remaining row is a
    complete, aligned observation (needed for the covariance matrix).
    """
    if kind == "log":
        returns = np.log(wide / wide.shift(1))
    else:
        returns = wide.pct_change()
    return returns.dropna(how="all").dropna(axis=0, how="any")


def annualize(returns_df: pd.DataFrame, periods_per_year: int = TRADING_DAYS):
    """Annualized mean return per symbol and annualized covariance matrix."""
    annual_returns = returns_df.mean() * periods_per_year
    cov_matrix = returns_df.cov() * periods_per_year
    return annual_returns, cov_matrix


def risk_free_annual_rate(symbol: str, start: dt.date, end: dt.date,
                          periods_per_year: int = TRADING_DAYS) -> float:
    """Annualized mean return of a proxy symbol (e.g. BIL, SHY) over the given
    window — used as a real, data-backed risk-free rate instead of a guess."""
    df = get_adjusted_close(symbol, start, end)
    if df.empty or len(df) < 3:
        raise ValueError(f"Not enough data for {symbol.upper()} in this date range.")
    wide = df.set_index("date")[["adj_close"]].rename(columns={"adj_close": symbol.upper()})
    returns = compute_returns(wide)
    if returns.empty:
        raise ValueError(f"Not enough data for {symbol.upper()} in this date range.")
    return float(returns[symbol.upper()].mean() * periods_per_year)


def _sample_for_chart(points: list[dict], rng: np.random.Generator) -> list[dict]:
    if len(points) <= MAX_CHART_POINTS:
        return points
    idx = rng.choice(len(points), size=MAX_CHART_POINTS, replace=False)
    return [points[i] for i in sorted(idx.tolist())]


def simulate_portfolios(
    mu: pd.Series,
    cov: pd.DataFrame,
    risk_free_rate: float = 0.0,
    n_portfolios: int = DEFAULT_N_PORTFOLIOS,
    seed: int | None = None,
) -> dict:
    """Long-only random-portfolio simulation over >=2 risky assets.

    Draws `n_portfolios` random weight vectors (uniform, normalized to sum to
    1), computes each portfolio's annualized return/volatility/Sharpe, and
    reports the best-Sharpe and lowest-volatility portfolios found in the
    sample — same method as the classic "random portfolios" exercise, just
    vectorized. Returns a dict with:
      symbols        — column order used for every weights dict below
      n_simulated    — how many portfolios were actually drawn
      points         — a (possibly down-sampled) set of {return, volatility, sharpe}
                       for the scatter plot; best/min below are exact over the full sample
      min_volatility — lowest-volatility portfolio found
      max_sharpe     — highest-Sharpe portfolio found
    """
    symbols = list(mu.index)
    n = len(symbols)
    if n < 2:
        raise ValueError(
            "Need at least 2 symbols to simulate a diversified portfolio — for a single "
            "symbol, pick a risk-free asset instead and this will blend the two."
        )
    mu_v = mu.reindex(symbols).values.astype(float)
    cov_v = cov.reindex(index=symbols, columns=symbols).values.astype(float)
    n_portfolios = max(int(n_portfolios), 100)

    rng = np.random.default_rng(seed)
    weights = rng.random((n_portfolios, n))
    weights /= weights.sum(axis=1, keepdims=True)

    rets = weights @ mu_v
    # var_i = w_i' Cov w_i for every sampled portfolio, vectorized
    vols = np.sqrt(np.maximum(np.einsum("ij,jk,ik->i", weights, cov_v, weights), 0.0))
    with np.errstate(divide="ignore", invalid="ignore"):
        sharpes = np.where(vols > 0, (rets - risk_free_rate) / vols, np.nan)

    max_idx = int(np.nanargmax(sharpes)) if np.isfinite(sharpes).any() else int(np.argmin(vols))
    min_idx = int(np.argmin(vols))

    points = [{"return": float(rets[i]), "volatility": float(vols[i]),
              "sharpe": (float(sharpes[i]) if np.isfinite(sharpes[i]) else None)}
             for i in range(n_portfolios)]
    points = _sample_for_chart(points, rng)

    return {
        "symbols": symbols,
        "n_simulated": n_portfolios,
        "points": points,
        "min_volatility": {
            "return": float(rets[min_idx]), "volatility": float(vols[min_idx]),
            "sharpe": (float(sharpes[min_idx]) if np.isfinite(sharpes[min_idx]) else None),
            "weights": dict(zip(symbols, weights[min_idx].tolist())),
        },
        "max_sharpe": {
            "return": float(rets[max_idx]), "volatility": float(vols[max_idx]),
            "sharpe": (float(sharpes[max_idx]) if np.isfinite(sharpes[max_idx]) else None),
            "weights": dict(zip(symbols, weights[max_idx].tolist())),
        },
    }


def simulate_single_asset(
    symbol: str,
    mu: float,
    vol: float,
    risk_free_symbol: str,
    risk_free_rate: float,
    n_portfolios: int = DEFAULT_N_PORTFOLIOS,
) -> dict:
    """Allocation sweep between one risky asset and a risk-free asset (the
    Capital Allocation Line): weight `w` in the risky asset, `1-w` in the
    risk-free one, for w in [0, 1].

    With only one risky asset there's no diversification to optimize — every
    point on this line has the *same* Sharpe ratio (a real property of the
    CAL, not a bug), so "best Sharpe" isn't a meaningful pick here. Instead
    this reports the full sweep plus a moderate 50/50 default, and the
    lowest-volatility point (100% risk-free, trivially) for completeness.
    """
    n_portfolios = max(int(n_portfolios), 20)
    weights = np.linspace(0.0, 1.0, n_portfolios)
    rets = weights * mu + (1 - weights) * risk_free_rate
    vols = weights * vol
    with np.errstate(divide="ignore", invalid="ignore"):
        sharpes = np.where(vols > 0, (rets - risk_free_rate) / vols, np.nan)

    points = [{"return": float(rets[i]), "volatility": float(vols[i]),
              "sharpe": (float(sharpes[i]) if np.isfinite(sharpes[i]) else None),
              "weight_risky": float(weights[i])}
             for i in range(n_portfolios)]

    mid = n_portfolios // 2
    min_idx = 0  # w=0 -> all risk-free -> zero volatility, always the minimum

    def _pt(i):
        return {
            "return": float(rets[i]), "volatility": float(vols[i]),
            "sharpe": (float(sharpes[i]) if np.isfinite(sharpes[i]) else None),
            "weights": {symbol.upper(): float(weights[i]), risk_free_symbol.upper(): float(1 - weights[i])},
        }

    return {
        "symbols": [symbol.upper(), risk_free_symbol.upper()],
        "n_simulated": n_portfolios,
        "points": points,
        "min_volatility": _pt(min_idx),
        "max_sharpe": _pt(mid),  # a representative 50/50 point — see docstring
        "note": (
            "Only one risky symbol was given, so this is a two-asset line between it and "
            f"{risk_free_symbol.upper()}, not a Markowitz frontier — every point on this line "
            "shares the same Sharpe ratio by construction, so there's no single 'optimal' "
            "point the way there is with 2+ risky assets. Pick a point based on how much "
            "volatility you're willing to take."
        ),
    }
