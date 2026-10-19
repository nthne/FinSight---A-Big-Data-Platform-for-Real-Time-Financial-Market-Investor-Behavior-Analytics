"""Shared plumbing for the speed-layer jobs: sinks, query start-up and run loop."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Callable

from pyspark.sql import Column, DataFrame, SparkSession
from pyspark.sql import functions as F
from pyspark.sql.streaming import StreamingQuery

from serving.keys import SPARK_TS_PATTERN
from serving.mongo_sink import PIPELINE_METRICS, MongoUpsertWriter, SinkSettings, record_batch_metrics, shared_client
from spark.lib.envelope import parse_events
from spark.lib.progress_listener import MongoProgressListener
from spark.lib.streaming_config import StreamingConfig

log = logging.getLogger(__name__)


def parse_stream(raw: DataFrame, cfg: StreamingConfig) -> DataFrame:
    """``parse_events`` with the validation settings of this deployment."""
    return parse_events(
        raw,
        max_future_skew_seconds=cfg.max_future_skew_seconds,
        known_symbols=cfg.known_asset_symbols,
    )


def ts_key(col: Column | str) -> Column:
    """Render a timestamp exactly like ``serving.keys.iso_utc`` (session TZ is UTC)."""
    return F.date_format(col, SPARK_TS_PATTERN)


def serving_id(layer: str, series_key: Column) -> Column:
    return F.concat_ws("|", F.lit(layer), series_key)


@dataclass
class SinkTarget:
    """Where serving documents go.

    In production writes use ``cfg.mongo_uri``. Tests pass ``database`` (a
    pymongo or mongomock Database) and every write then runs on the driver.
    """

    cfg: StreamingConfig
    database: object | None = None

    def db(self):
        if self.database is not None:
            return self.database
        return shared_client(self.cfg.mongo_uri)[self.cfg.mongo_database]

    def writer(self, collection: str, query_name: str, *, layer: str | None = None, guard_field: str | None = None) -> MongoUpsertWriter:
        settings = SinkSettings(
            mongo_uri=self.cfg.mongo_uri,
            database=self.cfg.mongo_database,
            collection=collection,
            query_name=query_name,
            run_id=self.cfg.run_id,
            layer=layer,
            guard_field=guard_field,
        )
        if self.database is not None:
            database = self.database
            return MongoUpsertWriter(settings, mode="driver", collection_factory=lambda: database[collection])
        return MongoUpsertWriter(settings, mode=self.cfg.sink_mode)


@dataclass
class ServingWrite:
    """One collection written by a foreachBatch function."""

    collection: str
    layer: str | None = None
    guard_field: str | None = None
    # Derives the documents for this collection from the micro-batch.
    transform: Callable[[DataFrame], DataFrame] | None = None


@dataclass
class ServingBatchWriter:
    """``foreachBatch`` function that upserts a micro-batch into one or more collections."""

    target: SinkTarget
    query_name: str
    writes: list[ServingWrite] = field(default_factory=list)

    def __call__(self, batch_df: DataFrame, batch_id: int) -> None:
        batch_df.persist()
        try:
            results = {}
            for spec in self.writes:
                out = spec.transform(batch_df) if spec.transform else batch_df
                writer = self.target.writer(spec.collection, self.query_name, layer=spec.layer, guard_field=spec.guard_field)
                results[spec.collection] = writer.write(out, batch_id).as_dict()
            record_batch_metrics(
                self.target.db()[PIPELINE_METRICS],
                kind="sink",
                query_name=self.query_name,
                run_id=self.target.cfg.run_id,
                batch_id=batch_id,
                values={"results": results},
            )
        finally:
            batch_df.unpersist()


def default_trigger(cfg: StreamingConfig) -> dict:
    return {"processingTime": cfg.trigger_interval}


def start_foreach_batch(
    df: DataFrame,
    *,
    name: str,
    cfg: StreamingConfig,
    output_mode: str,
    fn: Callable[[DataFrame, int], None],
    trigger: dict | None = None,
) -> StreamingQuery:
    return (
        df.writeStream.queryName(name)
        .outputMode(output_mode)
        .option("checkpointLocation", cfg.checkpoint(name))
        .trigger(**(trigger or default_trigger(cfg)))
        .foreachBatch(fn)
        .start()
    )


def attach_progress_listener(spark: SparkSession, target: SinkTarget) -> None:
    spark.streams.addListener(MongoProgressListener(lambda: target.db()[PIPELINE_METRICS]))


def await_queries(spark: SparkSession, queries: list[StreamingQuery]) -> None:
    """Block until a query stops; a failure stops the rest so Kubernetes restarts the pod."""
    try:
        spark.streams.awaitAnyTermination()
    finally:
        for query in queries:
            if query.isActive:
                query.stop()
        for query in queries:
            error = query.exception()
            if error is not None:
                raise RuntimeError(f"streaming query {query.name} failed: {error}")
