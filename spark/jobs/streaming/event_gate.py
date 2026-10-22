"""Speed layer: validation gate, curated landing and complete-mode demo for all topics.

Queries:

``event_gate``         Stateless, foreachBatch. Per micro-batch it
                       * writes invalid events to the dead-letter output with
                         the original payload, error code and processing time,
                       * classifies valid events as on_time / accepted_late /
                         too_late (spark/lib/lateness.py) and writes too-late
                         events to a diagnostic output,
                       * stores counters in ``pipeline_quality_metrics``.
                       Outputs go to ``.../run=<RUN_ID>/batch=<id>`` and are
                       overwritten on retry, so a re-run batch is idempotent.
``curated_events``     Valid events appended as Parquet (Snappy), partitioned
                       by event_type/event_date. Spark's file sink commits
                       through its metadata log, so retries do not duplicate
                       files. Producer duplicates are kept here and removed
                       by event_id in the batch layer's silver step.
``event_type_totals``  Complete-mode demonstration: running count per event
                       type. Complete mode re-emits the whole result table
                       every trigger and keeps all state, which is only
                       acceptable because there are four keys.
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging

from pyspark.sql import DataFrame
from pyspark.sql import functions as F

from serving.mongo_sink import PIPELINE_METRICS, STREAM_STATE, record_batch_metrics
from spark.jobs.streaming.common import (
    ServingBatchWriter,
    ServingWrite,
    SinkTarget,
    attach_progress_listener,
    await_queries,
    default_trigger,
    parse_stream,
    start_foreach_batch,
)
from spark.lib.envelope import valid_events
from spark.lib.lateness import (
    LATENESS_GROUPS,
    TOO_LATE,
    LatenessStateStore,
    lateness_column,
    spark_ts_to_utc,
)
from spark.lib.streaming_config import StreamingConfig, build_spark_session
from spark.lib.streaming_sources import kafka_source

GATE_QUERY = "event_gate"
QUERIES = (GATE_QUERY, "curated_events", "event_type_totals")


def lateness_group(event_type_col):
    expr = None
    for event_type, group in LATENESS_GROUPS.items():
        cond = event_type_col == F.lit(event_type)
        expr = F.when(cond, F.lit(group)) if expr is None else expr.when(cond, F.lit(group))
    return expr


class EventGate:
    """foreachBatch function for the ``event_gate`` query."""

    def __init__(self, cfg: StreamingConfig, target: SinkTarget):
        self.cfg = cfg
        self.target = target
        self.delay = dt.timedelta(seconds=cfg.watermark_seconds)

    def _output_path(self, kind: str, batch_id: int) -> str:
        return f"{self.cfg.diagnostics(kind)}/run={self.cfg.run_id}/batch={batch_id}"

    def __call__(self, batch_df: DataFrame, batch_id: int) -> None:
        db = self.target.db()
        store = LatenessStateStore(db[STREAM_STATE], GATE_QUERY, self.cfg.run_id)
        groups = sorted(set(LATENESS_GROUPS.values()))
        states = {g: store.load(g) for g in groups}
        marks = {g: states[g].marks_for_batch(batch_id, self.delay) for g in groups}
        high_water_marks = {g: m.high_water_mark for g, m in marks.items()}
        watermarks = {g: m.late_watermark for g, m in marks.items()}

        valid = F.col("error_code").isNull()
        df = batch_df.withColumn("lateness_group", lateness_group(F.col("event_type"))).withColumn(
            "lateness",
            F.when(valid, lateness_column(F.col("event_time"), F.col("lateness_group"), marks)),
        )
        df.persist()
        try:
            counts = df.groupBy("event_type", "error_code", "lateness").count().collect()
            group_max = (
                df.filter(valid).groupBy("lateness_group").agg(F.max("event_time").alias("max_event_time")).collect()
            )
            duplicates = (
                df.filter(valid).groupBy("event_id").count().filter(F.col("count") > 1)
                .agg(F.sum(F.col("count") - 1).alias("n")).collect()[0]["n"]
            ) or 0

            invalid_total = sum(r["count"] for r in counts if r["error_code"] is not None)
            too_late_total = sum(r["count"] for r in counts if r["lateness"] == TOO_LATE)
            processing_time = F.current_timestamp()
            if invalid_total:
                kafka_cols = [c for c in ("kafka_topic", "kafka_partition", "kafka_offset", "kafka_timestamp") if c in df.columns]
                (
                    df.filter(~valid)
                    .select("event_id", "event_type", "source", "error_code", "raw_value", *kafka_cols)
                    .withColumn("processing_time", processing_time)
                    .withColumn("batch_id", F.lit(batch_id))
                    .write.mode("overwrite")
                    .parquet(self._output_path("dead_letter", batch_id))
                )
            if too_late_total:

                def per_group(values: dict):
                    pairs = [x for g, v in values.items() if v is not None for x in (F.lit(g), F.lit(v))]
                    return F.create_map(*pairs)[F.col("lateness_group")]

                (
                    df.filter(F.col("lateness") == TOO_LATE)
                    .select(
                        "event_id", "event_type", "asset_symbol", "user_id", "event_time", "ingestion_time",
                        "source", "raw_value", "lateness_group",
                    )
                    .withColumn("high_water_mark", per_group(high_water_marks))
                    .withColumn("watermark", per_group(watermarks))
                    .withColumn(
                        "lateness_seconds",
                        F.unix_seconds(F.col("high_water_mark")) - F.unix_seconds(F.col("event_time")),
                    )
                    .withColumn("processing_time", processing_time)
                    .withColumn("batch_id", F.lit(batch_id))
                    .write.mode("overwrite")
                    .parquet(self._output_path("too_late", batch_id))
                )

            batch_max = {r["lateness_group"]: spark_ts_to_utc(r["max_event_time"]) for r in group_max}
            for group in groups:
                store.save(group, states[group].advance(batch_id, batch_max.get(group)))

            by_class: dict[str, int] = {}
            by_error: dict[str, int] = {}
            by_type: dict[str, int] = {}
            for r in counts:
                event_type = r["event_type"] or "unknown"
                by_type[event_type] = by_type.get(event_type, 0) + r["count"]
                if r["error_code"] is not None:
                    by_error[r["error_code"]] = by_error.get(r["error_code"], 0) + r["count"]
                else:
                    by_class[r["lateness"]] = by_class.get(r["lateness"], 0) + r["count"]
            record_batch_metrics(
                db[PIPELINE_METRICS],
                kind="gate",
                query_name=GATE_QUERY,
                run_id=self.cfg.run_id,
                batch_id=batch_id,
                values={
                    "total": sum(r["count"] for r in counts),
                    "valid": sum(by_class.values()),
                    "invalid": invalid_total,
                    "duplicates_in_batch": int(duplicates),
                    "by_lateness": by_class,
                    "by_error_code": by_error,
                    "by_event_type": by_type,
                    "high_water_marks": high_water_marks,
                    "watermarks": watermarks,
                },
            )
        finally:
            df.unpersist()


def curated_events(parsed: DataFrame) -> DataFrame:
    return valid_events(parsed).select(
        "event_id", "event_type", "schema_version", "source", "event_time", "ingestion_time",
        "asset_symbol", "user_id", "payload", "event_date",
    )


def event_type_totals(parsed: DataFrame, run_id: str) -> DataFrame:
    totals = valid_events(parsed).groupBy("event_type").agg(
        F.count(F.lit(1)).alias("events_including_duplicates"),
        F.max("event_time").alias("last_event_time"),
    )
    return totals.select(
        F.concat_ws("|", F.lit("totals"), F.lit(run_id), F.col("event_type")).alias("_id"),
        F.lit("event_type_totals").alias("kind"),
        "event_type",
        "events_including_duplicates",
        "last_event_time",
    )


def start_gate_queries(raw: DataFrame, cfg: StreamingConfig, target: SinkTarget, names, *, trigger=None):
    parsed = parse_stream(raw, cfg)
    queries = []
    if GATE_QUERY in names:
        queries.append(
            start_foreach_batch(parsed, name=GATE_QUERY, cfg=cfg, output_mode="append", fn=EventGate(cfg, target), trigger=trigger)
        )
    if "curated_events" in names:
        queries.append(
            curated_events(parsed)
            .writeStream.queryName("curated_events")
            .outputMode("append")
            .format("parquet")
            .option("compression", "snappy")
            .option("path", cfg.curated_root)
            .option("checkpointLocation", cfg.checkpoint("curated_events"))
            .partitionBy("event_type", "event_date")
            .trigger(**(trigger or default_trigger(cfg)))
            .start()
        )
    if "event_type_totals" in names:
        queries.append(
            start_foreach_batch(
                event_type_totals(parsed, cfg.run_id),
                name="event_type_totals",
                cfg=cfg,
                output_mode="complete",
                fn=ServingBatchWriter(target, "event_type_totals", [ServingWrite(PIPELINE_METRICS)]),
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
    spark = build_spark_session("finsight-event-gate", cfg)
    target = SinkTarget(cfg)
    attach_progress_listener(spark, target)
    topics = [cfg.market_topic, cfg.trades_topic, cfg.user_actions_topic, cfg.portfolio_topic]
    await_queries(spark, start_gate_queries(kafka_source(spark, cfg, topics), cfg, target, names))


if __name__ == "__main__":
    main()
