from __future__ import annotations

import math
import os

import pytest
from pyspark.sql import functions as F

from spark.jobs.analytics.behavior_ml import (
    FEATURE_COLUMNS,
    add_behavior_classification,
    classify_behavior,
    train_investor_segments,
)
from spark.jobs.analytics.market_graph import build_interaction_graph
from spark.jobs.analytics.statistics import reference_statistics
from spark.jobs.batch.market_batch import build_market_analytics
from spark.lib.quality import validate_and_normalize
from spark.tests.batch_fixtures import bronze_frame, market_events, portfolio_events


def test_behavior_classification_handles_null_invalid_and_observed_signals():
    assert classify_behavior(None, 0.2, 0.0, 0.01) == "insufficient_data"
    assert classify_behavior(2, float("nan"), 0.0, 0.01) == "insufficient_data"
    assert classify_behavior(12, 0.2, 0.0, 0.01) == "high_activity"
    assert classify_behavior(2, 0.7, 0.0, 0.01) == "concentrated_activity"


def test_udf_output_is_educational_and_safe_for_nulls(spark):
    frame = spark.createDataFrame(
        [(2, 0.25, -0.01, 0.02), (None, None, None, None)],
        "trade_frequency long, concentration_hhi double, maximum_drawdown double, portfolio_volatility double",
    )
    labels = [row.educational_signal for row in add_behavior_classification(frame).collect()]
    assert labels == ["moderate_observed_activity", "insufficient_data"]


def test_mllib_segments_record_features_scaling_and_silhouette(spark):
    rows = [
        (1.0, 10.0, 0.1, -0.01, 0.01, 5.0, 2.0),
        (2.0, 20.0, 0.2, -0.02, 0.02, 4.0, 3.0),
        (10.0, 500.0, 0.8, -0.3, 0.2, -50.0, 20.0),
        (12.0, 700.0, 0.9, -0.4, 0.3, -80.0, 30.0),
    ]
    features = spark.createDataFrame(rows, list(FEATURE_COLUMNS))

    result = train_investor_segments(features, max_clusters=2, seed=7)

    assert result.assignments.count() == 4
    assert result.assignments.select("cluster").distinct().count() == 2
    assert result.metadata["effective_clusters"] == 2
    assert math.isfinite(result.metadata["silhouette"])
    assert result.metadata["feature_columns"] == list(FEATURE_COLUMNS)


def test_statistics_reference_and_spark_series_match(spark):
    reference = reference_statistics([100.0, 102.0, 101.0])
    silver, rejected = validate_and_normalize(bronze_frame(spark, market_events()))
    assert rejected.count() == 0
    series = build_market_analytics(silver)["market_time_series"].orderBy("event_time")
    values = series.select("simple_return", "drawdown").collect()
    assert values[1].simple_return == pytest.approx(102.0 / 100.0 - 1.0)
    assert values[-1].drawdown == pytest.approx(reference["maximum_drawdown"])
    assert reference["return_variance"] is not None


def test_graph_analysis_requires_graphframes_or_returns_graph_metrics(spark):
    silver, rejected = validate_and_normalize(bronze_frame(spark, portfolio_events()))
    assert rejected.count() == 0
    try:
        import graphframes  # noqa: F401
    except ImportError:
        with pytest.raises(RuntimeError, match="GraphFrames is required"):
            build_interaction_graph(silver)
        return
    if os.environ.get("FINSIGHT_TEST_GRAPHFRAMES") != "1":
        pytest.skip("Set FINSIGHT_TEST_GRAPHFRAMES=1 with the Spark GraphFrames jar to run")
    result = build_interaction_graph(silver, max_iterations=2)
    assert result["metadata"]["vertices"] >= 3
    assert result["metadata"]["edges"] >= 2
    assert {"degree", "pagerank", "community"} <= set(result["vertices"].columns)
