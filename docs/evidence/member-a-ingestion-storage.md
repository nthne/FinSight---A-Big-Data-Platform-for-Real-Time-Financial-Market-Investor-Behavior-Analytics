# Member A ingestion and storage evidence

## Docker integration run

The local Compose profile was executed with Docker Desktop on 2026-10-16. The run used Kafka 4.3.1, the source-built pinned MinIO course image, the ingestion gateway and the storage initialization job.

Observed results:

1. Five topics were created: `market-quotes`, `trades`, `user-actions`, `portfolio-snapshots` and `dead-letter-events`.
2. `POST /v1/events` returned HTTP 202 and routed the event to `market-quotes` with key `AAPL`.
3. A bounded Kafka consumer wrote one accepted event to `s3://fin-sight/bronze/event_type=market_quote/event_date=2026-10-15/`.
4. Bronze verification found Snappy compression and preserved event ID `2111b428-f232-5322-99a2-7821d283a385`.
5. A second run appended a new Parquet file, counted one duplicate and one accepted event, and did not overwrite the first run.
6. The Kafka broker was restarted with its named volume. Topic initialization then reported all topics as `ready` without creating duplicates, and the gateway accepted a request after the restart.

The final rebuild smoke test on 2026-10-19 repeated the health/readiness checks, returned HTTP 202 for a valid event and HTTP 422 for the missing-event-ID fixture, then landed a Bronze batch with `accepted=1`, `duplicate=2`, `rejected=2`. Verification found three immutable Parquet run files, one stable event ID and Snappy compression.

The first append attempt exposed a PyArrow directory-mode issue. It failed before writing run metadata and before committing offsets. The corrected `overwrite_or_ignore` mode is safe here because every file name contains an immutable validated run ID and reusing a run ID is rejected.

## Guarantees

- Producer event IDs are deterministic across retries.
- Bronze run IDs are immutable.
- Kafka offsets commit only after a successful Bronze write.
- Duplicate and invalid records are counted by source and run; invalid records are not written to accepted Bronze rows.
- Replay publishes the original event envelope and event ID.
