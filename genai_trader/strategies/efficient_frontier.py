"""Efficient Frontier — classic Markowitz mean-variance optimization.

Pipeline (each step is a standalone function so the UI can run them one at a
time and inspect the intermediate result, or call all of them in sequence):

    fetch_prices        symbols + date range  -> long-form OHLCV (+ adj_close)
    to_wide_adj_close   long-form             -> wide table, date index, one column per symbol
    compute_returns     wide prices           -> daily returns (simple or log)
    annualize           daily returns         -> annual_returns (mean), cov_matrix (annualized)
    efficient_frontier  annual_returns + cov  -> frontier curve, min-vol & max-Sharpe portfolios

Note on weights: this is the textbook *unconstrained* frontier (no long-only
bound), solved in closed form via matrix algebra — no optimizer dependency
needed. That means weights can come out negative (a short position). That's
expected and is exactly what the book's chapter derives; add a no-short
constraint yourself (e.g. with `scipy.optimize.minimize`) if your strategy
needs one.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from ..data.massive import get_adjusted_close

TRADING_DAYS = 252


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


def efficient_frontier(
    mu: pd.Series,
    cov: pd.DataFrame,
    risk_free_rate: float = 0.0,
    n_points: int = 40,
) -> dict:
    """Closed-form efficient frontier for the given expected returns / covariance.

    Returns a dict with:
      symbols        — column order used for every weights dict below
      points         — [{target_return, volatility, sharpe}, ...] along the frontier
      min_volatility — the global minimum-variance portfolio
      max_sharpe     — the tangency (max Sharpe ratio) portfolio
    """
    symbols = list(mu.index)
    mu_v = mu.reindex(symbols).values.astype(float)
    cov_v = cov.reindex(index=symbols, columns=symbols).values.astype(float)
    n = len(symbols)
    if n < 2:
        raise ValueError("Need at least 2 symbols to build a frontier.")

    try:
        inv_cov = np.linalg.inv(cov_v)
    except np.linalg.LinAlgError:
        inv_cov = np.linalg.pinv(cov_v)

    ones = np.ones(n)
    A = float(ones @ inv_cov @ ones)
    B = float(ones @ inv_cov @ mu_v)
    C = float(mu_v @ inv_cov @ mu_v)
    D = A * C - B * B
    if abs(D) < 1e-10 or abs(A) < 1e-10:
        raise ValueError(
            "Covariance matrix is singular for these symbols/date range — try "
            "a longer window, or fewer / less-correlated symbols."
        )

    def _weights_for_return(r: float) -> np.ndarray:
        lam = (A * r - B) / D
        gam = (C - B * r) / D
        return inv_cov @ (lam * mu_v + gam * ones)

    def _point(w: np.ndarray) -> tuple[float, float]:
        ret = float(mu_v @ w)
        vol = float(np.sqrt(max(w @ cov_v @ w, 0.0)))
        return ret, vol

    w_minvar = inv_cov @ ones / A
    r_minvar, vol_minvar = _point(w_minvar)

    denom = B - A * risk_free_rate
    w_tan = (inv_cov @ (mu_v - risk_free_rate * ones) / denom) if abs(denom) > 1e-10 else w_minvar
    r_tan, vol_tan = _point(w_tan)
    sharpe_tan = (r_tan - risk_free_rate) / vol_tan if vol_tan > 0 else float("nan")

    lo, hi = float(mu_v.min()), float(mu_v.max())
    span = (hi - lo) if hi > lo else (abs(hi) * 0.5 + 0.05)
    lo -= 0.2 * span
    hi += 0.4 * span
    targets = np.linspace(lo, hi, max(int(n_points), 5))

    points = []
    for r in targets:
        w = _weights_for_return(float(r))
        ret, vol = _point(w)
        sharpe = (ret - risk_free_rate) / vol if vol > 0 else float("nan")
        points.append({"target_return": ret, "volatility": vol, "sharpe": sharpe})

    return {
        "symbols": symbols,
        "points": points,
        "min_volatility": {
            "return": r_minvar, "volatility": vol_minvar,
            "weights": dict(zip(symbols, w_minvar.tolist())),
        },
        "max_sharpe": {
            "return": r_tan, "volatility": vol_tan, "sharpe": sharpe_tan,
            "weights": dict(zip(symbols, w_tan.tolist())),
        },
    }
