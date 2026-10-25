"""Portfolio risk and investor-behavior feature transformations."""

from __future__ import annotations

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F

from spark.jobs.analytics.behavior_ml import add_behavior_classification


def build_portfolio_analytics(silver: DataFrame) -> dict[str, DataFrame]:
    """Build snapshot risk, daily behavior, and user-level model features."""
    snapshots = silver.filter(F.col("event_type") == "portfolio_snapshot")
    by_user_time = Window.partitionBy("user_id").orderBy("event_time", "event_id")
    all_history = by_user_time.rowsBetween(Window.unboundedPreceding, Window.currentRow)
    trailing = by_user_time.rowsBetween(-19, Window.currentRow)
    portfolio_risk = (
        snapshots.withColumn("previous_value", F.lag("total_value").over(by_user_time))
        .withColumn(
            "return",
            F.when(
                F.col("previous_value") > 0,
                F.col("total_value") / F.col("previous_value") - F.lit(1.0),
            ),
        )
        .withColumn("running_peak", F.max("total_value").over(all_history))
        .withColumn(
            "drawdown",
            F.when(
                F.col("running_peak") > 0,
                F.col("total_value") / F.col("running_peak") - F.lit(1.0),
            ).otherwise(F.lit(0.0)),
        )
        .withColumn("rolling_volatility", F.stddev_samp("return").over(trailing))
        .drop("previous_value")
    )

    trades = (
        silver.filter(F.col("event_type") == "trade_executed")
        .filter(F.coalesce(F.col("trade_status"), F.lit("executed")) == "executed")
        .withColumn("notional", F.abs(F.col("quantity") * F.col("trade_price")))
    )
    asset_notional = trades.groupBy("user_id", "asset_symbol").agg(
        F.sum("notional").alias("asset_notional")
    )
    user_notional = Window.partitionBy("user_id")
    concentration = (
        asset_notional.withColumn(
            "_user_notional", F.sum("asset_notional").over(user_notional)
        )
        .withColumn(
            "_share",
            F.when(F.col("_user_notional") > 0, F.col("asset_notional") / F.col("_user_notional")),
        )
        .groupBy("user_id")
        .agg(F.sum(F.pow(F.coalesce(F.col("_share"), F.lit(0.0)), 2)).alias("concentration_hhi"))
    )
    trade_features = trades.groupBy("user_id").agg(
        F.count(F.lit(1)).alias("trade_frequency"),
        F.sum("notional").alias("turnover"),
        F.sum(F.when(F.col("trade_side") == "buy", 1).otherwise(0)).alias("buy_count"),
        F.sum(F.when(F.col("trade_side") == "sell", 1).otherwise(0)).alias("sell_count"),
        F.max("event_date").alias("trade_event_date"),
        F.avg("fee").alias("average_fee"),
    ).join(concentration, "user_id", "left")

    portfolio_features = portfolio_risk.groupBy("user_id").agg(
        F.max("event_date").alias("portfolio_event_date"),
        F.avg("total_value").alias("average_portfolio_value"),
        F.avg("pnl").alias("average_pnl"),
        F.min("drawdown").alias("maximum_drawdown"),
        F.stddev_samp("return").alias("portfolio_volatility"),
        F.max("risk_score").alias("reported_risk_score"),
    )
    actions = silver.filter(F.col("event_type") == "user_action")
    action_features = actions.groupBy("user_id").agg(
        F.count(F.lit(1)).alias("action_count"),
        F.countDistinct("action_type").alias("distinct_action_types"),
        F.max("event_date").alias("action_event_date"),
    )
    features = (
        trade_features.join(portfolio_features, "user_id", "full")
        .join(action_features, "user_id", "full")
        .withColumn(
            "event_date",
            F.greatest("trade_event_date", "portfolio_event_date", "action_event_date"),
        )
        .drop("trade_event_date", "portfolio_event_date", "action_event_date")
    )
    numeric_features = [
        "trade_frequency",
        "turnover",
        "buy_count",
        "sell_count",
        "average_fee",
        "concentration_hhi",
        "average_portfolio_value",
        "average_pnl",
        "maximum_drawdown",
        "portfolio_volatility",
        "reported_risk_score",
        "action_count",
        "distinct_action_types",
    ]
    features = add_behavior_classification(features)
    features = features.fillna(0.0, subset=numeric_features)

    behavior_daily = silver.filter(F.col("user_id").isNotNull()).groupBy(
        "event_date", "user_id", "event_type"
    ).agg(
        F.count(F.lit(1)).alias("event_count"),
        F.sum(F.when(F.col("event_type") == "trade_executed", F.abs(F.col("trade_total")))).alias(
            "absolute_trade_cash_flow"
        ),
    )
    return {
        "portfolio_risk": portfolio_risk,
        "portfolio_behavior_features": features,
        "behavior_activity_daily": behavior_daily,
    }
