"""Explicit Spark join strategies used by the Person B plan experiments."""

from __future__ import annotations

from pyspark.sql import DataFrame
from pyspark.sql import functions as F


def broadcast_asset_join(quotes: DataFrame, assets: DataFrame) -> DataFrame:
    """Join quote rows to a small asset dimension using a broadcast hash join."""
    left = quotes.alias("q")
    right = F.broadcast(assets.select("asset_symbol", "asset_type").alias("a"))
    return left.join(right, "asset_symbol", "left")


def sort_merge_quote_trade_join(quotes: DataFrame, trades: DataFrame) -> DataFrame:
    """Force Spark's merge strategy for the large symbol/date fact join."""
    quote = quotes.hint("merge").alias("q")
    trade = trades.hint("merge").alias("t")
    return quote.join(
        trade,
        (F.col("q.asset_symbol") == F.col("t.asset_symbol"))
        & (F.col("q.event_date") == F.col("t.event_date")),
        "inner",
    )


def multi_join_pipeline(
    quotes: DataFrame,
    trades: DataFrame,
    assets: DataFrame,
    behavior: DataFrame,
    *,
    optimized: bool,
) -> DataFrame:
    """Join market, trade, asset and user-behavior facts with clear projections."""
    quote = quotes
    trade = trades
    if optimized:
        quote = quote.filter(F.col("event_date").isNotNull()).select(
            "asset_symbol", "event_date", "close_price"
        )
        trade = trade.filter(F.col("event_date").isNotNull()).select(
            "asset_symbol", "event_date", "user_id", "trade_total"
        )
        quote = quote.hint("merge")
        trade = trade.hint("merge")
    quote = quote.alias("q")
    trade = trade.alias("t")
    joined = quote.join(
        trade,
        (F.col("q.asset_symbol") == F.col("t.asset_symbol"))
        & (F.col("q.event_date") == F.col("t.event_date")),
        "inner",
    ).select(
        F.col("q.asset_symbol").alias("asset_symbol"),
        F.col("q.event_date").alias("event_date"),
        F.col("q.close_price").alias("close_price"),
        F.col("t.user_id").alias("user_id"),
        F.col("t.trade_total").alias("trade_total"),
    )
    if optimized:
        joined = joined.repartition("asset_symbol", "event_date")
    asset_dimension = assets.select("asset_symbol", "asset_type")
    if optimized:
        asset_dimension = F.broadcast(asset_dimension)
    joined = joined.join(asset_dimension, "asset_symbol", "left")
    return joined.join(
        behavior_frame.select("user_id", "trade_frequency", "concentration_hhi"),
        "user_id",
        "left",
    )
