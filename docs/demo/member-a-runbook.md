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

After a human supplies a Kubernetes context, real secrets and the shared `kafka:9092` service, apply `deploy/k8s` in the order documented by `deploy/README.md`. Show readiness probes, the Bronze CronJob run and the restart behavior. Do not present the local Compose result as Kubernetes evidence.
