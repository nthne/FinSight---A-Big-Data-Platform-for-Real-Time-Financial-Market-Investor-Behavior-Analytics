# Member A deployment profile

This directory contains the ingestion and object-storage boundary owned by Member A. The Docker Compose profile is the repeatable local integration environment; Kubernetes is the assessed target.

## Local integration

```powershell
docker compose -f deploy/docker-compose.integration.yml up -d --build
docker compose -f deploy/docker-compose.integration.yml ps -a
```

The profile starts Kafka 4.3.1, a source-built and pinned MinIO course image, the ingestion gateway, topic initialization and storage initialization. Kafka and MinIO use named volumes. Credentials in this profile are local-only and must never be reused outside a developer machine.

## Kubernetes

Build and publish `finsight-ingestion:dev` and `finsight-minio:course` to the registry selected by the platform owner, then replace the development image names or make them available to the local cluster.

```powershell
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/ingestion-config.yaml
kubectl apply -f deploy/k8s/secrets.yaml
kubectl apply -f deploy/k8s/minio.yaml
kubectl apply -f deploy/k8s/ingestion.yaml
kubectl apply -f deploy/k8s/ingestion-jobs.yaml
kubectl -n finsight wait --for=condition=available deployment/minio deployment/finsight-ingestion --timeout=180s
```

Create `deploy/k8s/secrets.yaml` locally from `secrets.example.yaml`; the real file is intentionally ignored. The shared platform owner must provide the `kafka:9092` service before the topic job and Bronze CronJob can succeed.

The MinIO community repository was archived in 2026. This profile builds the official source tag `RELEASE.2025-10-15T17-29-55Z` for isolated coursework only. A human owner must approve the maintained S3-compatible product, licensing, backup policy and image registry before any non-course deployment.
