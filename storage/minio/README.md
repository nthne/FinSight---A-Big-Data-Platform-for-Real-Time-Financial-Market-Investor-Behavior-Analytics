# FinSight object storage

The `fin-sight` bucket is divided into immutable analytical zones:

- `bronze/event_type=<type>/event_date=<yyyy-mm-dd>/` stores validated source envelopes in Snappy Parquet.
- `bronze/_runs/<run_id>.json` stores reconciliation and quality counts. A run ID is immutable and cannot be reused.
- `silver/` is reserved for normalized Spark outputs owned by the batch workstream.
- `gold/` is reserved for aggregates and serving-ready history.

Bronze retains the original JSON envelope in `raw_event_json`, plus typed timestamps, Kafka topic/partition/offset, the pipeline run ID and landing time. Partition columns intentionally have bounded cardinality. Do not partition by symbol or user.

## Lifecycle policy

- Bronze: retain for the duration required by the course evidence and provider licence; archive before deletion.
- Silver: compact small files after batch runs and retain reproducible inputs for submitted experiments.
- Gold: retain versioned analytical outputs while referenced by a report or serving run.
- `_runs`: retain longer than their data files so deletion and reconciliation remain auditable.

No automated deletion is enabled until a human owner confirms provider licensing and university retention requirements.

## Credentials

Local code reads `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` and `MINIO_BUCKET`. Kubernetes injects the credentials from a Secret. Never commit real values. Spark receives `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` through the same boundary and uses `spark-defaults.conf` for path-style S3A access.

## Local verification

```powershell
python -m pytest storage/tests/test_bronze_layout.py -v
```

The tests write real Parquet files, assert Snappy compression, evaluate a partition predicate, verify Kafka offset metadata, reject duplicate run IDs and replay the original event ID.
