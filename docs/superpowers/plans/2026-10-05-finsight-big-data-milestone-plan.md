# FinSight Big Data Milestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing FinSight React/Supabase investment simulator into a reproducible Lambda Architecture Big Data platform using Kafka, PySpark, MinIO/S3-compatible storage, MongoDB and Kubernetes.

**Architecture:** Kafka receives versioned market, trade and behavior events. The Lambda batch layer rebuilds curated Parquet and historical analytics with Spark; the speed layer uses Spark Structured Streaming for event-time windows, state and fresh metrics. MongoDB serves idempotent analytics views to the existing React dashboard.

**Tech Stack:** PySpark, Spark Structured Streaming, Apache Kafka, MinIO or S3-compatible object storage, Parquet/Snappy, MongoDB, Kubernetes, Prometheus/Grafana, Python tests, existing React/TanStack/Supabase application layer.

**Spec:** `docs/report/FinSight_Web_Project_Description.md`

**Delivery window:** Target completion in 5 weeks with 4 team members at approximately 12 hours per person per week. This gives 240 gross person-hours; a 15 percent reserve leaves 204 planned hours, or about 51 hours per member. Week 6 is contingency only and is the hard deadline.

## Global Constraints

- Use Lambda Architecture for the milestone; document Kappa as the rejected alternative.
- Use Apache Spark for batch and streaming processing.
- Use Kafka or an equivalent durable message queue; this plan selects Kafka.
- Use MinIO/S3-compatible storage or HDFS for distributed raw/curated storage.
- Use MongoDB as the NoSQL serving database.
- Use Kubernetes or managed cloud Kubernetes; Docker alone is not the deployment deliverable.
- Preserve the existing React dashboard and Supabase authentication unless a task explicitly replaces an interface.
- Keep user IDs pseudonymous in analytical datasets and keep credentials out of source control.
- Pin and record compatible versions of Java, Python, Node.js, Spark, Kafka, Hadoop AWS/S3A, the MongoDB Spark Connector and GraphFrames before feature work expands.
- Build deployable container images, but use Kubernetes as the assessed deployment target.
- Keep batch and speed outputs distinguishable and define one deterministic Lambda reconciliation policy before exposing combined results.
- Do not report unmeasured throughput, latency, accuracy or recovery results as facts.
- Use at least 1 million events for scale validation; attempt 10 million as a stretch run when declared hardware permits.

## Review Focus

- Duplicate event replay must not duplicate MongoDB serving documents; test in Task 7.
- Out-of-order events must respect the configured watermark and late-event policy; test in Task 6.
- Spark joins must use the intended strategy rather than accidental full shuffles; test in Task 5.
- Restarting a streaming query must preserve state and reconcile output counts; test in Task 7.
- A provider or service outage must produce bounded failure behavior and observable recovery; test in Task 11.

## Balanced Four-Person Ownership

| Member | End-to-end workstream | Cross-cutting ownership | Planned effort |
| --- | --- | --- | --- |
| **Person A — Ingestion and storage** | Contracts, producers, Kafka, bronze landing, MinIO/Parquet, replay and source quality | Tests, metrics, image/workload configuration and evidence for the ingestion/storage workstream; Lessons 1, 4, 9 and 10 | About 51 hours |
| **Person B — Batch and advanced analytics** | Spark batch, transformations, UDF/UDAF, joins, optimization, statistics, MLlib and GraphFrames | Tests, metrics, image/workload configuration and evidence for the batch/analytics workstream; Lessons 2, 6 and 8 | About 51 hours |
| **Person C — Streaming and serving** | Structured Streaming, watermarks/state/checkpoints, idempotent MongoDB sink, Lambda reconciliation, API and authorization | Tests, metrics, image/workload configuration and evidence for the streaming/serving workstream; Lessons 3, 5 and 11 | About 51 hours |
| **Person D — Platform and visualization** | Version compatibility, shared image/deployment tooling, Kubernetes infrastructure, monitoring and React/Recharts visualization | Platform/e2e tests, demo runbook, Lesson 7 and final editorial assembly | About 51 hours |

| Member | Week 1 | Week 2 | Week 3 | Week 4 | Week 5 | Planned total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Person A | 11 | 11 | 10 | 10 | 9 | 51 |
| Person B | 9 | 12 | 11 | 11 | 8 | 51 |
| Person C | 8 | 10 | 12 | 12 | 9 | 51 |
| Person D | 12 | 8 | 9 | 10 | 12 | 51 |
| **Team** | **40** | **41** | **42** | **43** | **38** | **204** |

The unused capacity up to 12 hours per member per week is the shared integration/recovery reserve, not a pool for adding scope.

Every member owns tests, observability, deployment configuration and written evidence for their own workstream. Person D integrates those artifacts but is not the sole QA engineer or report author. All members participate in daily integration and cross-review. Optional features such as AI coaching, leaderboard refinement, full limit/stop-order lifecycle and multi-region deployment are deferred until all Must evidence passes.

## Five-Week Target Sequence and Conditional Week 6

| Week | Shared gate | Person A | Person B | Person C | Person D |
| --- | --- | --- | --- | --- | --- |
| 1 — Compatibility foundation | Core services start; Kafka, S3A, Mongo and GraphFrames compatibility is proven; one event reaches Kafka | Freeze contracts, producer fixture and topics | Spark skeleton, deterministic fixtures and reference calculations | MongoDB/stream/API contracts and deterministic serving keys | Pin versions, create image-build baseline and deploy shared Kubernetes infrastructure |
| 2 — Batch vertical slice | Kafka → MinIO → Spark batch → MongoDB → API works on deterministic data | Producers, bronze landing, partitions and quality counters | Batch transformations, UDF/UDAF, aggregations and initial joins | Mongo indexes, batch upsert path and API contract | Workload manifests, observability skeleton and dashboard shell |
| 3 — Streaming vertical slice | Live events reach the dashboard; restart and replay preserve final serving counts | Late/duplicate fixtures, DLQ, replay and source metrics | MLlib, GraphFrames, statistics and join experiments | Streaming windows, watermark, state, checkpoints and `foreachBatch` sink | Live dashboard states, monitoring panels and streaming smoke tests |
| 4 — Hardening | All technical Must items have source, tests and evidence; no correctness blocker remains | Schema evolution/provider failure, storage lifecycle and security | Physical plans, pruning, catalog-backed bucketing, caching, AQE and resource measurements | Lambda reconciliation, late/duplicate/recovery and authorization tests | Kubernetes fault tests, alert checks, UI hardening and end-to-end regression |
| 5 — Evidence and submission | Clean-environment demo passes; all Must evidence is linked and measured | Final tests plus Lessons 1, 4, 9 and 10 | One-million-event baseline plus Lessons 2, 6 and 8 | Final stream/API tests plus Lessons 3, 5 and 11 | Clean deployment, Lesson 7, traceability, demo and editorial assembly |
| 6 — Contingency only | Open only if the Week 5 gate fails; no new feature begins | Fix unresolved Must defects only | Re-run failed correctness/performance evidence only | Fix reconciliation/recovery/API blockers only | Restore deployment/demo reproducibility and assemble corrected evidence |

The team should finish and submit as soon as all Week 5 criteria pass; Week 6 is not part of the feature plan. The minimum functional-scale run is 1 million events. A 10 million-event run is stretch work and cannot displace any required end-to-end evidence.

---

### Task 1: Freeze Compatibility, Build Baseline and Data Contract

**Owner:** Person A for contracts and Person D for runtime/build compatibility; all members review  
**Week:** 1

**Files:**
- Create: `data-contracts/events.schema.json`
- Create: `data-contracts/README.md`
- Create: `data-contracts/fixtures/valid-market-quote.json`
- Create: `data-contracts/fixtures/invalid-duplicate-event.json`
- Create: `docs/architecture/version-matrix.md`
- Create: `pyproject.toml` and `requirements.lock`
- Create: `containers/spark/Dockerfile` and `containers/app/Dockerfile`; component owners add any specialized image beside their component
- Modify: `docs/report/FinSight_Web_Project_Description.md` only if implementation decisions change

**Interfaces:**
- Consumes: Existing market, order, portfolio and behavior concepts from `src/` and Supabase migrations plus the selected local/cloud Kubernetes profile.
- Produces: A tested Java/Python/Node.js/Spark/Kafka/S3A/Mongo/GraphFrames version matrix, buildable base images and a versioned envelope with `event_id`, `event_type`, `schema_version`, `source`, `event_time`, `ingestion_time`, optional `asset_symbol`, optional pseudonymous `user_id`, and type-specific `payload`.

- [ ] **Step 1: Prove runtime and connector compatibility**

  Pin Java, Python, Node.js, Spark, Kafka, Hadoop AWS/S3A, MongoDB Spark Connector and GraphFrames versions. Run minimal import/connectivity checks before developing jobs; record exact image tags and package coordinates.

- [ ] **Step 2: Create the image and dependency baseline**

  Add reproducible Python dependencies and component Dockerfiles. Build at least the Spark and application images, and record image names/digests used by Kubernetes.

- [ ] **Step 3: Inventory existing fields and freeze the contract**

  Map current `market_prices`, `orders`, portfolio snapshots and behavior records to the event contract. Record fields that have no source yet and define compatibility rules for future schema versions.

- [ ] **Step 4: Write and validate schema fixtures**

  Include a valid event, a missing-ID event, an invalid timestamp, an unknown-symbol event and a duplicate-ID event.

  Run: `python -m jsonschema -i data-contracts/fixtures/valid-market-quote.json data-contracts/events.schema.json`

  Expected: required packages load, images build, the valid fixture passes and invalid fixtures fail with named validation errors.

- [ ] **Step 5: Commit**

  ```bash
  git add data-contracts docs/architecture/version-matrix.md pyproject.toml requirements.lock containers
  git commit -m "build: freeze runtime and event contract"
  ```

### Task 2: Implement Kafka Topics and Producers

**Owner:** Person A  
**Week:** 1–2

**Files:**
- Create: `ingestion/producers/market_producer.py`
- Create: `ingestion/producers/app_event_producer.ts`
- Create: `ingestion/kafka/topics.yaml`
- Create: `ingestion/Dockerfile`
- Create: `ingestion/tests/test_producers.py`
- Create: `ingestion/README.md`

**Interfaces:**
- Consumes: Versioned event contract from Task 1 and provider adapters from the existing application.
- Produces: Kafka topics `market-quotes`, `trades`, `user-actions`, `portfolio-snapshots`, and `dead-letter-events`; producer records retain stable `event_id` and source metadata.

- [ ] **Step 1: Declare topic configuration**

  Set partition key rules: asset symbol for market quotes and pseudonymous user ID for user events. Record retention and replication assumptions.

- [ ] **Step 2: Implement provider normalization**

  Normalize source timestamps, symbols, prices, volumes and currencies before publishing. Invalid records go to the dead-letter topic with an error code.

- [ ] **Step 3: Implement application event publishing**

  Publish trade and behavior events without exposing service-role credentials in the browser. Use a server-side or API producer boundary.

- [ ] **Step 4: Test producer behavior**

  Run: `pytest ingestion/tests/test_producers.py -v`

  Expected: valid events publish with stable IDs; retries do not create a new ID; invalid payloads are rejected or routed to the dead-letter path.

- [ ] **Step 5: Commit**

  ```bash
  git add ingestion
  git commit -m "feat: add Kafka topics and event producers"
  ```

### Task 3: Deploy Raw Storage and the Bronze Landing Path

**Owner:** Person A; Person D reviews the Kubernetes storage boundary  
**Week:** 1–2

**Files:**
- Create: `storage/minio/README.md`
- Create: `storage/schemas/bronze_schema.py`
- Create: `storage/jobs/kafka_to_bronze.py`
- Create: `storage/minio/spark-defaults.conf`
- Create: `storage/tests/test_bronze_layout.py`
- Create: `deploy/k8s/minio.yaml`

**Interfaces:**
- Consumes: Kafka topics from Task 2.
- Produces: Immutable Parquet files under `bronze/event_type=.../event_date=...`, compressed with Snappy and accompanied by row-count/run metadata.

- [ ] **Step 1: Create the bucket layout**

  Define `fin-sight/bronze`, `fin-sight/silver` and `fin-sight/gold` prefixes. Document retention, compaction and naming rules.

- [ ] **Step 2: Configure and verify the S3A boundary**

  Configure the matching Hadoop AWS/S3A connector, endpoint, path-style access and credential injection for MinIO. Keep credentials in Kubernetes Secrets and prove Spark can read and write a test object.

- [ ] **Step 3: Implement the bronze writer**

  Preserve the original event envelope, attach ingestion metadata, and write deterministic partition paths. Do not overwrite an existing run without an explicit run ID.

- [ ] **Step 4: Add data-quality counters**

  Count accepted, rejected, duplicate, null and unknown-symbol records by source and run.

- [ ] **Step 5: Test storage layout**

  Run: `pytest storage/tests/test_bronze_layout.py -v`

  Expected: files are Parquet/Snappy, partition predicates work, and row counts reconcile with accepted producer events.

- [ ] **Step 6: Commit**

  ```bash
  git add storage deploy/k8s/minio.yaml
  git commit -m "feat: add bronze Parquet storage"
  ```

### Task 4: Build the Spark Batch Bronze-to-Gold Pipeline

**Owner:** Person B  
**Week:** 2

**Files:**
- Create: `spark/lib/schemas.py`
- Create: `spark/lib/quality.py`
- Create: `spark/jobs/batch/market_batch.py`
- Create: `spark/jobs/batch/portfolio_batch.py`
- Create: `spark/tests/test_batch_transformations.py`
- Create: `spark/README.md`

**Interfaces:**
- Consumes: Bronze Parquet paths from Task 3 and reference asset data.
- Produces: Silver normalized datasets and gold market/portfolio/behavior metrics in Parquet with run metadata.

- [ ] **Step 1: Implement schema and quality transformations**

  Parse timestamps, normalize symbols, cast numeric fields, reject invalid values and deduplicate by `event_id`.

- [ ] **Step 2: Implement complex aggregations**

  Add event-time windows, rolling return, volatility, drawdown, volume summaries, `rollup`/`cube`, pivot by asset type/source, and an unpivot step for serving metrics.

- [ ] **Step 3: Implement a custom aggregation/UDF**

  Implement a documented weighted-volatility aggregation and a behavior-classification UDF. Cover null, empty and malformed inputs in tests.

- [ ] **Step 4: Implement time-series and portfolio analytics**

  Compute returns, variance, z-score, moving averages, rolling correlation, concentration and drawdown from the normalized data.

- [ ] **Step 5: Test against reference calculations**

  Run: `pytest spark/tests/test_batch_transformations.py -v`

  Expected: Spark outputs match small deterministic fixtures within the documented numeric tolerance.

- [ ] **Step 6: Commit**

  ```bash
  git add spark
  git commit -m "feat: add Spark batch analytics pipeline"
  ```

### Task 5: Add Join and Performance Experiments

**Owner:** Person B  
**Week:** 3–4

**Files:**
- Create: `spark/jobs/batch/join_benchmarks.py`
- Create: `spark/jobs/batch/optimization_report.py`
- Create: `spark/conf/catalog.conf`
- Create: `spark/tests/test_join_strategies.py`
- Create: `docs/evidence/spark-optimization.md`

**Interfaces:**
- Consumes: Silver datasets and the small asset dimension from Task 4.
- Produces: Optimized gold outputs and reproducible benchmark records containing physical plans, runtime, shuffle, input files and memory observations.

- [ ] **Step 1: Add the broadcast join**

  Join quotes to the small asset dimension and assert that the physical plan uses a broadcast strategy.

- [ ] **Step 2: Add the large sort-merge join**

  Join large quotes and trades on normalized symbol/date. Record partition counts and shuffle size.

- [ ] **Step 3: Add the multiple-join pipeline**

  Join orders, quotes, assets and behavior events. Compare an unoptimized plan to a plan with pruning, projection, repartitioning and AQE.

- [ ] **Step 4: Add catalog-backed bucketing and caching experiments**

  Configure a persistent catalog/metastore suitable for Spark bucket metadata. Compare bucketed/non-bucketed and cached/non-cached runs, verify the physical plan actually uses the intended layout, and keep the optimization only if the measured workload benefits.

- [ ] **Step 5: Verify the plans**

  Run: `pytest spark/tests/test_join_strategies.py -v`

  Expected: plan assertions identify the intended strategy and benchmark output contains before/after measurements.

- [ ] **Step 6: Commit**

  ```bash
  git add spark docs/evidence/spark-optimization.md
  git commit -m "perf: document Spark join and optimization experiments"
  ```

### Task 6: Build Structured Streaming with Watermarks and State

**Owner:** Person C; Person B reviews Spark semantics  
**Week:** 3

**Files:**
- Create: `spark/jobs/streaming/market_stream.py`
- Create: `spark/jobs/streaming/behavior_stream.py`
- Create: `spark/lib/streaming_config.py`
- Create: `spark/tests/test_streaming_semantics.py`
- Create: `docs/evidence/streaming-semantics.md`

**Interfaces:**
- Consumes: Kafka topics from Task 2.
- Produces: Windowed metrics, late-event outputs and checkpointed state for the idempotent serving path in Task 7.

- [ ] **Step 1: Implement the append-mode event path**

  Validate events, write accepted records to the curated path, and send invalid records to the dead-letter output.

- [ ] **Step 2: Implement event-time windows**

  Add one-minute and five-minute market windows, user activity windows and a configurable 10-minute watermark.

- [ ] **Step 3: Demonstrate output modes**

  Run append for immutable records, update for rolling metrics, and a controlled complete-mode query for comparison. Document why complete mode is not used in the high-volume path.

- [ ] **Step 4: Implement late-event policy**

  Keep events inside the watermark, count accepted-late events, and route too-late events to a diagnostic output.

- [ ] **Step 5: Test streaming fixtures**

  Run: `pytest spark/tests/test_streaming_semantics.py -v`

  Expected: on-time, out-of-order, duplicate and too-late fixtures produce deterministic window results and counters.

- [ ] **Step 6: Commit**

  ```bash
  git add spark docs/evidence/streaming-semantics.md
  git commit -m "feat: add Spark Structured Streaming semantics"
  ```

### Task 7: Implement Checkpointing, Idempotent Sinks and Lambda Reconciliation

**Owner:** Person C; Person D reviews persistent storage and restart behavior  
**Week:** 3–4

**Files:**
- Create: `serving/mongo_sink.py`
- Create: `serving/mongo_schema.js`
- Create: `serving/lambda_reconciliation.py`
- Create: `spark/tests/test_recovery_and_idempotency.py`
- Create: `docs/evidence/recovery-test.md`

**Interfaces:**
- Consumes: Streaming aggregates from Task 6.
- Produces: Separate batch and speed collections keyed by deterministic event/window/asset or user/window identifiers, plus a reconciled serving view with freshness and run metadata.

- [ ] **Step 1: Create MongoDB indexes**

  Add unique keys for idempotent upserts and query indexes for dashboard filters and freshness ordering.

- [ ] **Step 2: Implement the streaming sink with `foreachBatch`**

  Use `foreachBatch` to upsert by deterministic key, preserve `computed_at`, `source_window`, `run_id` and `data_freshness`, and count duplicate/upsert conflicts. Document that the end-to-end outcome depends on checkpointing plus idempotent MongoDB writes rather than a blanket exactly-once claim.

- [ ] **Step 3: Configure persistent checkpoints**

  Store checkpoint state on persistent storage and separate checkpoint paths per query.

- [ ] **Step 4: Reconcile Lambda batch and speed results**

  Keep batch and speed documents distinguishable. Define the cutoff/version rule that replaces provisional speed results with authoritative batch results, and test overlapping windows so the API never double-counts them.

- [ ] **Step 5: Run restart and replay tests**

  Run: `pytest spark/tests/test_recovery_and_idempotency.py -v`

  Expected: restarting the query or replaying the same event IDs produces the same final serving counts without duplicate documents.

- [ ] **Step 6: Commit**

  ```bash
  git add serving spark/tests/test_recovery_and_idempotency.py docs/evidence/recovery-test.md
  git commit -m "feat: add idempotent MongoDB serving and recovery tests"
  ```

### Task 8: Add MLlib, GraphFrames and Advanced Statistics

**Owner:** Person B  
**Week:** 3–4

**Files:**
- Create: `spark/jobs/analytics/behavior_ml.py`
- Create: `spark/jobs/analytics/market_graph.py`
- Create: `spark/tests/test_advanced_analytics.py`
- Create: `docs/evidence/advanced-analytics.md`

**Interfaces:**
- Consumes: Gold feature datasets from Task 4 and interaction events from Task 6.
- Produces: Investor segments, graph metrics, statistical outputs and model metadata in the gold layer and MongoDB serving collections.

- [ ] **Step 1: Build MLlib features**

  Assemble trade frequency, turnover, concentration, drawdown, volatility and loss-related features with explicit feature lineage.

- [ ] **Step 2: Train and evaluate segments**

  Use KMeans or another documented unsupervised model, record feature scaling, cluster counts and silhouette score, and label outputs as educational segments.

- [ ] **Step 3: Build the GraphFrames graph**

  Use pseudonymous users and assets as vertices and interactions as edges. Compute degree/PageRank/community metrics and record graph size.

- [ ] **Step 4: Add statistical/time-series checks**

  Compare Spark outputs for returns, variance, z-score, rolling correlation and drawdown with deterministic reference calculations.

- [ ] **Step 5: Verify outputs**

  Run: `pytest spark/tests/test_advanced_analytics.py -v`

  Expected: model, graph and statistics outputs have stable schemas, recorded metrics and documented limitations.

- [ ] **Step 6: Commit**

  ```bash
  git add spark/jobs/analytics spark/tests/test_advanced_analytics.py docs/evidence/advanced-analytics.md
  git commit -m "feat: add MLlib GraphFrames and statistical analytics"
  ```

### Task 9: Integrate the Serving API and Existing Dashboard

**Owner:** Person C for API/authorization and Person D for React/Recharts visualization  
**Week:** 2–4

**Files:**
- Create: `serving/api_contract.md`
- Create: `src/routes/api/analytics.ts`
- Create: `src/lib/analytics.ts`
- Modify: relevant dashboard routes under `src/routes/`
- Create: `tests/integration/test_analytics_api.py`

**Interfaces:**
- Consumes: MongoDB serving collections from Task 7 and Task 8.
- Produces: Authenticated API responses containing metrics, source window, computation time and freshness; dashboard charts use processed results rather than recomputing them locally.

- [ ] **Step 1: Define API responses**

  Specify response schemas for latest market metrics, portfolio risk, behavior segments, time series and pipeline health.

- [ ] **Step 2: Add authorization and freshness**

  Enforce user ownership for user-level views and expose stale-data state when the freshness threshold is exceeded.

- [ ] **Step 3: Integrate the dashboard**

  Preserve existing loading, empty and error states. Add labels that distinguish educational analytics from financial advice.

- [ ] **Step 4: Test the API path**

  Run: `pytest tests/integration/test_analytics_api.py -v`

  Expected: authorized requests receive the correct serving view; unauthorized requests cannot access another user's analytics.

- [ ] **Step 5: Commit**

  ```bash
  git add src serving/api_contract.md tests/integration/test_analytics_api.py
  git commit -m "feat: connect MongoDB analytics to the dashboard"
  ```

### Task 10: Deploy the Platform on Kubernetes

**Owner:** Person D for shared infrastructure; Persons A–C own the manifest and image settings for their workloads  
**Week:** 1–4

**Files:**
- Create: `deploy/k8s/namespace.yaml`
- Create: `deploy/k8s/kafka.yaml`
- Create: `deploy/k8s/mongodb.yaml`
- Create: `deploy/k8s/spark.yaml`
- Create: `deploy/k8s/producers.yaml`
- Create: `deploy/k8s/jobs.yaml`
- Create: `deploy/k8s/app.yaml`
- Create: `deploy/k8s/configmap.yaml`
- Create: `deploy/k8s/secrets.example.yaml`
- Create: `deploy/README.md`

**Interfaces:**
- Consumes: The image/version baseline from Task 1, shared services in Week 1 and workload images/configuration incrementally from Tasks 2–9.
- Produces: A namespace with discoverable services, persistent volumes, resource limits, restart policies and repeatable deployment commands.

- [ ] **Step 1: Deploy the Week 1 infrastructure baseline**

  Define the namespace plus Kafka, MinIO and MongoDB services with persistent volume claims, readiness checks and resource requests/limits. Prove service discovery before dependent workload manifests are complete.

- [ ] **Step 2: Add owner-maintained workload manifests**

  Person A maintains producer/storage settings, Person B maintains batch/analytics Spark settings, Person C maintains streaming/API settings and Person D maintains the application plus shared platform. Add Spark and application workloads only when their images exist.

- [ ] **Step 3: Add configuration boundaries**

  Keep hostnames and non-secret settings in ConfigMaps. Keep credentials in Secrets or a managed secret store; commit only an example file.

- [ ] **Step 4: Deploy and inspect**

  Run: `kubectl apply -f deploy/k8s/`

  Expected: all required workloads reach the documented ready state and communicate through Kubernetes service names.

- [ ] **Step 5: Test restart behavior**

  Delete one producer pod and one streaming pod. Expected: Kubernetes restarts them and the pipeline resumes without duplicate serving results beyond the documented retry window.

- [ ] **Step 6: Commit**

  ```bash
  git add deploy/k8s deploy/README.md
  git commit -m "feat: deploy FinSight data platform on Kubernetes"
  ```

### Task 11: Add Monitoring, Data Quality and Security Evidence

**Owner:** Person D coordinates shared dashboards; every member instruments and tests their own workstream  
**Week:** 3–5

**Files:**
- Create: `monitoring/dashboards/finsight-overview.json`
- Create: `monitoring/alerts/finsight-rules.yaml`
- Create: `monitoring/README.md`
- Create: `tests/data_quality/test_quality_rules.py`
- Create: `tests/performance/run_scale_test.py`
- Create: `docs/evidence/quality-security-performance.md`

**Interfaces:**
- Consumes: Metrics/logs from Kafka, Spark, MongoDB, API and Kubernetes.
- Produces: Dashboards, alerts, quality reports, performance measurements, secret-handling evidence and a fault-injection timeline.

- [ ] **Step 1: Expose pipeline metrics**

  Person A exposes Kafka/source/storage quality metrics, Person B exposes Spark batch/analytics metrics, Person C exposes streaming/Mongo/API metrics and Person D exposes Kubernetes/application metrics. Record Kafka lag, rates, Spark batch duration, watermark, state rows, late events, rejected events, MongoDB latency, API errors and resource use.

- [ ] **Step 2: Create dashboards and alerts**

  Add panels for freshness, lag, failures, quality and resource saturation. Alert on failed batches, stale data, lag growth, high rejection rate and storage pressure.

- [ ] **Step 3: Run quality and security checks**

  Each owner supplies tests for their boundary. Verify schemas, totals, uniqueness, authorization, pseudonymization, secret exclusion and provider metadata; Person D runs the assembled end-to-end suite.

- [ ] **Step 4: Run the scale experiment**

  Run the baseline first: `python tests/performance/run_scale_test.py --events 1000000`

  If the baseline passes and time remains, run the stretch experiment: `python tests/performance/run_scale_test.py --events 10000000`

  Expected: the command records event count, input size, event rate, batch runtime, p95 latency, shuffle, peak memory and output counts. It must not print unmeasured values as pass criteria.

- [ ] **Step 5: Commit**

  ```bash
  git add monitoring tests docs/evidence/quality-security-performance.md
  git commit -m "test: add monitoring quality and performance evidence"
  ```

### Task 12: Complete the Report, Lessons and Demonstration Package

**Owner:** All members write their assigned evidence and lessons; Person D is final editor and demo coordinator  
**Week:** 4–5

**Files:**
- Modify: `docs/report/FinSight_Web_Project_Description.md`
- Modify: `docs/evidence/*.md`
- Create: `docs/demo/runbook.md`
- Create: `docs/demo/screenshots/` and recorded evidence as appropriate

**Interfaces:**
- Consumes: Implementation, test, monitoring and deployment evidence from Tasks 1–11.
- Produces: Final report, traceability matrix, demonstration runbook, measured lessons learned and explicit limitations.

- [ ] **Step 1: Update implementation status**

  Mark each component implemented, partial, simulated, measured or deferred. Remove planning language only where evidence exists.

- [ ] **Step 2: Complete all eleven lessons**

  Use Problem Description, Approaches Tried, Final Solution and Key Takeaways. Person A drafts Lessons 1, 4, 9 and 10; Person B drafts Lessons 2, 6 and 8; Person C drafts Lessons 3, 5 and 11; Person D drafts Lesson 7 and edits the complete report. Include actual metrics, conditions and trade-offs.

- [ ] **Step 3: Assemble traceability**

  Map every course requirement to source file/job, test, deployment artifact and report section.

- [ ] **Step 4: Run final verification**

  Run: `npm run lint` and `npm run build` from the application root; run all Python tests and the Kubernetes smoke test.

  Expected: record exit codes, test counts, known exceptions and environment details in the report.

- [ ] **Step 5: Rehearse the final demonstration**

  Follow `docs/demo/runbook.md` from a clean environment and record any step that depends on undocumented manual state. Person A demonstrates ingestion/storage, Person B demonstrates Spark plans/analytics, Person C demonstrates streaming/recovery/API and Person D demonstrates Kubernetes/monitoring/dashboard.

- [ ] **Step 6: Commit**

  ```bash
  git add docs
  git commit -m "docs: complete FinSight Big Data milestone report"
  ```

---

## Final Plan Self-Review

- Spark batch requirements are covered by Tasks 4–5.
- Streaming windows, watermarks, state and recovery are covered by Tasks 6–7.
- MLlib, GraphFrames and statistical analytics are covered by Task 8.
- Kafka, distributed storage, NoSQL and Kubernetes are covered by Tasks 2–3, 7 and 10.
- Visualization and integration are covered by Task 9.
- Monitoring, quality, security, scaling and fault tolerance are covered by Task 11 and the lessons in the report.
- Every performance or correctness claim is paired with a planned command or artifact that must be run before it is reported as a result.
- The five-week target is protected by treating the 1-million-event end-to-end run as the baseline and the 10-million-event run as stretch work; Week 6 is recovery capacity only.
- Every task has an owner and week; cross-team integration gates occur at the end of Weeks 1–5, and each member owns tests, deployment configuration and evidence for their workstream.
- The plan explicitly covers version compatibility, container builds, MinIO through S3A, catalog-backed bucketing, `foreachBatch` idempotency and Lambda batch/speed reconciliation.
