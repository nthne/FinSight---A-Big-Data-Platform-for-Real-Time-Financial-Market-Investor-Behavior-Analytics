from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from ingestion.producers.market_producer import EventContract
from storage.jobs.bronze_writer import BronzeWriter, KafkaMetadata


DEFAULT_TOPICS = ["market-quotes", "trades", "user-actions", "portfolio-snapshots"]


def consume_bounded(max_records: int, timeout_seconds: float):
    try:
        from confluent_kafka import Consumer, KafkaError
    except ImportError as error:
        raise RuntimeError("Install ingestion/requirements.txt for Kafka consumption") from error

    bootstrap = os.environ.get("KAFKA_BOOTSTRAP_SERVERS")
    if not bootstrap:
        raise RuntimeError("KAFKA_BOOTSTRAP_SERVERS is required")
    consumer = Consumer(
        {
            "bootstrap.servers": bootstrap,
            "group.id": os.environ.get("BRONZE_CONSUMER_GROUP", "finsight-bronze-v1"),
            "auto.offset.reset": "earliest",
            "enable.auto.commit": False,
            "isolation.level": "read_committed",
        }
    )
    consumer.subscribe(os.environ.get("BRONZE_TOPICS", ",".join(DEFAULT_TOPICS)).split(","))
    events: list[dict[str, Any]] = []
    metadata: list[KafkaMetadata] = []
    try:
        while len(events) < max_records:
            message = consumer.poll(timeout_seconds)
            if message is None:
                break
            if message.error():
                if message.error().code() == KafkaError._PARTITION_EOF:
                    continue
                raise RuntimeError(str(message.error()))
            events.append(json.loads(message.value().decode("utf-8")))
            metadata.append(
                KafkaMetadata(
                    topic=message.topic(), partition=message.partition(), offset=message.offset()
                )
            )
    except BaseException:
        consumer.close()
        raise
    return events, metadata, consumer


def write_and_commit(events, metadata, consumer, writer: BronzeWriter, *, run_id: str):
    try:
        counters = writer.write_run(events, run_id=run_id, kafka_metadata=metadata)
        if events:
            consumer.commit(asynchronous=False)
        return counters
    finally:
        consumer.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Land a bounded Kafka micro-batch in Bronze")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--base-uri", default=os.environ.get("BRONZE_BASE_URI", "s3://fin-sight"))
    parser.add_argument("--max-records", type=int, default=10000)
    parser.add_argument("--poll-timeout", type=float, default=5.0)
    args = parser.parse_args()

    schema_path = Path(__file__).resolve().parents[2] / "data-contracts" / "events.schema.json"
    known = {
        item.strip().upper()
        for item in os.environ.get("KNOWN_ASSET_SYMBOLS", "").split(",")
        if item.strip()
    }
    contract = EventContract.from_file(schema_path, known_symbols=known)
    events, metadata, consumer = consume_bounded(args.max_records, args.poll_timeout)
    counters = write_and_commit(
        events,
        metadata,
        consumer,
        BronzeWriter(args.base_uri, contract),
        run_id=args.run_id,
    )
    print(json.dumps(counters.__dict__, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
