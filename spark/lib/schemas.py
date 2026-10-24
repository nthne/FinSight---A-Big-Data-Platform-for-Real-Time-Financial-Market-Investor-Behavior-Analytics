"""Spark schemas shared by the FinSight batch jobs."""

from __future__ import annotations

from pyspark.sql.types import (
    DoubleType,
    StringType,
    StructField,
    StructType,
)


PAYLOAD_SCHEMA = StructType(
    [
        StructField("quote_id", StringType()),
        StructField("close_price", DoubleType()),
        StructField("open_price", DoubleType()),
        StructField("high_price", DoubleType()),
        StructField("low_price", DoubleType()),
        StructField("volume", DoubleType()),
        StructField("currency", StringType()),
        StructField("provider_symbol", StringType()),
        StructField("order_id", StringType()),
        StructField("order_kind", StringType()),
        StructField("side", StringType()),
        StructField("quantity", DoubleType()),
        StructField("price", DoubleType()),
        StructField("fee", DoubleType()),
        StructField("total", DoubleType()),
        StructField("status", StringType()),
        StructField("action_id", StringType()),
        StructField("action_type", StringType()),
        StructField("snapshot_id", StringType()),
        StructField("total_value", DoubleType()),
        StructField("cash_balance", DoubleType()),
        StructField("invested_value", DoubleType()),
        StructField("pnl", DoubleType()),
        StructField("risk_score", DoubleType()),
        StructField("diversification_score", DoubleType()),
    ]
)


EVENT_TYPES = ("market_quote", "trade_executed", "user_action", "portfolio_snapshot")
