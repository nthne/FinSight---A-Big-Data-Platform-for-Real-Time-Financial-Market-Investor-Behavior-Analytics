from __future__ import annotations

import json
from datetime import datetime

from pyspark.sql.types import (
    IntegerType,
    LongType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

from spark.tests.events import action, at, portfolio, quote, trade, USER1, user

BRONZE_SPARK_SCHEMA = StructType(
    [
        StructField("event_id", StringType()),
        StructField("event_type", StringType()),
        StructField("schema_version", StringType()),
        StructField("source", StringType()),
        StructField("event_time", TimestampType()),
        StructField("ingestion_time", TimestampType()),
        StructField("asset_symbol", StringType()),
        StructField("user_id", StringType()),
        StructField("payload_json", StringType()),
        StructField("raw_event_json", StringType()),
        StructField("bronze_ingested_at", TimestampType()),
        StructField("pipeline_run_id", StringType()),
        StructField("source_topic", StringType()),
        StructField("source_partition", IntegerType()),
        StructField("source_offset", LongType()),
        StructField("event_date", StringType()),
    ]
)


def bronze_frame(spark, events):
    rows = []
    for index, event in enumerate(events):
        raw_event = {
            key: value
            for key, value in event.items()
            if not key.startswith("_bronze_")
        }
        rows.append(
            {
                "event_id": event.get("event_id"),
                "event_type": event.get("event_type"),
                "schema_version": event.get("schema_version"),
                "source": event.get("source"),
                "event_time": datetime.fromisoformat(event["event_time"].replace("Z", "+00:00")),
                "ingestion_time": datetime.fromisoformat(
                    event["ingestion_time"].replace("Z", "+00:00")
                ),
                "asset_symbol": event.get("asset_symbol"),
                "user_id": event.get("user_id"),
                "payload_json": json.dumps(event.get("payload", {})),
                "raw_event_json": json.dumps(raw_event),
                "bronze_ingested_at": datetime.fromisoformat(
                    event["ingestion_time"].replace("Z", "+00:00")
                ),
                "pipeline_run_id": "batch-fixture",
                "source_topic": "fixture",
                "source_partition": 0,
                "source_offset": index,
                "event_date": event.get("_bronze_event_date", event["event_time"][:10]),
            }
        )
    return spark.createDataFrame(rows, schema=BRONZE_SPARK_SCHEMA)


def market_events():
    return [
        quote(f"batch-q{i}", "aapl", at(0, i * 10), price, volume=volume)
        for i, (price, volume) in enumerate(((100.0, 100.0), (102.0, 130.0), (101.0, 180.0)))
    ]


def portfolio_events():
    second_user = user("batch-user-2")
    events = [
        trade("batch-t1", USER1, "AAPL", at(0, 1), "buy", 2, 100.0, fee=1.0),
        trade("batch-t2", USER1, "MSFT", at(0, 2), "sell", 1, 200.0),
        action("batch-a1", USER1, at(0, 3)),
        portfolio("batch-p1", USER1, at(0, 4), total_value=1000.0, cash_balance=300.0),
        portfolio("batch-p2", USER1, at(0, 5), total_value=800.0, cash_balance=200.0),
        trade("batch-t3", second_user, "AAPL", at(0, 6), "buy", 1, 100.0),
        portfolio("batch-p3", second_user, at(0, 7), total_value=1200.0, cash_balance=600.0),
    ]
    return events
