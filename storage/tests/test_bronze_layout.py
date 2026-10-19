from __future__ import annotations

import json
from pathlib import Path

import pyarrow.dataset as ds
import pyarrow.parquet as pq
import pytest

from ingestion.producers.market_producer import EventContract, MemoryPublisher
from storage.jobs.bronze_writer import BronzeWriter, KafkaMetadata
from storage.jobs.replay import replay_local_bronze


ROOT = Path(__file__).resolve().parents[2]


def load_fixture(name: str):
    with (ROOT / "data-contracts" / "fixtures" / name).open(encoding="utf-8") as stream:
        return json.load(stream)


@pytest.fixture
def contract() -> EventContract:
    return EventContract.from_file(
        ROOT / "data-contracts" / "events.schema.json", known_symbols={"AAPL"}
    )


def test_bronze_writes_hive_partitioned_snappy_parquet(tmp_path: Path, contract) -> None:
    base = tmp_path / "fin-sight"
    counters = BronzeWriter(str(base), contract).write_run(
        [load_fixture("valid-market-quote.json")],
        run_id="test-run-001",
        kafka_metadata=[KafkaMetadata("market-quotes", 1, 42)],
    )

    parquet_files = list((base / "bronze").glob("event_type=*/event_date=*/*.parquet"))
    assert len(parquet_files) == 1
    assert "event_type=market_quote" in str(parquet_files[0])
    assert "event_date=2026-10-15" in str(parquet_files[0])
    metadata = pq.ParquetFile(parquet_files[0]).metadata
    assert metadata.row_group(0).column(0).compression == "SNAPPY"
    assert counters.accepted == 1
    assert counters.received == 1

    dataset = ds.dataset(base / "bronze", format="parquet", partitioning="hive")
    table = dataset.to_table(filter=ds.field("event_type") == "market_quote")
    assert table.num_rows == 1
    assert table.column("source_offset").to_pylist() == [42]


def test_bronze_counts_duplicates_and_invalid_records(tmp_path: Path, contract) -> None:
    valid = load_fixture("valid-market-quote.json")
    invalid = load_fixture("invalid-missing-event-id.json")
    counters = BronzeWriter(str(tmp_path), contract).write_run(
        [valid, valid, invalid], run_id="quality-run"
    )
    assert counters.received == 3
    assert counters.accepted == 1
    assert counters.duplicate == 1
    assert counters.rejected == 2
    assert counters.null_required == 1
    assert counters.by_source["yahoo"] == {
        "received": 3,
        "accepted": 1,
        "duplicate": 1,
        "rejected": 2,
        "null_required": 1,
    }

    quality = json.loads((tmp_path / "bronze" / "_runs" / "quality-run.json").read_text())
    assert quality["counters"]["accepted"] == 1
    assert quality["counters"]["by_source"]["yahoo"]["rejected"] == 2


def test_bronze_run_is_immutable(tmp_path: Path, contract) -> None:
    writer = BronzeWriter(str(tmp_path), contract)
    writer.write_run([load_fixture("valid-market-quote.json")], run_id="immutable-run")
    with pytest.raises(FileExistsError, match="already exists"):
        writer.write_run([load_fixture("valid-market-quote.json")], run_id="immutable-run")


def test_distinct_runs_append_without_overwriting(tmp_path: Path, contract) -> None:
    writer = BronzeWriter(str(tmp_path), contract)
    event = load_fixture("valid-market-quote.json")
    writer.write_run([event], run_id="append-run-001")
    writer.write_run([event], run_id="append-run-002")
    parquet_files = list((tmp_path / "bronze").glob("event_type=*/event_date=*/*.parquet"))
    assert {path.name for path in parquet_files} == {
        "run-append-run-001-0.parquet",
        "run-append-run-002-0.parquet",
    }


def test_replay_preserves_original_event_id(tmp_path: Path, contract) -> None:
    event = load_fixture("valid-market-quote.json")
    BronzeWriter(str(tmp_path), contract).write_run([event], run_id="replay-run")
    publisher = MemoryPublisher()
    count = replay_local_bronze(tmp_path / "bronze", publisher)
    assert count == 1
    assert publisher.records[0].value["event_id"] == event["event_id"]
    assert publisher.records[0].topic == "market-quotes"
