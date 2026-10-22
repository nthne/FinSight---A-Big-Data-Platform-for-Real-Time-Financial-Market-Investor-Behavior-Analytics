"""Speed layer: market metrics from the ``market-quotes`` topic.

Queries (each has its own checkpoint):

``market_1m``          1-minute tumbling OHLC per asset, update mode. Writes
                       ``asset_time_series_summary`` (layer=speed) and the
                       guarded ``latest_market_metrics`` view.
``market_5m_rolling``  5-minute window sliding every minute: moving average
                       and rolling volatility, update mode.

Both use a 10-minute event-time watermark (``WATERMARK_DELAY``) and drop
duplicate ``event_id`` values within the watermark.

Prices are the quote's ``payload.close_price`` (event contract 1.0.0); open,
high, low and close are computed over the quotes inside each window.
``volume`` is the provider-reported volume of the window's last quote:
providers report cumulative session (Yahoo) or rolling 24-hour (CoinGecko)
volume, so summing quotes would count the same volume many times.

Run: ``python -m spark.jobs.streaming.market_stream`` (see serving/README.md).
"""

from __future__ import annotations

import argparse
import logging

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F

from serving.mongo_sink import ASSET_TIME_SERIES, LATEST_MARKET
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
    MARKET_1M,
    MARKET_5M_ROLLING,
    StreamingConfig,
    WindowSpec,
    build_spark_session,
    duration_seconds,
)
from spark.lib.streaming_sources import kafka_source

QUERIES = {"market_1m": MARKET_1M, "market_5m_rolling": MARKET_5M_ROLLING}


def market_events(raw: DataFrame, cfg: StreamingConfig) -> DataFrame:
    parsed = parse_stream(raw, cfg)
    return valid_events(parsed, "market_quote")


def market_window_metrics(events: DataFrame, spec: WindowSpec, watermark: str) -> DataFrame:
    """Windowed market metrics with deterministic serving keys.

    Ties between quotes with the same event time are broken by ``event_id``
    so open/close are reproducible across replays.
    """
    deduped = events.withWatermark("event_time", watermark).dropDuplicatesWithinWatermark(["event_id"])
    window = (
        F.window("event_time", spec.duration, spec.slide) if spec.sliding else F.window("event_time", spec.duration)
    )
    order = F.struct("event_time", "event_id")
    price = F.col("payload.close_price")
    volume = F.col("payload.volume")
    agg = deduped.groupBy(window.alias("window"), "asset_symbol").agg(
        F.count(F.lit(1)).alias("quote_count"),
        F.min_by(price, order).alias("open"),
        F.max(price).alias("high"),
        F.min(price).alias("low"),
        F.max_by(price, order).alias("close"),
        F.avg(price).alias("avg_price"),
        F.stddev_samp(price).alias("price_stddev"),
        # Rows with a null ordering are ignored, so this is the last reported volume.
        F.max_by(volume, F.when(volume.isNotNull(), order)).alias("volume"),
        F.min("event_time").alias("first_event_time"),
        F.max("event_time").alias("last_event_time"),
        F.max("ingestion_time").alias("last_ingestion_time"),
        F.max_by(F.col("payload.currency"), order).alias("currency"),
        F.max_by(F.col("source"), order).alias("source"),
    )
    series_key = F.concat_ws("|", F.lit("mkt"), F.col("asset_symbol"), F.lit(spec.label), ts_key("window.start"))
    return agg.select(
        serving_id("speed", series_key).alias("_id"),
        series_key.alias("series_key"),
        "asset_symbol",
        F.lit(spec.label).alias("granularity"),
        F.col("window.start").alias("window_start"),
        F.col("window.end").alias("window_end"),
        F.lit(duration_seconds(spec.duration)).alias("window_seconds"),
        "quote_count",
        "open",
        "high",
        "low",
        "close",
        "avg_price",
        "price_stddev",
        (F.try_divide(F.col("price_stddev"), F.col("avg_price")) * 100).alias("volatility_pct"),
        (F.try_divide(F.col("close") - F.col("open"), F.col("open")) * 100).alias("return_pct"),
        "volume",
        "first_event_time",
        "last_event_time",
        "last_ingestion_time",
        "currency",
        "source",
    )


def latest_quotes(window_batch: DataFrame) -> DataFrame:
    """Most recent window per asset in a micro-batch, for latest_market_metrics.

    The sink guards on ``last_event_time``, so an out-of-order update to an
    older window never replaces a newer quote.
    """
    newest_first = Window.partitionBy("asset_symbol").orderBy(F.col("window_start").desc())
    return (
        window_batch.withColumn("_rank", F.row_number().over(newest_first))
        .filter(F.col("_rank") == 1)
        .select(
            F.col("asset_symbol").alias("_id"),
            "asset_symbol",
            F.col("close").alias("last_price"),
            "currency",
            "source",
            "last_event_time",
            "last_ingestion_time",
            F.col("return_pct").alias("window_return_pct"),
            F.col("granularity").alias("window_granularity"),
            "window_start",
            "window_end",
        )
    )


def market_batch_writer(target: SinkTarget, query_name: str) -> ServingBatchWriter:
    writes = [ServingWrite(ASSET_TIME_SERIES, layer="speed")]
    if query_name == "market_1m":
        writes.append(ServingWrite(LATEST_MARKET, guard_field="last_event_time", transform=latest_quotes))
    return ServingBatchWriter(target, query_name, writes)


def start_market_queries(raw: DataFrame, cfg: StreamingConfig, target: SinkTarget, names, *, trigger=None):
    events = market_events(raw, cfg)
    queries = []
    for name in names:
        metrics = market_window_metrics(events, QUERIES[name], cfg.watermark_delay)
        queries.append(
            start_foreach_batch(
                metrics,
                name=name,
                cfg=cfg,
                output_mode="update",
                fn=market_batch_writer(target, name),
                trigger=trigger,
            )
        )
    return queries


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--queries", default=",".join(QUERIES), help="comma-separated subset of %s" % list(QUERIES))
    args = parser.parse_args(argv)
    names = [n.strip() for n in args.queries.split(",") if n.strip()]
    unknown = set(names) - set(QUERIES)
    if unknown:
        parser.error(f"unknown queries: {sorted(unknown)}")

    logging.basicConfig(level=logging.INFO)
    cfg = StreamingConfig.from_env()
    spark = build_spark_session("finsight-market-stream", cfg)
    target = SinkTarget(cfg)
    attach_progress_listener(spark, target)
    raw = kafka_source(spark, cfg, [cfg.market_topic])
    await_queries(spark, start_market_queries(raw, cfg, target, names))


if __name__ == "__main__":
    main()
