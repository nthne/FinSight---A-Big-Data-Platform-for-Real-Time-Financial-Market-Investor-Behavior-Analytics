# Evidence: Streaming Semantics (Task 6)

**Owner:** Person C · **Status:** functional tests pass on file-source fixtures; not yet run against Kafka.
These are correctness results from a local single-node run. They are not throughput or latency measurements.

## Environment of the recorded run (2026-10-19)

| Item | Value |
| --- | --- |
| OS | Ubuntu 24.04 on WSL2 (Windows 11 host, 15.6 GB RAM) |
| Java | Eclipse Temurin 21.0.12.1 (JRE) |
| Spark | PySpark 4.0.4, `local[2]`, driver memory 512 MB, session time zone UTC |
| MongoDB | 8.0.32, single node, WiredTiger cache 0.25 GB |
| Command | `FINSIGHT_TEST_MONGO_URI=mongodb://127.0.0.1:27018 python -m pytest serving/tests spark/tests -v` |
| Result | `37 passed in 128.53s` (18 serving tests, 19 Spark tests) |

## Fixture

`spark/tests/events.py` writes one JSON-lines file per micro-batch (`maxFilesPerTrigger=1`), so batch boundaries are deterministic. Watermark delay is 10 minutes. Every fixture event is a valid event of Person A's contract `1.0.0` (UUID ids, `usr_` user ids, `close_price`), checked by `spark/tests/test_contract_alignment.py`.

| Batch | Events |
| --- | --- |
| 0 | q1 AAPL 10:00:05 · q2 AAPL 10:00:30 · q3 MSFT 10:00:10 · q3 again (duplicate inside the batch) · one malformed line |
| 1 | q4 AAPL 10:00:50 · q2 again (duplicate across batches) · q5 AAPL 10:12:00 |
| 2 | q8 AAPL 10:12:30 (on time) |
| 3 | q6 AAPL 10:01:30 (too late) · q7 AAPL 10:05:00 (accepted late, out of order) |

## Requirement → test → observed result

| Requirement | Test (`spark/tests/test_streaming_semantics.py`) | Observed |
| --- | --- | --- |
| Validation and dead-letter codes | `test_validation_assigns_one_error_code_per_rule` | All 21 error codes produced, one per rule; valid events of all four types pass |
| Contract alignment | `test_contract_alignment.py` | Test fixtures pass the JSON Schema; contract fixtures: valid quote accepted, missing ID → `MISSING_EVENT_ID`, bad timestamp → `INVALID_EVENT_TIME`, unknown symbol → `UNKNOWN_SYMBOL`, duplicate ID accepted per event and removed by the window dedup |
| Event-time windows + dedup | `test_market_1m_dedups_and_applies_watermark` | AAPL [10:00, 10:01) = 3 quotes, OHLC 100/102/100/101, volume 1500 (last cumulative value, not the sum); both duplicates removed |
| Watermark drops too-late data | same | No window for q6; Spark reports `numRowsDroppedByWatermark = 1` |
| Out-of-order data within watermark | same | q7 creates AAPL [10:05, 10:06) |
| Stale quote never replaces current | same | `latest_market_metrics.AAPL` stays 111 @ 10:12:30; sink reports `stale_skipped = 1` |
| Sliding windows | `test_rolling_5m_window_matches_reference` | Moving average and sample stddev equal the Python reference; q1 appears in the five windows starting 09:56–10:00 |
| Update vs append mode | `test_update_mode_emits_changes_and_append_mode_emits_final_windows` | Update emits AAPL 10:00 twice (2, then 3); append emits it once (3) after the watermark passes 10:01 |
| Complete mode | `test_complete_mode_re_emits_every_key` | The last batch re-emits `trade_executed` although it contained no trade |
| Dead-letter and too-late outputs | `test_event_gate_routes_invalid_and_too_late_events` | Batch 0: 1 `MALFORMED_JSON` in `dead_letter/run=test/batch=0`. Batch 3: `too_late = 1` (q6), `accepted_late = 1` (q7), late watermark 10:02 |
| Curated landing | `test_curated_events_are_parquet_partitioned` | 10 valid events in Parquet, partition `event_type=market_quote/event_date=2026-10-05` |
| Behaviour windows and sessions | `test_user_activity_windows_and_sessions` | 5-minute window: 3 executed trades (2 buy, 1 sell), turnover 610, cancelled order ignored; sessions [10:00, 10:18) with 4 events and [10:40, 10:55) with 1 event |

## Finding: Spark drops late rows against the previous batch's watermark

In the first version of the fixture q6 (10:01:30) arrived in the batch right after q5 (10:12:00). The recorded progress was:

| Batch | Input rows | Reported watermark | Max event time | Rows dropped by watermark |
| --- | --- | --- | --- | --- |
| 0 | 5 | 1970-01-01T00:00:00Z | 10:00:30 | 0 |
| 1 | 3 | 09:50:30 | 10:12:00 | 0 |
| 2 | 2 | 10:02:00 | 10:05:00 | 0 |

Batch 2 reports a watermark of 10:02, yet q6 (10:01:30) was aggregated into window [10:01, 10:02). Since Spark 3.4 (SPARK-40925), a stateful query evicts state with the current watermark but filters input rows with the **previous** batch's watermark (09:50:30 here). Consequences:

1. Whether a too-late event is dropped depends on micro-batch boundaries. A restart inserts a no-data batch, so the same input can produce a different speed-layer result. This was observed: the restart test differed from the uninterrupted run until the fixture gained batch 2.
2. The event gate classifies against the same lagged watermark (`spark/lib/lateness.py`). `test_gate_and_aggregation_agree_when_spark_keeps_a_row_behind_its_watermark` reproduces the case above: Spark keeps q6 and the gate labels it `accepted_late`.
3. This is why the speed layer is provisional and the batch layer, which reads every event from bronze, is authoritative (`serving/lambda_reconciliation.py`).

## Not covered yet

- Kafka source (`spark/lib/streaming_sources.kafka_source`) against a real broker, consumer lag and `maxOffsetsPerTrigger`.
- S3A checkpoints and outputs on MinIO.
- Event rates, end-to-end latency and state size under the 1-million-event replay (Task 11).
