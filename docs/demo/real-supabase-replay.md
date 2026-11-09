# Real-data FinSight pipeline experiment

This path replays *stored provider-labeled market-price rows* from the team's Supabase project. It filters sources to `coingecko`, `yahoo`, `alpha_vantage`, `stooq`; **no synthetic events** are generated, and `simulated_index` is excluded.

The script reads `market_prices` using stable keyset pagination on `(timestamp, price_id)`, joins the cached `market_assets` catalog, builds contract-1.0.0 market_quote events with deterministic IDs, validates each event, and sends it through the existing ingestion gateway. A durable cursor tracks acknowledged rows and enables resume.

**Prerequisites:** Docker Desktop (with enough memory for Kafka, MinIO, MongoDB, and Spark), Supabase server-side read credentials, and a clean isolated Compose environment. Avoid using production ingestion/gateway secrets or deleting any existing persistent volumes.

## Setup

In repository root create a local untracked `.env` file (never commit credentials):

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SIDE_SECRET
REAL_REPLAY_LIMIT=5000
REAL_REPLAY_DAYS=30
REAL_REPLAY_RATE=25
REPLAY_UID=1000
REPLAY_GID=1000
```

On Linux, if different, set REPLAY_UID / REPLAY_GID to `id -u` / `id -g`. Ensure `evidence/real-market` exists and is writable by that UID. On PowerShell set `$env:COMPOSE_PROJECT_NAME="finsight-real-market"`; on bash use `export COMPOSE_PROJECT_NAME=finsight-real-market`. This isolates volume/checkpoint namespaces from earlier demo runs.

```bash
mkdir -p evidence/real-market
docker compose -f deploy/docker-compose.integration.yml -f deploy/docker-compose.streaming.yml -f deploy/docker-compose.real-data.yml up -d --build
docker compose -f deploy/docker-compose.integration.yml -f deploy/docker-compose.streaming.yml -f deploy/docker-compose.real-data.yml --profile real-data run --rm real-market-replay
```

The resulting report and checkpoint are stored in `evidence/real-market/real-market-report.json` and `real-market-state.json`. The default is at most **5,000** rows from the last 30 days, throttled at 25 gateway requests/sec. Increase `REAL_REPLAY_LIMIT` (e.g. 20000) and repeat to resume with another 20,000 events; use `REAL_REPLAY_DAYS=0` on the **initial** run to include all source history. Once a cursor file exists, its original date range is frozen and takes precedence.

**Check gateway and Kafka:** the report records gateway acknowledgments, not downstream Spark completion. Compare against Kafka topic offsets and broker/consumer lag.

**Land immutable Bronze:** `bronze-once` must run separately, with a unique run ID every time:

```bash
BRONZE_RUN_ID=real-01 BRONZE_MAX_RECORDS=10000 docker compose -f deploy/docker-compose.integration.yml -f deploy/docker-compose.streaming.yml -f deploy/docker-compose.real-data.yml --profile jobs run --rm bronze-once
```

Repeat with `BRONZE_RUN_ID=real-02`, etc., until Kafka has been consumed. Verify accepted/duplicate/rejected counters, Snappy Parquet objects and metadata in MinIO.

**Run Spark Batch (separately from the streaming application):**

```bash
docker compose -f deploy/docker-compose.integration.yml -f deploy/docker-compose.streaming.yml -f deploy/docker-compose.real-data.yml run --rm speed-layer python -m spark.jobs.batch.market_batch --input s3a://fin-sight/bronze --output s3a://fin-sight --run-id real-batch-01
```

Capture Silver accepted/rejected counts, Gold output paths, Spark physical plans and runtime. This command still requires an integration test on an equipped Docker host.

**Verify streaming:** inspect Spark query progress, source offsets, Kafka consumer lag, watermark, MongoDB `asset_time_series_summary` and `latest_market_metrics` collections. Do not equate the MongoDB aggregated-document count to source-event count.

**Important historical-replay behavior:** Old event timestamps may be dropped by a speed layer whose watermark has already advanced. Use a fresh isolated Kafka/Spark checkpoint and prevent live fresh-timestamp producers from interfering during the test. Full historical recomputation is expected through Bronze → Batch. The full Batch Gold → MongoDB publisher / Lambda cutoff integration has not yet been verified in the repository.

**Acceptance evidence:** Capture counts at Supabase, gateway/Kafka, Bronze, Spark streaming, Spark Batch, and MongoDB; a single HTTP 202 is not proof that an event passed every stage. Measure throughput and latency before claiming Big Data end-to-end performance.
