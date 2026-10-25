"""Capture reproducible Spark join timing, plan and input-file observations."""

from __future__ import annotations

import json
import re
from contextlib import redirect_stdout
from io import StringIO
import time
from pathlib import Path
from typing import Any

from pyspark import StorageLevel
from pyspark.sql import DataFrame, SparkSession


def benchmark_frame(name: str, frame: DataFrame) -> dict[str, Any]:
    """Execute a frame and collect metrics that Spark exposes without a listener."""
    started = time.perf_counter()
    row_count = frame.count()
    runtime_seconds = time.perf_counter() - started
    plan = frame._jdf.queryExecution().executedPlan().toString()
    formatted_plan = StringIO()
    with redirect_stdout(formatted_plan):
        frame.explain("formatted")
    return {
        "name": name,
        "row_count": row_count,
        "runtime_seconds": runtime_seconds,
        "input_files": len(frame.inputFiles()),
        "physical_plan": plan,
        "formatted_plan": formatted_plan.getvalue(),
        "shuffle_bytes": None,
        "peak_memory_bytes": None,
        "note": (
            "Shuffle and peak memory require Spark UI/event-log instrumentation; "
            "they are intentionally null when that evidence is unavailable."
        ),
    }


def benchmark_cached_frame(name: str, frame: DataFrame) -> dict[str, Any]:
    """Measure a reused frame with caching and always release its storage."""
    cached = frame.persist(StorageLevel.MEMORY_AND_DISK)
    try:
        return {
            "name": name,
            "cache_fill": benchmark_frame(f"{name}_cache_fill", cached),
            "cached_reuse": benchmark_frame(f"{name}_cached_reuse", cached),
        }
    finally:
        cached.unpersist(blocking=True)


def persist_bucketed_table(
    frame: DataFrame,
    *,
    table_name: str,
    warehouse_path: str,
    buckets: int = 16,
) -> None:
    """Write a catalog-backed bucketed table; a persistent metastore is required."""
    if buckets < 2:
        raise ValueError("buckets must be at least 2")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", table_name):
        raise ValueError("table_name must be a simple Spark catalog identifier")
    if "asset_symbol" not in frame.columns:
        raise ValueError("bucketed input must contain asset_symbol")
    spark = frame.sparkSession
    if spark.conf.get("spark.sql.catalogImplementation", "in-memory") != "hive":
        raise RuntimeError("Start Spark with spark.sql.catalogImplementation=hive")
    configured_warehouse = spark.conf.get("spark.sql.warehouse.dir", "")
    if configured_warehouse != warehouse_path:
        raise ValueError(
            "warehouse_path must match spark.sql.warehouse.dir configured before Spark startup"
        )
    (
        frame.write.mode("overwrite")
        .bucketBy(buckets, "asset_symbol")
        .sortBy("asset_symbol")
        .saveAsTable(table_name)
    )


def write_optimization_report(path: str | Path, records: list[dict[str, Any]]) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps({"experiments": records}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def compare_join_variants(
    baseline: DataFrame,
    optimized: DataFrame,
) -> list[dict[str, Any]]:
    return [
        benchmark_frame("baseline", baseline),
        benchmark_frame("optimized", optimized),
    ]


def enable_aqe(spark: SparkSession, enabled: bool = True) -> None:
    spark.conf.set("spark.sql.adaptive.enabled", str(enabled).lower())
    spark.conf.set("spark.sql.adaptive.coalescePartitions.enabled", str(enabled).lower())
