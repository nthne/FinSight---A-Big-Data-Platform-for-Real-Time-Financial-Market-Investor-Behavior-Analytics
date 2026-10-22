# Evidence: Checkpointing, Idempotent Sink and Recovery (Task 7)

**Owner:** Person C · **Status:** passing locally against MongoDB 8.0; Kubernetes pod-restart test pending (Task 10).
Environment and command are the same as in `streaming-semantics.md` (`37 passed in 128.53s`, 2026-10-19).

## Guarantee and its boundary

The speed layer gives an **effectively exactly-once serving view**:

- Spark checkpoints source offsets and operator state per query (`CHECKPOINT_ROOT/RUN_ID/<query>`).
- `foreachBatch` runs at least once per micro-batch; after a failure the same `batch_id` is re-run on the same offsets.
- Every MongoDB write is an upsert on a deterministic `_id` (`serving/keys.py`) that `$set`s complete aggregate values, never `$inc`. A re-run rewrites identical documents.

It is not a distributed transaction: between a crash and the retry, MongoDB can briefly hold values from the failed attempt, which are the same values the retry writes. Diagnostic Parquet written by the event gate is overwritten per `run=<RUN_ID>/batch=<id>`; the curated sink relies on Spark's file-sink commit log.

## Tests (`spark/tests/test_recovery_and_idempotency.py`)

Each test compares the final `asset_time_series_summary` and `latest_market_metrics` documents with those of one uninterrupted run, ignoring only execution metadata (`computed_at`, `first_computed_at`, `batch_id`, `query_name`, `run_id`, `data_freshness_seconds`).

| Scenario | How it is produced | Observed |
| --- | --- | --- |
| Restart from checkpoint | Run over batches 0–1, stop, add the files for batches 2–3, restart with the same checkpoint | Documents identical to the uninterrupted run |
| Replay of the same events | Second run with a new checkpoint over the same input into the same database (= replay from earliest offsets) | Documents identical, no new documents; repeated batches recorded with `attempts = 2` and `upserted = 0` |
| Crash after the write, before the commit | `foreachBatch` raises after writing batch 1; the query fails; restart | Batch 1 re-run (`attempts = 2` for `sink\|market_1m\|test\|1`); documents identical, no duplicates |

## Sink unit tests (`serving/tests/test_mongo_sink.py`)

| Behaviour | Observed |
| --- | --- |
| Same batch written twice | 2 upserts, then 2 matches; still 2 documents; `first_computed_at` kept |
| Update mode replaces the aggregate | Second write overwrites `close`, no extra document |
| Guarded upsert (`latest_market_metrics`) | An older quote is rejected (`stale_skipped = 1`); the same quote again is accepted |
| Batch metrics | `attempts` increments per execution of a batch id |

## Lambda reconciliation (`serving/tests/test_lambda_reconciliation.py`)

Overlapping batch and speed windows are served from exactly one layer: batch for `window_end <= cutoff`, speed after it. The MongoDB filter returns the same documents as the in-memory rule for four cutoffs, and an older batch run cannot move the cutoff backwards.

## Not covered yet

- Killing a streaming pod on Kubernetes and measuring recovery time (Task 10 step 5, with Person D).
- Kafka broker restart and `failOnDataLoss` behaviour when retention removed offsets.
- Corrupted or deleted checkpoint: the documented procedure is a new `RUN_ID` plus a replay from Kafka/bronze, after which reconciliation lets batch results take over.
