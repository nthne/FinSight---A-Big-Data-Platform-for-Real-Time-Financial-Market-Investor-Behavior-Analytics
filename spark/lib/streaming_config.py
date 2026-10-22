"""Runtime configuration for the FinSight speed layer (Person C workstream).

Every setting comes from an environment variable so the same image runs in
pytest, docker compose and Kubernetes (ConfigMap for settings, Secret for
``MONGO_URI``). Defaults use the in-cluster service names from the milestone
plan; override them locally.
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field

# Versions the streaming code was developed and tested against. Person D's
# version matrix (docs/architecture/version-matrix.md) is authoritative; keep
# these in sync with it.
SPARK_VERSION = "4.0.4"
SCALA_BINARY_VERSION = "2.13"
KAFKA_PACKAGE = f"org.apache.spark:spark-sql-kafka-0-10_{SCALA_BINARY_VERSION}:{SPARK_VERSION}"
HADOOP_AWS_PACKAGE = "org.apache.hadoop:hadoop-aws:3.4.1"

_DURATION_RE = re.compile(r"^\s*(\d+)\s*(second|minute|hour|day)s?\s*$", re.IGNORECASE)
_UNIT_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


def duration_seconds(duration: str) -> int:
    """Convert a Spark interval string such as ``"10 minutes"`` to seconds."""
    match = _DURATION_RE.match(duration)
    if not match:
        raise ValueError(f"Unsupported duration {duration!r}; use e.g. '30 seconds' or '10 minutes'")
    return int(match.group(1)) * _UNIT_SECONDS[match.group(2).lower()]


@dataclass(frozen=True)
class WindowSpec:
    """An event-time window used by a speed-layer query.

    ``label`` is part of the deterministic serving key, so changing it creates
    a new series instead of overwriting the old one.
    """

    label: str
    duration: str
    slide: str | None = None

    @property
    def sliding(self) -> bool:
        return self.slide is not None and self.slide != self.duration


MARKET_1M = WindowSpec(label="1m", duration="1 minute")
MARKET_5M_ROLLING = WindowSpec(label="5m_rolling", duration="5 minutes", slide="1 minute")
USER_ACTIVITY_5M = WindowSpec(label="5m", duration="5 minutes")
USER_SESSION_GAP = "15 minutes"


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return default if value is None or value.strip() == "" else value.strip()


def _env_list(name: str) -> tuple[str, ...]:
    raw = os.environ.get(name) or ""
    return tuple(item.strip().upper() for item in raw.split(",") if item.strip())


def _env_int(name: str, default: int | None) -> int | None:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


@dataclass(frozen=True)
class StreamingConfig:
    kafka_bootstrap_servers: str = "kafka:9092"
    market_topic: str = "market-quotes"
    trades_topic: str = "trades"
    user_actions_topic: str = "user-actions"
    portfolio_topic: str = "portfolio-snapshots"
    starting_offsets: str = "latest"
    max_offsets_per_trigger: int | None = None
    # Event-time watermark shared by every stateful speed-layer query.
    watermark_delay: str = "10 minutes"
    # Events whose event_time is ahead of ingestion_time by more than this are rejected.
    max_future_skew_seconds: int = 300
    # Same reference list as the ingestion gateway (KNOWN_ASSET_SYMBOLS in
    # deploy/k8s/ingestion-config.yaml); empty disables the UNKNOWN_SYMBOL check.
    known_asset_symbols: tuple[str, ...] = ()
    trigger_interval: str = "10 seconds"
    checkpoint_root: str = "s3a://fin-sight/checkpoints/speed"
    curated_root: str = "s3a://fin-sight/silver/speed"
    diagnostics_root: str = "s3a://fin-sight/diagnostics"
    mongo_uri: str = "mongodb://mongodb:27017"
    mongo_database: str = "finsight"
    # Identifies one checkpoint lineage. Keep it stable across restarts that
    # reuse the checkpoint; change it whenever the checkpoints are reset.
    run_id: str = "speed-default"
    # "executor" writes MongoDB from Spark executors; "driver" collects each
    # micro-batch first (only for small aggregate outputs and tests).
    sink_mode: str = "executor"
    overtrading_trades_per_window: int = 10
    shuffle_partitions: int = 8
    extra_spark_conf: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> "StreamingConfig":
        return cls(
            kafka_bootstrap_servers=_env("KAFKA_BOOTSTRAP_SERVERS", cls.kafka_bootstrap_servers),
            market_topic=_env("MARKET_TOPIC", cls.market_topic),
            trades_topic=_env("TRADES_TOPIC", cls.trades_topic),
            user_actions_topic=_env("USER_ACTIONS_TOPIC", cls.user_actions_topic),
            portfolio_topic=_env("PORTFOLIO_TOPIC", cls.portfolio_topic),
            starting_offsets=_env("STARTING_OFFSETS", cls.starting_offsets),
            max_offsets_per_trigger=_env_int("MAX_OFFSETS_PER_TRIGGER", None),
            watermark_delay=_env("WATERMARK_DELAY", cls.watermark_delay),
            max_future_skew_seconds=_env_int("MAX_FUTURE_SKEW_SECONDS", cls.max_future_skew_seconds),
            known_asset_symbols=_env_list("KNOWN_ASSET_SYMBOLS"),
            trigger_interval=_env("TRIGGER_INTERVAL", cls.trigger_interval),
            checkpoint_root=_env("CHECKPOINT_ROOT", cls.checkpoint_root),
            curated_root=_env("CURATED_ROOT", cls.curated_root),
            diagnostics_root=_env("DIAGNOSTICS_ROOT", cls.diagnostics_root),
            mongo_uri=_env("MONGO_URI", cls.mongo_uri),
            mongo_database=_env("MONGO_DATABASE", cls.mongo_database),
            run_id=_env("RUN_ID", cls.run_id),
            sink_mode=_env("SINK_MODE", cls.sink_mode),
            overtrading_trades_per_window=_env_int(
                "OVERTRADING_TRADES_PER_WINDOW", cls.overtrading_trades_per_window
            ),
            shuffle_partitions=_env_int("SPARK_SHUFFLE_PARTITIONS", cls.shuffle_partitions),
        )

    @property
    def watermark_seconds(self) -> int:
        return duration_seconds(self.watermark_delay)

    def checkpoint(self, query_name: str) -> str:
        """Each query gets its own checkpoint directory; never share them."""
        return f"{self.checkpoint_root.rstrip('/')}/{self.run_id}/{query_name}"

    def diagnostics(self, kind: str) -> str:
        return f"{self.diagnostics_root.rstrip('/')}/{kind}"


def build_spark_session(app_name: str, cfg: StreamingConfig, *, with_kafka: bool = True, master: str | None = None):
    """Create the SparkSession used by every speed-layer job.

    The session time zone is pinned to UTC because serving keys and window
    boundaries are rendered with ``date_format``; a local time zone would
    change the keys.
    """
    from pyspark.sql import SparkSession

    os.environ.setdefault("PYSPARK_PYTHON", sys.executable)
    builder = (
        SparkSession.builder.appName(app_name)
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", str(cfg.shuffle_partitions))
        .config("spark.sql.streaming.metricsEnabled", "true")
    )
    if master:
        builder = builder.master(master)
    packages = []
    if with_kafka:
        packages.append(KAFKA_PACKAGE)
    if any(root.startswith("s3a://") for root in (cfg.checkpoint_root, cfg.curated_root, cfg.diagnostics_root)):
        packages.append(HADOOP_AWS_PACKAGE)
    if packages:
        builder = builder.config("spark.jars.packages", ",".join(packages))
    for key, value in cfg.extra_spark_conf.items():
        builder = builder.config(key, value)
    return builder.getOrCreate()
