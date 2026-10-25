# FinSight acceptance traceability

Statuses are deliberately conservative: **verified** means the named evidence was run; **implemented, runtime pending** means source/configuration exists but the required distributed demonstration has not been captured; **owner pending** means the responsible workstream is absent or incomplete on this branch.

| ID | Requirement | Implementation/evidence | Reproducible verification | Status on 2026-10-25 |
| --- | --- | --- | --- | --- |
| AC-01 | Three source types enter Kafka | `data-contracts/`, `ingestion/producers/`, `ingestion/kafka/topics.yaml`, `docs/evidence/member-a-ingestion-storage.md` | Ingestion Python/Node suites; topic and producer commands in the Member A runbook | Partial: source boundaries exist, but recorded runtime evidence proves only the market-quote path |
| AC-02 | Raw events retained in object storage | `storage/jobs/kafka_to_bronze.py`, `storage/minio/`, `deploy/k8s/minio.yaml` | Storage tests and recorded Kafka-to-MinIO evidence | Verified for the local slice; Kubernetes S3A smoke pending |
| AC-03 | Spark batch rebuilds curated/gold data | Expected under `spark/jobs/batch/` with output evidence | Batch tests, Spark UI and output samples | Owner pending: Person B batch artifacts are not present |
| AC-04 | Structured Streaming processes Kafka continuously | `spark/jobs/streaming/`, `deploy/k8s/spark.yaml`, `docs/evidence/streaming-integration.md` | Person C streaming evidence; cluster query-progress capture | Verified in the recorded local integration; Kubernetes runtime pending |
| AC-05 | Deterministic late/duplicate handling | `spark/jobs/streaming/event_gate.py`, serving deterministic keys, streaming semantics/recovery evidence | Spark/serving tests and controlled replay | Source/local evidence present; integrated cluster replay pending |
| AC-06 | Required aggregations and joins | Planned batch and performance workstream | Physical plans and reference tests | Owner pending: Person B artifacts are not present |
| AC-07 | MLlib and GraphFrames workflows | GraphFrames is pinned in the shared image; algorithms belong to Person B | Import smoke plus model/graph run evidence | Owner pending; coordinate only is not algorithm evidence |
| AC-08 | MongoDB serves analytics to dashboard | `serving/`, `src/lib/analytics.server.ts`, `src/routes/api/analytics.$.ts`, `src/routes/analytics.tsx` | Serving tests, authenticated API response and UI capture | API/build verified; live cluster/UI data capture pending |
| AC-09 | Reproducible Kubernetes platform | `deploy/k8s/`, `deploy/README.md`, `tests/platform/` | Manifest suite, DNS smoke, rollout and bounded restart | Static invariants verified; no cluster context, runtime pending |
| AC-10 | Monitoring covers system and data health | `monitoring/`, `/api/metrics`, `deploy/k8s/monitoring.yaml` | Dashboard/rule validation and controlled alert run | Source/dashboard coverage verified; alert firing pending |
| AC-11 | Quality/security/performance/recovery evidence | `tests/`, `docs/evidence/quality-security-performance.md`, Person A/C/D evidence | Workstream tests, scale harness and restart scenario | Partial: quality/local evidence exists; full cluster recovery and remaining security audit gates pending |
| AC-12 | Eleven lessons use the required structure | Section 10 of the project report | Editorial review plus workstream evidence links | Structurally present; Lesson 7 updated with measured Person D evidence; absent Person B results remain plans |

## Person D requirement mapping

| Person D responsibility | Primary artifacts | Verification |
| --- | --- | --- |
| Freeze compatibility | `docs/architecture/version-matrix.md`, `pyproject.toml`, `requirements.lock` | Platform version-alignment test; source links in matrix |
| Shared image/build tooling | `containers/spark/Dockerfile`, `containers/app/Dockerfile`, `vite.config.ts` | Host Node production build passed; Docker build/runtime-import gate remains |
| Kubernetes infrastructure | `deploy/k8s/configmap.yaml`, `mongodb.yaml`, `spark.yaml`, `app.yaml`, `jobs.yaml`, `producers.yaml`, `monitoring.yaml` | Ten platform manifest tests pass; cluster commands in deployment guide |
| React/Recharts visualization | `src/routes/analytics.tsx`, sidebar/route tree and analytics types | Scoped lint and production build pass; real-data visual capture pending |
| Monitoring | Dashboard, alert rules, app/platform metric renderers | Metric/panel coverage test and local degraded-state endpoint smoke pass |
| Platform/e2e tests | `tests/platform/test_kubernetes_manifests.py`, `tests/platform/k8s_smoke.py` | 45-pass combined non-Spark suite; destructive restart requires explicit `--restart` |
| Demo/runbook/editorial | `docs/demo/runbook.md`, this matrix, report Lesson 7, Person D evidence | Manual review; measured limitations are stated explicitly |

