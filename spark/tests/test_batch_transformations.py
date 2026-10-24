from __future__ import annotations

import math

import pytest
from pyspark.sql import functions as F

from spark.jobs.batch.market_batch import build_market_analytics, run_batch
from spark.jobs.batch.portfolio_batch import build_portfolio_analytics
from spark.lib.quality import validate_and_normalize
from spark.tests.batch_fixtures import bronze_frame, market_events, portfolio_events
from spark.tests.events import at, quote


def test_quality_normalizes_and_rejects_duplicate_and_invalid_events(spark):
    valid = quote("quality-one", " aapl ", at(0), 100.0)
    duplicate = dict(valid)
    duplicate["ingestion_time"] = "2026-10-05T10:00:02Z"
    invalid = quote("quality-invalid", "AAPL", at(0, 5), 0.0)

    silver, rejected = validate_and_normalize(bronze_frame(spark, [valid, duplicate, invalid]))

    assert [(row.event_id, row.asset_symbol) for row in silver.select("event_id", "asset_symbol").collect()] == [
        (valid["event_id"], "AAPL")
    ]
    assert {row.quality_error for row in rejected.select("quality_error").collect()} == {
        "DUPLICATE_EVENT_ID",
        "INVALID_PAYLOAD",
    }

    unknown = quote("quality-unknown", "ZZZ", at(0, 10), 50.0)
    _, unknown_rejected = validate_and_normalize(
        bronze_frame(spark, [unknown]), known_symbols=["AAPL", "MSFT"]
    )
    assert unknown_rejected.first().quality_error == "UNKNOWN_SYMBOL"


def test_market_time_series_and_daily_reference_values(spark):
    silver, rejected = validate_and_normalize(bronze_frame(spark, market_events()))
    assert rejected.count() == 0

    outputs = build_market_analytics(silver, source_pivot_values=["test-fixture"])
    latest = (
        outputs["market_time_series"]
        .orderBy(F.col("event_time").desc())
        .first()
    )
    assert latest.simple_return == 101.0 / 102.0 - 1.0
    assert latest.drawdown == 101.0 / 102.0 - 1.0
    assert latest.rolling_volatility is not None
    assert latest.rolling_return_volume_correlation is not None

    daily = outputs["market_daily"].first()
    assert daily.quote_count == 3
    assert daily.open_price == 100.0
    assert daily.close_price == 101.0
    assert daily.return_variance is not None
    returns = [102.0 / 100.0 - 1.0, 101.0 / 102.0 - 1.0]
    weights = [130.0, 180.0]
    weighted_mean = sum(value * weight for value, weight in zip(returns, weights)) / sum(weights)
    expected_volatility = math.sqrt(
        sum(weight * (value - weighted_mean) ** 2 for value, weight in zip(returns, weights))
        / sum(weights)
    )
    assert daily.weighted_volatility == pytest.approx(expected_volatility)
    assert outputs["market_rollup"].filter(F.col("grouping_level") == 0).count() == 1
    assert outputs["market_cube"].count() >= outputs["market_rollup"].count()
    assert outputs["market_metrics_long"].count() == 6
    assert outputs["market_source_pivot"].first()["test-fixture"] == 101.0


def test_portfolio_risk_and_behavior_concentration(spark):
    silver, rejected = validate_and_normalize(bronze_frame(spark, portfolio_events()))
    assert rejected.count() == 0

    outputs = build_portfolio_analytics(silver)
    risk = outputs["portfolio_risk"].collect()
    assert len(risk) == 3
    user_rows = outputs["portfolio_behavior_features"].collect()
    first_user = next(row for row in user_rows if row.user_id == portfolio_events()[0]["user_id"])
    assert first_user.trade_frequency == 2
    assert first_user.turnover == 400.0
    assert first_user.concentration_hhi == 0.5
    assert first_user.maximum_drawdown == -0.2
    assert first_user.action_count == 1
    assert first_user.educational_signal == "concentrated_activity"
    assert outputs["behavior_activity_daily"].count() == 5


def test_batch_run_writes_idempotent_run_outputs_and_metadata(spark, tmp_path):
    input_path = str(tmp_path / "bronze")
    output_path = str(tmp_path / "derived")
    bronze_frame(spark, market_events() + portfolio_events()).write.mode("overwrite").parquet(
        input_path
    )

    metadata = run_batch(
        spark,
        bronze_path=input_path,
        output_root=output_path,
        run_id="deterministic-test",
        config={"source": "pytest", "api_token": "must-not-be-written"},
    )

    assert metadata["silver_rows"] == 10
    assert metadata["rejected_rows"] == 0
    assert metadata["accepted_by_event_type"] == [
        {"event_type": "market_quote", "count": 3},
        {"event_type": "portfolio_snapshot", "count": 3},
        {"event_type": "trade_executed", "count": 3},
        {"event_type": "user_action", "count": 1},
    ]
    assert metadata["input_date_range"] == {
        "start_inclusive": None,
        "end_inclusive": None,
    }
    assert metadata["code_version"]
    assert metadata["configuration"] == {
        "source": "pytest",
        "api_token": "[REDACTED]",
    }
    assert set(metadata["output_paths"]) >= {"market_daily", "portfolio_risk"}
    assert spark.read.parquet(metadata["output_paths"]["market_daily"]).count() == 3
    assert spark.read.text(f"{output_path}/_runs/deterministic-test").count() == 1
