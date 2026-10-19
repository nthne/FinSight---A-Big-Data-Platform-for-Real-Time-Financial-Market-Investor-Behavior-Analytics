# Streaming and Serving (Person C)

Speed layer (Spark Structured Streaming), idempotent MongoDB serving views,
Lambda reconciliation and the analytics API contract for the FinSight Big
Data milestone (plan Tasks 6, 7 and the API half of Task 9).

## Layout

```text
spark/lib/streaming_config.py     settings from env vars, window specs, SparkSession builder
spark/lib/envelope.py             event envelope parsing + validation (error codes)
spark/lib/lateness.py             watermark / late-event policy (mirrors Spark's rule)
spark/lib/streaming_sources.py    Kafka source; JSON-lines file source for tests and replays
spark/lib/progress_listener.py    StreamingQueryProgress -> pipeline_quality_metrics
spark/jobs/streaming/
  market_stream.py                market_1m (OHLC), market_5m_rolling (moving avg, volatility)
  behavior_stream.py              user_activity_5m (update mode), user_sessions (append mode)
  event_gate.py                   dead-letter, late-event diagnostics, quality counters,
                                  curated Parquet sink, complete-mode demo
  common.py                       foreachBatch writer, query start-up, run loop
serving/
  keys.py                         deterministic serving keys + user pseudonymization
  mongo_sink.py                   idempotent / guarded MongoDB upserts
  lambda_reconciliation.py        batch cutoff rule (batch replaces speed)
  mongo_schema.json               collections, validators, indexes (single source)
  mongo_setup.py, mongo_schema.js apply the schema (Python / mongosh)
  api_contract.md                 serving collections + HTTP API contract
spark/tests, serving/tests        pytest suites (see "Tests")
docs/evidence/                    streaming-semantics.md, recovery-test.md
```

## Streaming queries

| Job (`python -m ...`) | Query | Mode | Output |
| --- | --- | --- | --- |
| `spark.jobs.streaming.market_stream` | `market_1m` | update | `asset_time_series_summary` (speed), `latest_market_metrics` (guarded) |
| | `market_5m_rolling` | update | `asset_time_series_summary` (speed) |
| `spark.jobs.streaming.behavior_stream` | `user_activity_5m` | update | `user_activity_windows` (speed) |
| | `user_sessions` | append | `user_sessions` |
| `spark.jobs.streaming.event_gate` | `event_gate` | append, foreachBatch | dead-letter + too-late Parquet, gate counters |
| | `curated_events` | append, file sink | Parquet/Snappy partitioned by `event_type`, `event_date` |
| | `event_type_totals` | complete (demo) | running totals per event type |

Each job takes `--queries a,b` to run a subset. Every query has its own
checkpoint under `CHECKPOINT_ROOT/RUN_ID/<query>`.

Semantics in short:

- **Watermark:** 10 minutes on `event_time` (`WATERMARK_DELAY`). Duplicates are removed with `dropDuplicatesWithinWatermark(event_id)`.
- **Late events:** Spark drops rows older than the *previous* micro-batch's watermark. The event gate reproduces that rule, writes too-late events to `DIAGNOSTICS_ROOT/too_late/` and counts on-time / accepted-late / too-late per batch. The batch layer later includes them from bronze.
- **Effectively exactly-once:** Kafka offsets and state are checkpointed, and every MongoDB write is an upsert on a deterministic `_id` that `$set`s complete aggregate values. A retried or replayed micro-batch rewrites identical documents. `pipeline_quality_metrics` records `attempts` per batch as evidence.
- **No stale overwrite:** `latest_market_metrics` only accepts a quote whose `last_event_time` is not older than the stored one.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `KAFKA_BOOTSTRAP_SERVERS` | `kafka:9092` | |
| `MARKET_TOPIC`, `TRADES_TOPIC`, `USER_ACTIONS_TOPIC`, `PORTFOLIO_TOPIC` | `market-quotes`, `trades`, `user-actions`, `portfolio-snapshots` | Person A's topic names |
| `STARTING_OFFSETS` | `latest` | `earliest` for replays |
| `MAX_OFFSETS_PER_TRIGGER` | unset | rate limit per micro-batch |
| `WATERMARK_DELAY` | `10 minutes` | |
| `MAX_FUTURE_SKEW_SECONDS` | `300` | |
| `KNOWN_ASSET_SYMBOLS` | unset | same comma list as the gateway ConfigMap; enables `UNKNOWN_SYMBOL` |
| `TRIGGER_INTERVAL` | `10 seconds` | |
| `CHECKPOINT_ROOT` | `s3a://fin-sight/checkpoints/speed` | persistent storage required |
| `CURATED_ROOT` | `s3a://fin-sight/silver/speed` | |
| `DIAGNOSTICS_ROOT` | `s3a://fin-sight/diagnostics` | |
| `MONGO_URI` (Secret), `MONGO_DATABASE` | `mongodb://mongodb:27017`, `finsight` | |
| `RUN_ID` | `speed-default` | change it whenever checkpoints are reset |
| `SINK_MODE` | `executor` | `driver` collects each batch first |
| `OVERTRADING_TRADES_PER_WINDOW` | `10` | |

S3A endpoint/credential settings for MinIO come from Person A's
`storage/minio/spark-defaults.conf` (set `SPARK_CONF_DIR=storage/minio`).
It uses `EnvironmentVariableCredentialsProvider`, so the streaming pods need
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (mapped from the MinIO
Secret), not `MINIO_ACCESS_KEY`. The session builder only adds the
`hadoop-aws` package when a path starts with `s3a://`.

Events follow Person A's contract `data-contracts/events.schema.json`
(`1.0.0`); see `api_contract.md` section 5 for what the speed layer checks.

## Tests

Requirements: Linux or WSL (Spark's local file system needs Hadoop native
libraries on Windows), Java 17 or 21, Python 3.12, a MongoDB server.

```bash
pip install -r serving/requirements-dev.txt
python -m serving.mongo_setup --uri mongodb://127.0.0.1:27017   # optional, tests apply it themselves
FINSIGHT_TEST_MONGO_URI=mongodb://127.0.0.1:27017 python -m pytest serving/tests spark/tests -v
```

Without `FINSIGHT_TEST_MONGO_URI` the MongoDB tests are skipped. Each test
uses its own database and drops it afterwards. `FINSIGHT_TEST_SPARK_MEMORY`
(default `768m`) limits the local driver JVM.

## Status

| Item | State |
| --- | --- |
| Envelope validation, windows, watermark, dedup, output modes | implemented, tested with file sources |
| Alignment with event contract 1.0.0 | fixtures validated against the JSON Schema; contract fixtures classified like the gateway |
| Late-event classification + diagnostics | implemented, tested |
| Idempotent sink, restart / replay / crash-retry | implemented, tested against MongoDB 8.0 |
| Lambda reconciliation rule | implemented, tested |
| Kafka source | implemented, **not yet run against a broker** (Person A's Kafka 4.3.1 compose/K8s profile is now available) |
| S3A checkpoints and outputs | configured, **not yet run against MinIO** |
| HTTP routes `/api/analytics/*` | contract only (`api_contract.md`) |
| Container image and Kubernetes manifests for the streaming jobs | to do with Person D |
| Lessons 3, 5, 11 | to do (Week 5) |
