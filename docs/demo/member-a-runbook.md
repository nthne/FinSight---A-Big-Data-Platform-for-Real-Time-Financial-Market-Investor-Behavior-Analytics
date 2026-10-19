# Member A demonstration runbook

## Local path

```powershell
docker compose -f deploy/docker-compose.integration.yml up -d --build
docker compose -f deploy/docker-compose.integration.yml run --rm topic-init
curl.exe -X POST http://localhost:18080/v1/events `
  -H "Content-Type: application/json" `
  -H "x-ingestion-token: local-integration-token" `
  --data-binary "@data-contracts/fixtures/valid-market-quote.json"
docker compose -f deploy/docker-compose.integration.yml run --rm --no-deps `
  -e BRONZE_CONSUMER_GROUP=finsight-demo `
  -e BRONZE_BASE_URI=s3://fin-sight `
  -e MINIO_ENDPOINT=http://minio:9000 `
  -e MINIO_ACCESS_KEY=finsight-local `
  -e MINIO_SECRET_KEY=finsight-local-secret `
  ingestion python -m storage.jobs.kafka_to_bronze --run-id demo-001 --max-records 1
```

Show the JSON counters printed by the Bronze job, then run `storage.jobs.verify_bronze` to show the Hive partition, preserved event ID and Snappy compression. Send `invalid-missing-event-id.json` to show a 422 response and a dead-letter record.

## Kubernetes path

For the local Docker Desktop profile, create a development-only Secret and apply the manifests in the order documented by `deploy/README.md`. The included `deploy/k8s/kafka.yaml` supplies a single-broker KRaft service; production still needs managed secrets and replicated platform services.

Show `kubectl -n finsight get pods,jobs,cronjobs`, gateway `/readyz`, the topic-init output, the Bronze Job counters and `storage.jobs.verify_bronze` with the MinIO service name. Restart the gateway pod and Kafka pod; confirm the gateway rolls out and the five Kafka topics remain after the PVC-backed restart.
