from __future__ import annotations

import argparse
import json
import os

import pyarrow.dataset as ds
import pyarrow.fs as fs
import pyarrow.parquet as pq

from storage.jobs.bronze_writer import _filesystem_for_uri


def verify(base_uri: str, expected_event_id: str | None = None) -> dict[str, object]:
    filesystem, base_path = _filesystem_for_uri(base_uri)
    bronze_path = f"{base_path}/bronze"
    files = filesystem.get_file_info(fs.FileSelector(bronze_path, recursive=True))
    parquet_paths = sorted(
        item.path for item in files if item.type == fs.FileType.File and item.path.endswith(".parquet")
    )
    if not parquet_paths:
        raise RuntimeError(f"No Parquet files found under {base_uri.rstrip('/')}/bronze")

    dataset = ds.dataset(bronze_path, filesystem=filesystem, format="parquet", partitioning="hive")
    table = dataset.to_table(columns=["event_id", "event_type", "event_date", "source_offset"])
    event_ids = set(table.column("event_id").to_pylist())
    if expected_event_id is not None and expected_event_id not in event_ids:
        raise RuntimeError(f"Expected event ID is absent from Bronze: {expected_event_id}")

    compression = {
        pq.ParquetFile(path, filesystem=filesystem).metadata.row_group(0).column(0).compression
        for path in parquet_paths
    }
    if compression != {"SNAPPY"}:
        raise RuntimeError(f"Unexpected Parquet compression: {sorted(compression)}")

    return {
        "base_uri": base_uri,
        "event_count": table.num_rows,
        "event_ids": sorted(event_ids),
        "parquet_files": parquet_paths,
        "compression": sorted(compression),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify Bronze objects and Parquet metadata")
    parser.add_argument("--base-uri", default=os.environ.get("BRONZE_BASE_URI", "s3://fin-sight"))
    parser.add_argument("--expected-event-id")
    args = parser.parse_args()
    print(json.dumps(verify(args.base_uri, args.expected_event_id), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
