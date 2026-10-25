# FinSight deployment

Kubernetes is the assessed deployment target. Docker Compose remains the fast local integration profile for the ingestion/storage and streaming/serving slices. The Kubernetes manifests use a single broker, single MongoDB replica and Spark local mode inside one bounded pod; they prove orchestration, persistent state, service discovery and restart behavior, not production high availability.

## Prerequisites

- Docker with at least 8 GiB available to the cluster profile.
- Kubernetes with a default `ReadWriteOnce` StorageClass and at least 4 CPU / 8 GiB free.
- `kubectl` and a current context selected explicitly.
- A Supabase project URL, publishable key and server secret for authentication.

Check the target before making changes:

```bash
kubectl config current-context
kubectl cluster-info
kubectl get nodes
```

## 1. Build the pinned images

The public Supabase values are compiled into the browser bundle; the secret key is never a build argument.

```bash
docker build -f ingestion/Dockerfile -t finsight-ingestion:dev .
docker build -f storage/minio/Dockerfile -t finsight-minio:course .
docker build -f containers/spark/Dockerfile -t finsight-spark:0.1.0 .
docker build -f containers/app/Dockerfile -t finsight-app:0.1.0 \
  --build-arg VITE_SUPABASE_URL=https://example.supabase.co \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me \
  --build-arg VITE_MARKET_REFRESH_MODE=local .
docker image inspect finsight-ingestion:dev finsight-minio:course \
  finsight-spark:0.1.0 finsight-app:0.1.0 \
  --format '{{.RepoTags}} {{.Id}}'
```

Push the images to the selected registry and replace the local names for a remote cluster. Record the resolved image IDs/digests in the run evidence; do not copy placeholder digests into the report.

## 2. Create configuration and secrets

Copy `deploy/k8s/secrets.example.yaml` to the ignored `deploy/k8s/secrets.yaml`, replace every placeholder and keep the three MongoDB URIs consistent with the corresponding usernames/passwords. URI-encode reserved password characters.

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/ingestion-config.yaml
kubectl apply -f deploy/k8s/secrets.yaml
```

Only `secrets.example.yaml` is committed. The real file must remain ignored.

## 3. Deploy persistent services

```bash
kubectl apply -f deploy/k8s/kafka.yaml
kubectl apply -f deploy/k8s/minio.yaml
kubectl apply -f deploy/k8s/mongodb.yaml
kubectl -n finsight rollout status statefulset/kafka --timeout=240s
kubectl -n finsight rollout status deployment/minio --timeout=240s
kubectl -n finsight rollout status statefulset/mongodb --timeout=240s
```

Kafka, MinIO and MongoDB use PVC-backed state. The local Kafka and MongoDB manifests are single-node coursework profiles; a production target needs replicas, backups, TLS and a tested restore procedure.

## 4. Initialize topics, buckets, database users and indexes

```bash
kubectl apply -f deploy/k8s/ingestion-jobs.yaml
kubectl apply -f deploy/k8s/jobs.yaml
kubectl -n finsight wait --for=condition=complete job/finsight-topic-init --timeout=240s
kubectl -n finsight wait --for=condition=complete job/finsight-storage-init --timeout=240s
kubectl -n finsight wait --for=condition=complete job/finsight-mongo-users --timeout=240s
kubectl -n finsight wait --for=condition=complete job/finsight-mongo-setup --timeout=240s
kubectl -n finsight wait --for=condition=complete job/finsight-runtime-smoke --timeout=300s
kubectl -n finsight logs job/finsight-runtime-smoke
```

If a completed immutable Job already exists and its image/config changed, delete that exact Job and re-apply its manifest. Never delete the service PVCs as part of a normal redeploy.

## 5. Deploy workloads

```bash
kubectl apply -f deploy/k8s/ingestion.yaml
kubectl apply -f deploy/k8s/producers.yaml
kubectl apply -f deploy/k8s/spark.yaml
kubectl apply -f deploy/k8s/app.yaml
kubectl -n finsight rollout status deployment/finsight-ingestion --timeout=240s
kubectl -n finsight rollout status deployment/finsight-speed-layer --timeout=300s
kubectl -n finsight rollout status deployment/finsight-app --timeout=240s
```

Person B's batch/ML/GraphFrames jobs are not present on this branch, so there is no manifest pretending to run them. `finsight-runtime-smoke` proves only that the shared image can import the pinned Python libraries; the batch owner must still add and exercise their real job.

## 6. Deploy observability

```bash
kubectl -n finsight create configmap finsight-grafana-dashboard \
  --from-file=finsight-overview.json=monitoring/dashboards/finsight-overview.json \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n finsight create configmap finsight-prometheus-rules \
  --from-file=finsight-rules.yaml=monitoring/alerts/finsight-rules.yaml \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f deploy/k8s/monitoring.yaml
kubectl -n finsight rollout status deployment/prometheus deployment/grafana deployment/kafka-exporter --timeout=240s
```

See `monitoring/README.md` for exporter ownership and known empty-panel behavior.

## 7. Verify service discovery and the dashboard

```bash
kubectl -n finsight get pods,services,pvc,jobs,cronjobs
kubectl -n finsight run dns-smoke --rm -i --restart=Never --image=busybox:1.37 -- \
  sh -c 'nslookup kafka && nslookup minio && nslookup mongodb && nslookup finsight-app'
kubectl -n finsight port-forward service/finsight-app 3000:80
kubectl -n finsight port-forward service/grafana 3001:3000
```

Open `http://localhost:3000/analytics` after signing in. Loading, empty, error and stale states are deliberate. The page reads MongoDB serving results through the authenticated analytics API; it does not recompute Spark metrics in the browser.

To publish the deterministic market fixture for a demo:

```bash
kubectl -n finsight create job --from=cronjob/finsight-market-fixture-producer market-demo-001
kubectl -n finsight wait --for=condition=complete job/market-demo-001 --timeout=120s
kubectl -n finsight logs job/market-demo-001
```

## 8. Controlled restart test

Record document counts/digest before and after the restart. Reuse `RUN_ID=k8s-speed-v1`; changing it creates a new checkpoint lineage.

```bash
kubectl -n finsight get pods -l app=finsight-speed-layer -o wide
kubectl -n finsight delete pod -l app=finsight-speed-layer
kubectl -n finsight rollout status deployment/finsight-speed-layer --timeout=300s
kubectl -n finsight logs deployment/finsight-speed-layer --since=10m
```

For the producer boundary, delete the ingestion-gateway pod and verify that the Deployment recreates it:

```bash
kubectl -n finsight delete pod -l app=finsight-ingestion
kubectl -n finsight rollout status deployment/finsight-ingestion --timeout=180s
```

The expected result is recovery from the existing S3A checkpoint with the same final MongoDB serving counts. Process readiness alone is not sufficient evidence; run the replay/digest check from `serving.smoke.streaming_e2e` and record the measured recovery duration.

## Local Compose regression

```bash
docker compose -f deploy/docker-compose.integration.yml -f deploy/docker-compose.streaming.yml up -d --build
docker compose -f deploy/docker-compose.integration.yml -f deploy/docker-compose.streaming.yml --profile smoke run --rm streaming-smoke run
```

Local-only credentials in the Compose files must never be reused outside a developer machine.
