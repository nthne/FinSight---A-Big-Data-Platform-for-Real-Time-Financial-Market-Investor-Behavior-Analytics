from __future__ import annotations

from spark.jobs.batch.join_benchmarks import (
    broadcast_asset_join,
    multi_join_pipeline,
    sort_merge_quote_trade_join,
)
from spark.jobs.batch.optimization_report import benchmark_cached_frame, compare_join_variants


def test_broadcast_join_has_broadcast_hash_operator(spark):
    quotes = spark.createDataFrame(
        [("AAPL", "2026-10-05", 101.0)], "asset_symbol string, event_date string, close_price double"
    )
    assets = spark.createDataFrame([("AAPL", "equity")], "asset_symbol string, asset_type string")

    result = broadcast_asset_join(quotes, assets)
    assert result.count() == 1
    assert "BroadcastHashJoin" in result._jdf.queryExecution().executedPlan().toString()


def test_large_fact_join_uses_sort_merge(spark):
    quotes = spark.createDataFrame(
        [("AAPL", "2026-10-05", 101.0)], "asset_symbol string, event_date string, close_price double"
    )
    trades = spark.createDataFrame(
        [("AAPL", "2026-10-05", "usr_a", -101.0)],
        "asset_symbol string, event_date string, user_id string, trade_total double",
    )

    result = sort_merge_quote_trade_join(quotes, trades)
    assert result.count() == 1
    assert "SortMergeJoin" in result._jdf.queryExecution().executedPlan().toString()


def test_multi_join_and_benchmark_capture_plan_and_runtime(spark):
    quotes = spark.createDataFrame(
        [("AAPL", "2026-10-05", 101.0)], "asset_symbol string, event_date string, close_price double"
    )
    trades = spark.createDataFrame(
        [("AAPL", "2026-10-05", "usr_a", -101.0)],
        "asset_symbol string, event_date string, user_id string, trade_total double",
    )
    assets = spark.createDataFrame([("AAPL", "equity")], "asset_symbol string, asset_type string")
    behavior = spark.createDataFrame(
        [("usr_a", 1, 0.5)], "user_id string, trade_frequency long, concentration_hhi double"
    )

    baseline = multi_join_pipeline(quotes, trades, assets, behavior, optimized=False)
    optimized = multi_join_pipeline(quotes, trades, assets, behavior, optimized=True)
    baseline_metrics, optimized_metrics = compare_join_variants(baseline, optimized)
    assert baseline_metrics["row_count"] == optimized_metrics["row_count"] == 1
    assert baseline_metrics["runtime_seconds"] >= 0
    assert optimized_metrics["physical_plan"]
    assert optimized_metrics["formatted_plan"]
    cache_metrics = benchmark_cached_frame("baseline", baseline)
    assert cache_metrics["cache_fill"]["row_count"] == 1
    assert cache_metrics["cached_reuse"]["row_count"] == 1
