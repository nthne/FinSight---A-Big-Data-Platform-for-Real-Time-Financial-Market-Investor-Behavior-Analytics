# FinSight integrated demonstration runbook

This runbook is the Person D hand-off for a clean Kubernetes demonstration. It separates source/configuration checks from runtime evidence: do not mark a runtime step complete until its command output has been captured from the selected cluster.

## Evidence directory and naming

Create a new directory outside the tracked source tree for every run, for example `evidence/2026-10-25-k8s-demo/`. Save commands and UTC timestamps as text, JSON or screenshots. Never capture Secret values, connection strings or bearer tokens.

Record these facts at the start:

- Git commit and whether the worktree is clean.
- Host CPU/memory, Docker version, Kubernetes context and node versions.
- Built image IDs/digests for ingestion, MinIO, Spark and the app.
- Fixture name, `RUN_ID`, event count, replay rate and watermark.

## 1. Preflight and local regression

```bash
git status --short
git rev-parse HEAD
docker version
kubectl config current-context
kubectl cluster-info
kubectl get nodes -o wide
npm ci
npm run build
python -m pytest tests/platform/test_kubernetes_manifests.py \
  ingestion/tests storage/tests serving/tests tests/data_quality -q
node --test --experimental-strip-types ingestion/tests/*.test.ts
```

The platform manifest tests must pass before applying resources. Spark-specific tests require the locked PySpark/GraphFrames environment and remain a separate workstream gate.

## 2. Build, identify and make images available

Follow `deploy/README.md` to build all four images. Capture the output of:

```bash
docker image inspect finsight-ingestion:dev finsight-minio:course \
  finsight-spark:0.1.0 finsight-app:0.1.0 \
  --format '{{.RepoTags}} {{.Id}} {{index .RepoDigests 0}}'
```

Load the images into Kind/Minikube or push immutable digests to the target registry. Update the manifests when the cluster cannot access local images. Do not use `latest` as submission evidence.

## 3. Deploy in dependency order

Create `deploy/k8s/secrets.yaml` from the ignored example and replace every placeholder. Apply the namespace, configuration, secrets, persistent dependencies, initialization jobs, workloads and monitoring exactly in the order documented by `deploy/README.md`.

After each stage capture:

```bash
kubectl -n finsight get pods,services,pvc,jobs,cronjobs -o wide
kubectl -n finsight get events --sort-by=.lastTimestamp
kubectl -n finsight get deployment,statefulset -o json
```

Run the DNS smoke command from `deploy/README.md`. Capture the shared runtime-smoke log and verify that Spark, GraphFrames, S3A and MongoDB connector imports/package resolution succeed in the built image.

## 4. Start the deterministic vertical slice

Port-forward the app, Grafana and Prometheus in separate terminals:

```bash
kubectl -n finsight port-forward service/finsight-app 3000:80
kubectl -n finsight port-forward service/grafana 3001:3000
kubectl -n finsight port-forward service/prometheus 9090:9090
```

Trigger a uniquely named fixture job:

```bash
kubectl -n finsight create job \
  --from=cronjob/finsight-market-fixture-producer market-demo-001
kubectl -n finsight wait --for=condition=complete job/market-demo-001 --timeout=120s
kubectl -n finsight logs job/market-demo-001
```

Verify the following in sequence and capture one artifact for each boundary:

1. Kafka topic record with its stable `event_id`.
2. Bronze Parquet object and partition path in MinIO.
3. Spark query progress containing input rate, processed rate, watermark and state rows.
4. MongoDB document containing computation time, window, pipeline run ID and freshness.
5. Authenticated `/analytics` UI showing latest quote, time series, portfolio risk, behavior segment and pipeline state.
6. `/api/health` returning success and `/api/metrics` exposing application and dependency metrics without secrets or user IDs.
7. Grafana panels populated from the expected exporters.

The dashboard labels speed results as provisional, batch results as authoritative and behavioral output as educational—not investment advice.

## 5. Controlled failure scenarios

For every scenario record: start/end UTC time, baseline counts/digest, action, observed alert/metric, root cause, recovery duration, final counts/digest and any manual step.

### Application outage and alert

```bash
kubectl -n finsight scale deployment/finsight-app --replicas=0
# Wait for the configured alert interval and capture FinSightApplicationDown.
kubectl -n finsight scale deployment/finsight-app --replicas=1
kubectl -n finsight rollout status deployment/finsight-app --timeout=240s
```

Verify the alert fires and resolves. Do not infer recovery time from pod status alone.

### Streaming restart and checkpoint recovery

Use the read-only smoke harness first, then opt in to the exact bounded restart:

```bash
python tests/platform/k8s_smoke.py
python tests/platform/k8s_smoke.py --restart
```

The script deletes only the selected speed-layer pod, waits for rollout and reports measured seconds. Preserve `RUN_ID=k8s-speed-v1` and the S3A checkpoint. Compare deterministic MongoDB counts/digests before and after with `serving.smoke.streaming_e2e`; readiness alone is not a correctness result.

### Duplicate and late data

Replay fixtures with an existing event ID plus on-time, accepted-late and too-late timestamps. Capture the gate counters, MongoDB unique-key outcome and final reconciliation. Expected policy is documented in `docs/evidence/streaming-semantics.md`.

## 6. Monitoring investigation path

Use the smallest path that can localize the fault:

1. Grafana service/data-quality overview.
2. Prometheus target health and alert expression.
3. Kubernetes events, rollout and pod logs.
4. Kafka consumer-group lag.
5. Spark query progress/Spark UI and checkpoint lineage.
6. MongoDB ping/query/index state.
7. App request/error counters and freshness metadata.

An empty panel means the named exporter or series is absent; it must never be narrated as a measured zero.

## 7. Exit criteria and cleanup

The demo passes only when every claimed AC has a stored artifact and the results agree across Kafka, object storage, Spark progress, MongoDB and the UI. Add measured results and limitations to `docs/evidence/traceability.md`.

Stop port-forwards and optionally scale stateless workloads down. Do not delete PVCs, checkpoints, MongoDB data, or the namespace until evidence and backup requirements have been reviewed. If the cluster is disposable and deletion is explicitly approved, record that the data is not recoverable before removing it.

