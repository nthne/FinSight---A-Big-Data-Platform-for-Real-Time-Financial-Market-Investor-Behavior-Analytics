# Evidence: Speed Layer on Kafka, MinIO and MongoDB (Person C)

**Owner:** Person C · **Status:** passing on the local Docker integration profile (2026-10-19). Kubernetes workload manifest and pod-kill test are still open.
These are correctness results from a single-node local run, not throughput or latency measurements.

## Environment

| Item | Value |
| --- | --- |
| Host | Windows 11, 15.6 GB RAM; Docker Desktop 4.46.0 (engine 28.4.0, WSL 2, 8 GB / 20 CPU visible to Docker) |
| Ingestion side (Person A, unchanged) | `deploy/docker-compose.integration.yml`: Kafka 4.3.1 KRaft (`apache/kafka@sha256:77e3df90…`), source-built MinIO `RELEASE.2025-10-15T17-29-55Z`, ingestion gateway, topic and bucket init jobs |
| Speed layer (Person C) | `deploy/docker-compose.streaming.yml`; image `finsight-streaming:dev` from `spark/jobs/streaming/Dockerfile` on `eclipse-temurin:21-jre-noble@sha256:35501d3f…` (OpenJDK 21.0.12.1), PySpark 4.0.4, `spark-sql-kafka-0-10_2.13:4.0.4`, `hadoop-aws:3.4.1` + AWS SDK bundle 2.24.6 resolved at build time |
| Serving store | `mongo:8.0.34` (`mongo@sha256:4a4ab5d4…`), local stand-in for the platform MongoDB, WiredTiger cache 0.25 GB |
| Spark | one driver for all seven queries (`python -m spark.jobs.streaming.speed_layer`), `local[*]`, driver memory 1 GB, 4 shuffle partitions, trigger 10 s, watermark 10 minutes |
| Storage | checkpoints `s3a://fin-sight/checkpoints/speed/compose-local/<query>`, curated Parquet `s3a://fin-sight/silver/speed`, diagnostics `s3a://fin-sight/diagnostics` (credentials via `storage/minio/spark-defaults.conf`) |

## Commands

```powershell
docker compose -f deploy/docker-compose.integration.yml -f deploy/docker-compose.streaming.yml up -d --build
docker compose -f deploy/docker-compose.integration.yml -f deploy/docker-compose.streaming.yml --profile smoke run --rm streaming-smoke run
docker compose -f deploy/docker-compose.integration.yml -f deploy/docker-compose.streaming.yml restart speed-layer
docker compose -f deploy/docker-compose.integration.yml -f deploy/docker-compose.streaming.yml --profile smoke run --rm streaming-smoke replay --base-time <base_time> --digest <digest>
```

The scenario is described in `serving/smoke/streaming_e2e.py`: contract-1.0.0 events are published through `POST /v1/events` of the ingestion gateway in four phases 25 seconds apart, starting 40 minutes in the past.

## Result of `run` (fresh volumes, base time 2026-10-19T14:10:00Z, 101.2 s)

| Check | Observed |
| --- | --- |
| Gateway accepted 12 valid events (HTTP 202) and rejected the event without `event_id` (HTTP 422) | 13 requests as expected |
| AAPL [14:10, 14:11): retry of q2 counted once; OHLC and last cumulative volume | 3 quotes, 100 / 102 / 100 / 101, volume 1500 |
| MSFT [14:10, 14:11) | 1 quote |
| AAPL [14:30, 14:31) | 2 quotes, close 111 |
| Too-late quote (14:11:30, sent after the watermark reached 14:20) | no window [14:11, 14:12) |
| `latest_market_metrics.AAPL` not replaced by the late quote | last price 111 |
| User 5-minute window: cancelled order ignored | 2 trades (1 buy, 1 sell), 1 action, turnover 304 |
| Event gate | 1 `too_late`, 0 invalid (the gateway had already rejected the bad event) |
| `StreamingQueryProgress` stored for every query | all 7 queries |
| S3A objects | 100 checkpoint objects for `market_1m`, 5 curated Parquet objects for `market_quote`, 2 too-late diagnostic objects |

## Restart and replay

After `restart speed-layer` all seven queries resumed from their S3A checkpoints in about 21 seconds (a second query run id; the event gate continued at batch 5 instead of batch 0). `replay` then published the same 12 valid events again (same event ids, new Kafka offsets):

| Check | Observed |
| --- | --- |
| Digest of every serving document (without execution metadata) before the replay | equal to the `run` digest `d503b699…` |
| Digest after the replay was consumed | unchanged |
| Document counts | unchanged: 18 market windows, 2 latest quotes, 1 user window |
| Replayed events actually consumed | gate batches 5–8 processed 9 + 1 + 1 + 1 events; `market_1m` reported rows dropped by the watermark |

So restart plus duplicate replay left the serving view unchanged: checkpointed offsets and state (watermark, `dropDuplicatesWithinWatermark`) plus deterministic upserts, as described in `recovery-test.md`. Replayed events older than the restored watermark are dropped as late, and newer ones are dropped as duplicates.

## Defect found by this run

`MongoProgressListener` failed to store any progress (`ValueError: cannot encode native uuid.UUID`): in PySpark 4 `StreamingQueryProgress` is a `dict` subclass holding `uuid.UUID` values, so `progress_as_dict` passed it through unchanged. Fixed by always using the progress object's JSON rendering. `test_market_1m_dedups_and_applies_watermark` now inserts real progress documents into MongoDB as a regression test.

## Not covered yet

- Kubernetes Deployment for the speed layer and the pod-deletion restart test (Task 10 step 5).
- Kafka broker restart while the stream runs, and `failOnDataLoss` after retention removes offsets.
- Event rates, end-to-end latency and state size at 1 million events (Task 11).
