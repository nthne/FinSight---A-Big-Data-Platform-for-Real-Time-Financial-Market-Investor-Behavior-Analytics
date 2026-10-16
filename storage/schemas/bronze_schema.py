from __future__ import annotations

import pyarrow as pa


BRONZE_SCHEMA = pa.schema(
    [
        pa.field("event_id", pa.string(), nullable=False),
        pa.field("event_type", pa.string(), nullable=False),
        pa.field("schema_version", pa.string(), nullable=False),
        pa.field("source", pa.string(), nullable=False),
        pa.field("event_time", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("ingestion_time", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("asset_symbol", pa.string()),
        pa.field("user_id", pa.string()),
        pa.field("payload_json", pa.large_string(), nullable=False),
        pa.field("raw_event_json", pa.large_string(), nullable=False),
        pa.field("bronze_ingested_at", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("pipeline_run_id", pa.string(), nullable=False),
        pa.field("source_topic", pa.string(), nullable=False),
        pa.field("source_partition", pa.int32()),
        pa.field("source_offset", pa.int64()),
        pa.field("event_date", pa.string(), nullable=False),
    ]
)


PARTITION_COLUMNS = ["event_type", "event_date"]
