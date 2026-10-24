"""Small deterministic reference calculations for Spark time-series tests."""

from __future__ import annotations

from math import sqrt
from statistics import mean, pvariance, stdev
from typing import Sequence


def reference_statistics(prices: Sequence[float]) -> dict[str, float | None]:
    """Return simple returns, sample variance, last z-score and max drawdown."""
    if any(not isinstance(value, (int, float)) or value <= 0 for value in prices):
        raise ValueError("prices must contain only positive numbers")
    if not prices:
        return {
            "last_return": None,
            "return_variance": None,
            "last_z_score": None,
            "maximum_drawdown": None,
        }
    returns = [current / previous - 1.0 for previous, current in zip(prices, prices[1:])]
    price_mean = mean(prices)
    price_sd = sqrt(pvariance(prices)) if len(prices) > 1 else 0.0
    peak = prices[0]
    drawdowns = []
    for price in prices:
        peak = max(peak, price)
        drawdowns.append(price / peak - 1.0)
    return {
        "last_return": returns[-1] if returns else None,
        "return_variance": stdev(returns) ** 2 if len(returns) > 1 else None,
        "last_z_score": (prices[-1] - price_mean) / price_sd if price_sd else 0.0,
        "maximum_drawdown": min(drawdowns),
    }
