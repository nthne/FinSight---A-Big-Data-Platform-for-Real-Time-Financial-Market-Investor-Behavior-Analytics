"""Reusable distributed aggregate expressions for Spark batch jobs."""

from __future__ import annotations

from pyspark.sql import Column
from pyspark.sql import functions as F


def weighted_population_volatility(
    weight_sum: str,
    weighted_value_sum: str,
    weighted_squared_value_sum: str,
) -> Column:
    """Compute sqrt(Ew[x²] - Ew[x]²) from grouped weighted sums."""
    weighted_mean = F.col(weighted_value_sum) / F.col(weight_sum)
    weighted_variance = (
        F.col(weighted_squared_value_sum) / F.col(weight_sum)
        - F.pow(weighted_mean, 2)
    )
    return F.when(
        F.col(weight_sum) > 0,
        F.sqrt(F.greatest(weighted_variance, F.lit(0.0))),
    )
