from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.dataset as ds
import pyarrow.fs as fs

from ingestion.producers.market_producer import EventContract, EventValidationError
from storage.schemas.bronze_schema import BRONZE_SCHEMA, PARTITION_COLUMNS


RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


@dataclass
class QualityCounters:
    received: int = 0
    accepted: int = 0
    rejected: int = 0
    duplicate: int = 0
    null_required: int = 0
    unknown_symbol: int = 0


@dataclass(frozen=True)
class KafkaMetadata:
    topic: str
    partition: int | None = None
    offset: int | None = None


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _filesystem_for_uri(uri: str) -> tuple[fs.FileSystem, str]:
    if uri.startswith("s3://"):
        endpoint = os.environ.get("MINIO_ENDPOINT", "http://localhost:9000")
        scheme, endpoint_host = endpoint.split("://", 1)
        filesystem = fs.S3FileSystem(
            access_key=os.environ.get("MINIO_ACCESS_KEY"),
            secret_key=os.environ.get("MINIO_SECRET_KEY"),
            endpoint_override=endpoint_host,
            scheme=scheme,
            region=os.environ.get("MINIO_REGION", "us-east-1"),
            force_virtual_addressing=False,
            allow_bucket_creation=True,
        )
        return filesystem, uri.removeprefix("s3://").rstrip("/")
    local_path = str(Path(uri).resolve())
    return fs.LocalFileSystem(), local_path


class BronzeWriter:
    def __init__(self, base_uri: str, contract: EventContract) -> None:
        self._filesystem, self._base_path = _filesystem_for_uri(base_uri)
        self._contract = contract

    def _run_metadata_path(self, run_id: str) -> str:
        return f"{self._base_path}/bronze/_runs/{run_id}.json"

    def _ensure_new_run(self, run_id: str) -> None:
        if not RUN_ID_PATTERN.fullmatch(run_id):
            raise ValueError("run_id must contain only letters, numbers, dot, underscore or dash")
        info = self._filesystem.get_file_info(self._run_metadata_path(run_id))
        if info.type != fs.FileType.NotFound:
            raise FileExistsError(f"Bronze run already exists: {run_id}")

    def write_run(
        self,
        events: list[dict[str, Any]],
        *,
        run_id: str,
        kafka_metadata: list[KafkaMetadata] | None = None,
    ) -> QualityCounters:
        self._ensure_new_run(run_id)
        if kafka_metadata is not None and len(kafka_metadata) != len(events):
            raise ValueError("kafka_metadata must align one-to-one with events")

        counters = QualityCounters(received=len(events))
        rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        accepted_at = datetime.now(UTC)

        for index, event in enumerate(events):
            event_id = event.get("event_id")
            if event_id in seen:
                counters.duplicate += 1
                counters.rejected += 1
                continue
            if event_id is not None:
                seen.add(str(event_id))
            try:
                self._contract.validate(event)
            except EventValidationError as error:
                counters.rejected += 1
                if error.code == "UNKNOWN_SYMBOL":
                    counters.unknown_symbol += 1
                if "required property" in str(error):
                    counters.null_required += 1
                continue

            metadata = (
                kafka_metadata[index]
                if kafka_metadata is not None
                else KafkaMetadata(topic="fixture")
            )
            event_time = _parse_timestamp(str(event["event_time"]))
            rows.append(
                {
                    "event_id": str(event["event_id"]),
                    "event_type": str(event["event_type"]),
                    "schema_version": str(event["schema_version"]),
                    "source": str(event["source"]),
                    "event_time": event_time,
                    "ingestion_time": _parse_timestamp(str(event["ingestion_time"])),
                    "asset_symbol": event.get("asset_symbol"),
                    "user_id": event.get("user_id"),
                    "payload_json": json.dumps(event["payload"], separators=(",", ":"), sort_keys=True),
                    "raw_event_json": json.dumps(event, separators=(",", ":"), sort_keys=True),
                    "bronze_ingested_at": accepted_at,
                    "pipeline_run_id": run_id,
                    "source_topic": metadata.topic,
                    "source_partition": metadata.partition,
                    "source_offset": metadata.offset,
                    "event_date": event_time.date().isoformat(),
                }
            )
            counters.accepted += 1

        if rows:
            table = pa.Table.from_pylist(rows, schema=BRONZE_SCHEMA)
            ds.write_dataset(
                table,
                base_dir=f"{self._base_path}/bronze",
                filesystem=self._filesystem,
                format="parquet",
                partitioning=PARTITION_COLUMNS,
                partitioning_flavor="hive",
                basename_template=f"run-{run_id}-{{i}}.parquet",
                file_options=ds.ParquetFileFormat().make_write_options(compression="snappy"),
                existing_data_behavior="error",
            )

        metadata_document = {
            "run_id": run_id,
            "completed_at": accepted_at.isoformat().replace("+00:00", "Z"),
            "counters": asdict(counters),
        }
        metadata_path = self._run_metadata_path(run_id)
        self._filesystem.create_dir(metadata_path.rsplit("/", 1)[0], recursive=True)
        with self._filesystem.open_output_stream(metadata_path) as stream:
            stream.write(json.dumps(metadata_document, indent=2, sort_keys=True).encode("utf-8"))
        return counters
