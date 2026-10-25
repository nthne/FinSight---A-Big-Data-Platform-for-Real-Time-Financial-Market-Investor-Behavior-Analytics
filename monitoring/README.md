# FinSight monitoring

The shared dashboard covers ingestion, Kafka lag, Structured Streaming progress, watermark/state, late and invalid events, MongoDB latency, analytics API errors and Kubernetes resource saturation. Panels remain empty when their named exporter is not deployed; an empty panel is not evidence of a zero value.

## Metric ownership

| Owner | Source | Metrics |
| --- | --- | --- |
| Person A | ingestion gateway `/metrics` | accepted/rejected events and Kafka publish failures |
| Person A | Bronze run metadata (evidence, not scraped) | accepted/rejected/duplicate/null/unknown-symbol counters; a Prometheus exporter remains a follow-up |
| Person B | batch job metrics/evidence | batch duration, shuffle, input/output rows and model/job status |
| Person C | `pipeline_quality_metrics` in MongoDB | input/processing rate, trigger duration, watermark, state rows, dropped/late/invalid events and sink outcomes |
| Person D | app `/api/metrics`; Kubernetes/Prometheus exporters | API requests/errors, MongoDB ping latency, latest served market-event time, application uptime, Kafka lag and cluster resources |

The application exporter intentionally contains no user IDs, symbols, tokens or database URI. Its counters are process-local and reset after a pod restart. Prometheus treats that as a counter reset. Spark metrics are the latest persisted `StreamingQueryProgress` documents, so they survive an app restart.

## Kubernetes deployment

Create the real secrets file, then provision the dashboard ConfigMap from the tracked JSON before applying `monitoring.yaml`:

```bash
kubectl -n finsight create configmap finsight-grafana-dashboard \
  --from-file=finsight-overview.json=monitoring/dashboards/finsight-overview.json \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n finsight create configmap finsight-prometheus-rules \
  --from-file=finsight-rules.yaml=monitoring/alerts/finsight-rules.yaml \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f deploy/k8s/monitoring.yaml
kubectl -n finsight rollout status deployment/prometheus deployment/grafana
kubectl -n finsight port-forward service/grafana 3001:3000
```

Grafana is available at `http://localhost:3001`. Its admin password comes from `finsight-platform-secrets`; change the example value before applying. Prometheus is available through `kubectl -n finsight port-forward service/prometheus 9090:9090`.

`deploy/k8s/monitoring.yaml` deploys Kafka Exporter. Kubernetes CPU, volume and job panels additionally require kube-state-metrics and kubelet/cAdvisor scraping supplied by the cluster or its managed monitoring stack. The dashboard never substitutes invented values when those sources are absent.

## Alert validation

Load `alerts/finsight-rules.yaml` into `promtool` or the target rule manager and check it before deployment:

```bash
promtool check rules monitoring/alerts/finsight-rules.yaml
```

For a bounded application fault, scale `finsight-app` to zero, wait for `FinSightApplicationDown`, then restore one replica and record alert firing/resolution timestamps. For streaming recovery, use the controlled restart in `docs/demo/runbook.md`; do not delete the MinIO checkpoint path.

Thresholds are conservative coursework defaults. Review them against actual provider SLA, Kafka retention, hardware and volume sizes before a non-course deployment.
