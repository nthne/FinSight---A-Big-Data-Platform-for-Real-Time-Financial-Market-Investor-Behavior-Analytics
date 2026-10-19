# FinSight monitoring boundary

The ingestion gateway exposes Prometheus text at `/metrics`. It currently exports accepted, rejected and Kafka publish-failure counters. Bronze jobs persist immutable per-run quality counters under `bronze/_runs/<run_id>.json`; the platform owner should expose those counters through the shared exporter as `finsight_bronze_quality_records_total` and the latest provider event timestamp as `finsight_market_event_timestamp_seconds`.

Import `dashboards/finsight-overview.json` into Grafana and load `alerts/finsight-rules.yaml` into Prometheus or the platform's rule manager. Alert thresholds are intentionally conservative defaults and must be reviewed against the actual provider SLA, Kafka lag budget and university retention policy.

The dashboard and alerts do not claim metrics until the relevant exporter is deployed. The local gateway `/metrics` endpoint and Bronze run JSON are the measured sources for Member A.
