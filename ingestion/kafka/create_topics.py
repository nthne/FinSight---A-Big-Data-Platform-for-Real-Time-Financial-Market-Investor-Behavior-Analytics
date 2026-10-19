from __future__ import annotations

import argparse
import os
from pathlib import Path

import yaml


def main() -> int:
    try:
        from confluent_kafka.admin import AdminClient, NewTopic
    except ImportError as error:
        raise RuntimeError("Install ingestion/requirements.txt to create Kafka topics") from error

    parser = argparse.ArgumentParser(description="Create or verify FinSight Kafka topics")
    parser.add_argument(
        "--config", type=Path, default=Path(__file__).with_name("topics.yaml")
    )
    args = parser.parse_args()
    with args.config.open(encoding="utf-8") as stream:
        spec = yaml.safe_load(stream)

    bootstrap = os.environ.get("KAFKA_BOOTSTRAP_SERVERS")
    if not bootstrap:
        raise RuntimeError("KAFKA_BOOTSTRAP_SERVERS is required")
    admin = AdminClient({"bootstrap.servers": bootstrap})
    existing = admin.list_topics(timeout=10).topics
    defaults = spec["defaults"]
    definitions = []
    for topic in spec["topics"]:
        if topic["name"] in existing:
            continue
        config = dict(defaults["config"])
        config["retention.ms"] = str(topic["retention_ms"])
        definitions.append(
            NewTopic(
                topic["name"],
                num_partitions=int(defaults["partitions"]),
                replication_factor=int(defaults["replication_factor"]),
                config=config,
            )
        )

    if definitions:
        for name, future in admin.create_topics(definitions).items():
            future.result(timeout=30)
            print(f"created {name}")
    for topic in spec["topics"]:
        print(f"ready {topic['name']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
