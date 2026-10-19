"""Streaming sources for the speed layer.

Both sources return a DataFrame with a string ``value`` column holding one
JSON event, so the parsing and query code is identical in production (Kafka)
and in deterministic tests/offline replays (newline-delimited JSON files).
"""

from __future__ import annotations

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

from spark.lib.streaming_config import StreamingConfig


def kafka_source(spark: SparkSession, cfg: StreamingConfig, topics: list[str]) -> DataFrame:
    reader = (
        spark.readStream.format("kafka")
        .option("kafka.bootstrap.servers", cfg.kafka_bootstrap_servers)
        .option("subscribe", ",".join(topics))
        .option("startingOffsets", cfg.starting_offsets)
        # Stop instead of silently skipping offsets that Kafka retention removed.
        .option("failOnDataLoss", "true")
    )
    if cfg.max_offsets_per_trigger:
        reader = reader.option("maxOffsetsPerTrigger", str(cfg.max_offsets_per_trigger))
    return reader.load().select(
        F.col("value").cast("string").alias("value"),
        F.col("timestamp").alias("kafka_timestamp"),
        F.col("topic").alias("kafka_topic"),
        F.col("partition").alias("kafka_partition"),
        F.col("offset").alias("kafka_offset"),
    )


def file_source(spark: SparkSession, path: str, *, max_files_per_trigger: int = 1) -> DataFrame:
    """Replay JSON-lines files; one file per micro-batch by default.

    Files are picked up in modification-time order, which tests use to make
    micro-batch boundaries deterministic.
    """
    return spark.readStream.option("maxFilesPerTrigger", str(max_files_per_trigger)).text(path)
