"""Speed layer: investor-behaviour activity from ``trades`` and ``user-actions``.

Queries:

``user_activity_5m``  5-minute tumbling windows per pseudonymous user, update
                      mode -> ``user_activity_windows`` (layer=speed).
``user_sessions``     Session windows (15-minute inactivity gap), append mode
                      -> ``user_sessions``. Append mode emits a session once,
                      after the watermark passes its end, so it is final.

Only ``trade_executed`` events whose ``payload.status`` is ``executed`` (or
absent, which producers default to ``executed``) count as trades; pending,
cancelled and rejected orders did not trade and are ignored.

The ``overtrading_signal`` is an educational heuristic (trades per window above
``OVERTRADING_TRADES_PER_WINDOW``), not a diagnosis or advice.
"""

from __future__ import annotations

import argparse
import logging

from pyspark.sql import DataFrame
from pyspark.sql import functions as F

from serving.mongo_sink import USER_ACTIVITY, USER_SESSIONS
from spark.jobs.streaming.common import (
    ServingBatchWriter,
    ServingWrite,
    SinkTarget,
    attach_progress_listener,
    await_queries,
    parse_stream,
    serving_id,
    start_foreach_batch,
    ts_key,
)
from spark.lib.envelope import valid_events
from spark.lib.streaming_config import (
    USER_ACTIVITY_5M,
    USER_SESSION_GAP,
    StreamingConfig,
    WindowSpec,
    build_spark_session,
    duration_seconds,
)
from spark.lib.streaming_sources import kafka_source

QUERIES = ("user_activity_5m", "user_sessions")


def behavior_events(raw: DataFrame, cfg: StreamingConfig) -> DataFrame:
    parsed = parse_stream(raw, cfg)
    events = valid_events(parsed, "trade_executed", "user_action")
    is_trade = F.col("event_type") == "trade_executed"
    status = F.col("payload.status")
    events = events.filter(~is_trade | status.isNull() | (status == "executed"))
    side = F.col("payload.side")
    return events.select(
        "event_id",
        "event_type",
        "event_time",
        "user_id",
        "asset_symbol",
        is_trade.cast("int").alias("is_trade"),
        (is_trade & (side == "buy")).cast("int").alias("is_buy"),
        (is_trade & (side == "sell")).cast("int").alias("is_sell"),
        (F.col("event_type") == "user_action").cast("int").alias("is_action"),
        F.when(is_trade, F.col("payload.quantity") * F.col("payload.price")).otherwise(F.lit(0.0)).alias("notional"),
        F.when(is_trade, F.coalesce(F.col("payload.fee"), F.lit(0.0))).otherwise(F.lit(0.0)).alias("fee"),
    )


def _activity_aggs() -> list:
    return [
        F.count(F.lit(1)).alias("event_count"),
        F.sum("is_trade").alias("trade_count"),
        F.sum("is_buy").alias("buy_count"),
        F.sum("is_sell").alias("sell_count"),
        F.sum("is_action").alias("action_count"),
        F.sum("notional").alias("turnover"),
        F.sum("fee").alias("fees"),
        F.approx_count_distinct("asset_symbol").alias("distinct_assets"),
        F.min("event_time").alias("first_event_time"),
        F.max("event_time").alias("last_event_time"),
    ]


def user_activity_windows(events: DataFrame, spec: WindowSpec, watermark: str, overtrading_threshold: int) -> DataFrame:
    deduped = events.withWatermark("event_time", watermark).dropDuplicatesWithinWatermark(["event_id"])
    agg = deduped.groupBy(F.window("event_time", spec.duration).alias("window"), "user_id").agg(*_activity_aggs())
    series_key = F.concat_ws("|", F.lit("usr"), F.col("user_id"), F.lit(spec.label), ts_key("window.start"))
    return agg.select(
        serving_id("speed", series_key).alias("_id"),
        series_key.alias("series_key"),
        "user_id",
        F.lit(spec.label).alias("granularity"),
        F.col("window.start").alias("window_start"),
        F.col("window.end").alias("window_end"),
        F.lit(duration_seconds(spec.duration)).alias("window_seconds"),
        "event_count",
        "trade_count",
        "buy_count",
        "sell_count",
        "action_count",
        "turnover",
        "fees",
        "distinct_assets",
        F.try_divide(F.col("buy_count"), F.col("trade_count")).alias("buy_ratio"),
        (F.col("trade_count") >= F.lit(overtrading_threshold)).alias("overtrading_signal"),
        "first_event_time",
        "last_event_time",
    )


def user_sessions(events: DataFrame, gap: str, watermark: str) -> DataFrame:
    deduped = events.withWatermark("event_time", watermark).dropDuplicatesWithinWatermark(["event_id"])
    agg = deduped.groupBy(F.session_window("event_time", gap).alias("session"), "user_id").agg(*_activity_aggs())
    series_key = F.concat_ws("|", F.lit("ses"), F.col("user_id"), ts_key("session.start"))
    return agg.select(
        serving_id("speed", series_key).alias("_id"),
        series_key.alias("series_key"),
        "user_id",
        F.col("session.start").alias("session_start"),
        F.col("session.end").alias("session_end"),
        (F.unix_seconds(F.col("session.end")) - F.unix_seconds(F.col("session.start"))).alias("session_seconds"),
        "event_count",
        "trade_count",
        "buy_count",
        "sell_count",
        "action_count",
        "turnover",
        "fees",
        "distinct_assets",
        "first_event_time",
        "last_event_time",
    )


def start_behavior_queries(raw: DataFrame, cfg: StreamingConfig, target: SinkTarget, names, *, trigger=None):
    events = behavior_events(raw, cfg)
    queries = []
    if "user_activity_5m" in names:
        queries.append(
            start_foreach_batch(
                user_activity_windows(events, USER_ACTIVITY_5M, cfg.watermark_delay, cfg.overtrading_trades_per_window),
                name="user_activity_5m",
                cfg=cfg,
                output_mode="update",
                fn=ServingBatchWriter(target, "user_activity_5m", [ServingWrite(USER_ACTIVITY, layer="speed")]),
                trigger=trigger,
            )
        )
    if "user_sessions" in names:
        queries.append(
            start_foreach_batch(
                user_sessions(events, USER_SESSION_GAP, cfg.watermark_delay),
                name="user_sessions",
                cfg=cfg,
                output_mode="append",
                fn=ServingBatchWriter(target, "user_sessions", [ServingWrite(USER_SESSIONS, layer="speed")]),
                trigger=trigger,
            )
        )
    return queries


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--queries", default=",".join(QUERIES), help=f"comma-separated subset of {list(QUERIES)}")
    args = parser.parse_args(argv)
    names = [n.strip() for n in args.queries.split(",") if n.strip()]
    unknown = set(names) - set(QUERIES)
    if unknown:
        parser.error(f"unknown queries: {sorted(unknown)}")

    logging.basicConfig(level=logging.INFO)
    cfg = StreamingConfig.from_env()
    spark = build_spark_session("finsight-behavior-stream", cfg)
    target = SinkTarget(cfg)
    attach_progress_listener(spark, target)
    raw = kafka_source(spark, cfg, [cfg.trades_topic, cfg.user_actions_topic])
    await_queries(spark, start_behavior_queries(raw, cfg, target, names))


if __name__ == "__main__":
    main()
