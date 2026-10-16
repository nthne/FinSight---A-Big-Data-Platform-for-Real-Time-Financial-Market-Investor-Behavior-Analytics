from __future__ import annotations

import argparse
import json
from pathlib import Path

import pyarrow.dataset as ds

from ingestion.producers.kafka_publisher import ConfluentKafkaPublisher


TOPICS_BY_EVENT_TYPE = {
    "market_quote": "market-quotes",
    "trade_executed": "trades",
    "user_action": "user-actions",
    "portfolio_snapshot": "portfolio-snapshots",
}


def replay_local_bronze(path: Path, publisher, *, run_id: str | None = None) -> int:
    dataset = ds.dataset(path, format="parquet", partitioning="hive")
    columns = [
        "event_id",
        "event_type",
        "asset_symbol",
        "user_id",
        "raw_event_json",
        "pipeline_run_id",
    ]
    table = dataset.to_table(columns=columns)
    published = 0
    for row in table.to_pylist():
        if run_id is not None and row["pipeline_run_id"] != run_id:
            continue
        event = json.loads(row["raw_event_json"])
        topic = TOPICS_BY_EVENT_TYPE[row["event_type"]]
        key = row["asset_symbol"] or row["user_id"] or event["source"]
        publisher.publish(topic, key, event)
        published += 1
    return published


def main() -> int:
    parser = argparse.ArgumentParser(description="Replay immutable Bronze events with original IDs")
    parser.add_argument("bronze_path", type=Path)
    args = parser.parse_args()
    count = replay_local_bronze(args.bronze_path, ConfluentKafkaPublisher.from_env())
    print(json.dumps({"replayed": count}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
