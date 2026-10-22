"""Run several speed-layer jobs in one SparkSession (one driver JVM).

The three jobs (``event_gate``, ``market_stream``, ``behavior_stream``) can run
as separate processes/pods, which isolates failures. On a small machine or a
single-node demo one driver is cheaper; every query still has its own
checkpoint, so the two layouts are interchangeable without resetting state.

Run: ``python -m spark.jobs.streaming.speed_layer [--jobs gate,market,behavior]``
"""

from __future__ import annotations

import argparse
import logging

from spark.jobs.streaming import behavior_stream, event_gate, market_stream
from spark.jobs.streaming.common import SinkTarget, attach_progress_listener, await_queries
from spark.lib.streaming_config import StreamingConfig, build_spark_session
from spark.lib.streaming_sources import kafka_source

JOBS = ("gate", "market", "behavior")


def start_jobs(spark, cfg: StreamingConfig, target: SinkTarget, jobs) -> list:
    queries = []
    if "gate" in jobs:
        topics = [cfg.market_topic, cfg.trades_topic, cfg.user_actions_topic, cfg.portfolio_topic]
        queries += event_gate.start_gate_queries(kafka_source(spark, cfg, topics), cfg, target, event_gate.QUERIES)
    if "market" in jobs:
        raw = kafka_source(spark, cfg, [cfg.market_topic])
        queries += market_stream.start_market_queries(raw, cfg, target, list(market_stream.QUERIES))
    if "behavior" in jobs:
        raw = kafka_source(spark, cfg, [cfg.trades_topic, cfg.user_actions_topic])
        queries += behavior_stream.start_behavior_queries(raw, cfg, target, behavior_stream.QUERIES)
    return queries


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--jobs", default=",".join(JOBS), help=f"comma-separated subset of {list(JOBS)}")
    args = parser.parse_args(argv)
    jobs = [j.strip() for j in args.jobs.split(",") if j.strip()]
    unknown = set(jobs) - set(JOBS)
    if unknown:
        parser.error(f"unknown jobs: {sorted(unknown)}")

    logging.basicConfig(level=logging.INFO)
    cfg = StreamingConfig.from_env()
    spark = build_spark_session("finsight-speed-layer", cfg)
    target = SinkTarget(cfg)
    attach_progress_listener(spark, target)
    await_queries(spark, start_jobs(spark, cfg, target, jobs))


if __name__ == "__main__":
    main()
