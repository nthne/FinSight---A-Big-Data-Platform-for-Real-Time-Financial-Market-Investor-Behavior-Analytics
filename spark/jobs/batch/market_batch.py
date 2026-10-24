"""Bronze-to-Gold market batch transformations and command-line runner."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F

from spark.lib.aggregations import weighted_population_volatility
from spark.lib.quality import validate_and_normalize
from spark.jobs.batch.portfolio_batch import build_portfolio_analytics

RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
_SECRET_CONFIG_KEY = re.compile(
    r"(secret|password|token|credential|api[_-]?key|uri|url)",
    re.IGNORECASE,
)


def _code_version() -> str:
    version = os.environ.get("GIT_COMMIT")
    if version:
        return version
    source_root = Path(__file__).resolve().parents[3] / "spark"
    digest = hashlib.sha256()
    for source in sorted(source_root.rglob("*.py")):
        digest.update(source.relative_to(source_root).as_posix().encode("utf-8"))
        digest.update(source.read_bytes())
    return f"sha256:{digest.hexdigest()}"


def _redact_configuration(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if _SECRET_CONFIG_KEY.search(key) else _redact_configuration(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_configuration(item) for item in value]
    return value


def _reject_uri_credentials(path: str, label: str) -> None:
    parsed = urlsplit(path)
    if parsed.username is not None or parsed.password is not None:
        raise ValueError(
            f"{label} must not embed credentials; configure storage credentials separately"
        )


def build_market_analytics(
    silver: DataFrame,
    *,
    source_pivot_values: list[str] | None = None,
    rolling_rows: int = 5,
) -> dict[str, DataFrame]:
    """Build quote time-series, daily, rollup/cube, pivot and unpivot outputs."""
    if rolling_rows < 2:
        raise ValueError("rolling_rows must be at least 2")

    quotes = silver.filter(F.col("event_type") == "market_quote")
    ordered = Window.partitionBy("asset_symbol").orderBy("event_time", "event_id")
    rolling = ordered.rowsBetween(-(rolling_rows - 1), Window.currentRow)
    with_returns = (
        quotes.withColumn("_previous_close", F.lag("close_price").over(ordered))
        .withColumn("_previous_volume", F.lag("volume").over(ordered))
        .withColumn(
            "simple_return",
            F.when(
                F.col("_previous_close") > 0,
                F.col("close_price") / F.col("_previous_close") - F.lit(1.0),
            ),
        )
        .withColumn(
            "_volume_weight",
            F.coalesce(F.col("volume"), F.lit(1.0)).cast("double"),
        )
        .withColumn(
            "volume_change",
            F.when(
                F.col("_previous_volume").isNotNull(),
                F.col("volume") - F.col("_previous_volume"),
            ),
        )
        .withColumn("moving_average", F.avg("close_price").over(rolling))
        .withColumn("rolling_volatility", F.stddev_samp("simple_return").over(rolling))
        .withColumn("rolling_z_score", F.expr(
            "(close_price - moving_average) / nullif(stddev_samp(close_price) over "
            "(partition by asset_symbol order by event_time, event_id rows between "
            f"{rolling_rows - 1} preceding and current row), 0)"
        ))
        .withColumn(
            "running_peak",
            F.max("close_price").over(ordered.rowsBetween(Window.unboundedPreceding, Window.currentRow)),
        )
        .withColumn("drawdown", F.col("close_price") / F.col("running_peak") - F.lit(1.0))
        .withColumn(
            "rolling_return_volume_correlation",
            F.corr("simple_return", "volume_change").over(rolling),
        )
    )
    time_series = with_returns.drop("_previous_close", "_previous_volume", "_volume_weight")

    daily_base = time_series.groupBy("event_date", "asset_symbol").agg(
        F.count(F.lit(1)).alias("quote_count"),
        F.min_by("close_price", F.struct("event_time", "event_id")).alias("open_price"),
        F.max("close_price").alias("high_price"),
        F.min("close_price").alias("low_price"),
        F.max_by("close_price", F.struct("event_time", "event_id")).alias("close_price"),
        F.percentile_approx("close_price", 0.5, 10_000).alias("median_close"),
        F.percentile_approx("close_price", 0.95, 10_000).alias("p95_close"),
        F.max_by("volume", F.struct("event_time", "event_id")).alias("volume"),
        F.sum(
            F.when(
                F.col("simple_return").isNotNull(),
                F.when(F.col("volume") > 0, F.col("volume")).otherwise(F.lit(1.0)),
            )
        ).alias("_weight_sum"),
        F.sum(
            F.when(
                F.col("simple_return").isNotNull(),
                F.col("simple_return")
                * F.when(F.col("volume") > 0, F.col("volume")).otherwise(F.lit(1.0)),
            )
        ).alias("_weighted_return_sum"),
        F.sum(
            F.when(
                F.col("simple_return").isNotNull(),
                F.pow(F.col("simple_return"), 2)
                * F.when(F.col("volume") > 0, F.col("volume")).otherwise(F.lit(1.0)),
            )
        ).alias("_weighted_squared_return_sum"),
        F.avg("simple_return").alias("average_return"),
        F.var_samp("simple_return").alias("return_variance"),
        F.min("drawdown").alias("maximum_observed_drawdown"),
    )
    daily = (
        daily_base.withColumn(
            "weighted_volatility",
            weighted_population_volatility(
                "_weight_sum",
                "_weighted_return_sum",
                "_weighted_squared_return_sum",
            ),
        )
        .drop("_weight_sum", "_weighted_return_sum", "_weighted_squared_return_sum")
    )
    rollup = daily.rollup("event_date", "asset_symbol").agg(
        F.grouping_id("event_date", "asset_symbol").alias("grouping_level"),
        F.sum("quote_count").alias("quote_count"),
        F.avg("average_return").alias("average_return"),
        F.avg("weighted_volatility").alias("weighted_volatility"),
    )
    cube = daily.cube("event_date", "asset_symbol").agg(
        F.grouping_id("event_date", "asset_symbol").alias("grouping_level"),
        F.sum("quote_count").alias("quote_count"),
        F.avg("average_return").alias("average_return"),
        F.avg("weighted_volatility").alias("weighted_volatility"),
    )
    if source_pivot_values is None:
        source_pivot_values = [
            row["source"]
            for row in quotes.select("source").distinct().orderBy("source").collect()
            if row["source"] is not None
        ]
    source_pivot = (
        quotes.groupBy("event_date")
        .pivot("source", source_pivot_values)
        .agg(F.avg("close_price"))
    )
    unpivot = daily.selectExpr(
        "event_date",
        "asset_symbol",
        "stack(6, "
        "'average_return', average_return, "
        "'weighted_volatility', weighted_volatility, "
        "'maximum_observed_drawdown', maximum_observed_drawdown, "
        "'quote_count', cast(quote_count as double), "
        "'median_close', median_close, "
        "'p95_close', p95_close) as (metric, value)",
    )
    return {
        "market_time_series": time_series,
        "market_daily": daily,
        "market_rollup": rollup,
        "market_cube": cube,
        "market_source_pivot": source_pivot,
        "market_metrics_long": unpivot,
    }


def _parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def run_batch(
    spark: SparkSession,
    *,
    bronze_path: str,
    output_root: str,
    run_id: str,
    start_date: date | None = None,
    end_date: date | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Rebuild this run's Silver and Gold Parquet outputs and metadata."""
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise ValueError("run_id must contain only letters, numbers, dot, underscore or dash")
    if start_date and end_date and start_date > end_date:
        raise ValueError("start_date must not be after end_date")
    _reject_uri_credentials(bronze_path, "bronze_path")
    _reject_uri_credentials(output_root, "output_root")

    spark.conf.set("spark.sql.session.timeZone", "UTC")
    bronze = spark.read.parquet(bronze_path)
    if start_date:
        bronze = bronze.filter(F.col("event_date") >= start_date.isoformat())
    if end_date:
        bronze = bronze.filter(F.col("event_date") <= end_date.isoformat())

    known_symbols = config.get("known_asset_symbols") if config else None
    if known_symbols is not None and (
        not isinstance(known_symbols, list)
        or any(not isinstance(symbol, str) for symbol in known_symbols)
    ):
        raise ValueError("configuration known_asset_symbols must be a list of strings")
    rolling_rows = (config or {}).get("market_rolling_rows", 5)
    if isinstance(rolling_rows, bool) or not isinstance(rolling_rows, int):
        raise ValueError("configuration market_rolling_rows must be an integer")
    silver, rejected = validate_and_normalize(bronze, known_symbols=known_symbols)
    silver = silver.persist()
    try:
        silver_count = silver.count()
        rejected_count = rejected.count()
        accepted_by_type = [
            row.asDict()
            for row in silver.groupBy("event_type").count().orderBy("event_type").collect()
        ]
        rejected_by_rule_and_source = [
            row.asDict()
            for row in rejected.groupBy("source", "quality_error")
            .count()
            .orderBy("source", "quality_error")
            .collect()
        ]
        silver_path = f"{output_root.rstrip('/')}/silver/run_id={run_id}"
        silver.write.mode("overwrite").option("compression", "snappy").partitionBy(
            "event_type", "event_date"
        ).parquet(silver_path)
        rejected_path = f"{output_root.rstrip('/')}/quality/rejected/run_id={run_id}"
        rejected.write.mode("overwrite").option("compression", "snappy").partitionBy(
            "event_type", "event_date"
        ).parquet(rejected_path)

        outputs = build_market_analytics(silver, rolling_rows=rolling_rows)
        portfolio_outputs = build_portfolio_analytics(silver)
        outputs.update(portfolio_outputs)
        output_paths: dict[str, str] = {}
        for name, frame in outputs.items():
            path = f"{output_root.rstrip('/')}/gold/{name}/run_id={run_id}"
            frame.write.mode("overwrite").option("compression", "snappy").partitionBy(
                "event_date"
            ).parquet(path)
            output_paths[name] = path

        partitions = [
            row.asDict()
            for row in bronze.select("event_type", "event_date").distinct().collect()
        ]
        metadata = {
            "run_id": run_id,
            "code_version": _code_version(),
            "configuration": _redact_configuration(config or {}),
            "input_path": bronze_path,
            "input_date_range": {
                "start_inclusive": start_date.isoformat() if start_date else None,
                "end_inclusive": end_date.isoformat() if end_date else None,
            },
            "input_partitions": partitions,
            "input_rows": silver_count + rejected_count,
            "silver_rows": silver_count,
            "rejected_rows": rejected_count,
            "accepted_by_event_type": accepted_by_type,
            "rejected_by_rule_and_source": rejected_by_rule_and_source,
            "completed_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "silver_path": silver_path,
            "rejected_path": rejected_path,
            "output_paths": output_paths,
        }
        metadata_path = f"{output_root.rstrip('/')}/_runs/{run_id}"
        spark.createDataFrame([(json.dumps(metadata, sort_keys=True),)], ["value"]).write.mode(
            "overwrite"
        ).text(metadata_path)
        return metadata
    finally:
        silver.unpersist()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Bronze Parquet root or event-type path")
    parser.add_argument("--output", required=True, help="Silver/Gold output root")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--start-date", help="Inclusive ISO date")
    parser.add_argument("--end-date", help="Inclusive ISO date")
    parser.add_argument("--config", help="Optional JSON object recorded as run configuration")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8")) if args.config else {}
    if not isinstance(config, dict):
        raise ValueError("config file must contain a JSON object")
    builder = (
        SparkSession.builder.appName(f"finsight-batch-{args.run_id}")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.adaptive.enabled", "true")
    )
    if any(path.startswith("s3a://") for path in (args.input, args.output)):
        from spark.lib.streaming_config import HADOOP_AWS_PACKAGE

        builder = builder.config("spark.jars.packages", HADOOP_AWS_PACKAGE)
    spark = builder.getOrCreate()
    try:
        result = run_batch(
            spark,
            bronze_path=args.input,
            output_root=args.output,
            run_id=args.run_id,
            start_date=_parse_date(args.start_date),
            end_date=_parse_date(args.end_date),
            config=config,
        )
        print(json.dumps(result, sort_keys=True))
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
