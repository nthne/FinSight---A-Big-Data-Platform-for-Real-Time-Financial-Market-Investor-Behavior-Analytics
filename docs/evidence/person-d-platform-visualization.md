# Person D platform and visualization evidence

**Evidence date:** 2026-10-25  
**Boundary:** source/configuration and host-local validation on the current machine. Docker was unavailable and `kubectl config current-context` returned no configured context, so this document does not claim a Kubernetes rollout, built-image digest, alert firing, UI screenshot or measured recovery time.

## Delivered artifacts

| Area | Implementation |
| --- | --- |
| Compatibility | `docs/architecture/version-matrix.md`, exact direct Python pins, aligned Spark/Scala/S3A/Mongo/GraphFrames coordinates and a Node/TanStack security patch pin |
| Shared images | Multi-stage Node/Nitro image and Java 21/Spark 4 shared image resolving the Kafka, S3A, MongoDB and GraphFrames JVM artifacts |
| Kubernetes | Namespace configuration, MongoDB with persistent storage, least-privilege users, Spark speed layer with S3A checkpoint lineage, app service, fixture producer, initialization/runtime-smoke jobs and bounded resources/probes |
| Visualization | Authenticated `/analytics` React/Recharts page for quotes, freshness, time series, volatility, Lambda provenance, portfolio risk, educational behavior and administrator-only pipeline health |
| Observability | Prometheus/Grafana/Kafka Exporter manifests, 16 dashboard panels, application/dependency metric endpoints and alert rules |
| Verification | Ten manifest invariant tests plus a read-only/opt-in restart Kubernetes smoke harness |
| Operations | Ordered deployment guide, integrated demo/failure runbook and acceptance traceability matrix |

The UI has explicit loading, empty, dependency-error and stale states. It reads MongoDB through the authenticated server API and does not expose Mongo credentials or calculate Spark outputs in the browser. Batch values are labeled authoritative and speed-layer values provisional so Lambda reconciliation is visible rather than silently merged.

## Commands and observed results

| Command or check | Result |
| --- | --- |
| `npm ci` | Passed; 624 packages installed. A compatible lockfile-only audit fix reduced the full install to 12 advisories (10 moderate, 2 high, 0 critical). `npm audit --omit=dev` reports 7 production advisories (5 moderate, 2 high, 0 critical). The remaining fixes require breaking Nitro/Cloudflare or Zod changes; no forced or major-version rewrite was applied. |
| `npm run build` | Passed after pinning TanStack Start 1.168.60; Nitro generated `.output/server/index.mjs`. Existing deprecation and large-chunk warnings remain non-fatal. |
| Production Node server + `GET /api/health` | Passed on localhost; endpoint returned healthy process state. |
| Production Node server + `GET /api/metrics` without Mongo configuration | Passed with honest degraded dependency state, including `finsight_mongodb_up 0`; the endpoint did not report a false-green dependency. |
| Scoped ESLint for Person D TypeScript/TSX and Vite files | Passed. |
| `python -m pytest tests/platform/test_kubernetes_manifests.py ingestion/tests storage/tests serving/tests tests/data_quality -q` | 45 passed, 7 skipped, 1 warning in 2.93 seconds. The seven Mongo integration skips require `FINSIGHT_TEST_MONGO_URI`. |
| `node --test --experimental-strip-types tests/platform/app_metrics.test.ts ingestion/tests/*.test.ts` | 8 passed, including unique metric-label and sensitive-label sanitization coverage. |
| YAML parse and platform invariants | Passed through the platform suite: namespace, resources, probes, persistence, service boundaries, secret wiring, checkpoint lineage, dashboard coverage and version alignment. |
| Full-repository `npm run lint` | Did not pass: the existing tree reports hundreds of unrelated/pre-existing formatting and type-rule findings. Person D's changed frontend files pass the scoped check. |
| Shared Spark/App image builds | Not run: Docker daemon was unavailable. No image digest is claimed. |
| Kubernetes apply/DNS/restart/alert scenarios | Not run: no Kubernetes context was configured. No recovery duration is claimed. |
| Spark/GraphFrames import smoke on the shared image | Not run because the image could not be built. The coordinates are statically aligned but runtime compatibility remains a release gate. |

## Security and operational decisions

- The app receives only a MongoDB reader URI; the stream receives a writer URI; database administration is isolated to setup jobs.
- Real secrets remain outside source control. The example contains placeholders, and the app image never accepts the Supabase server secret as a build argument.
- Metrics expose aggregate routes/statuses and pipeline health, not tokens, URIs, symbols or user identifiers.
- Stateful Kafka, MinIO, MongoDB, Prometheus and Grafana boundaries use PVCs where appropriate; normal restart instructions never delete persistent state.
- The deployed profile is intentionally single-node coursework infrastructure. It is not production HA and needs TLS, replicas, backups/restore testing and a maintained S3-compatible provider decision before production.

## Release gates left for a cluster-enabled machine

1. Build all images, capture immutable IDs/digests and execute the shared runtime-import smoke.
2. Apply the ordered Kubernetes profile and prove service discovery and storage classes.
3. Run the authenticated vertical slice through Kafka, MinIO, Spark, MongoDB and `/analytics`.
4. Fire and resolve an alert, run the bounded speed-layer restart and reconcile final MongoDB counts/digests.
5. Capture an accessibility/visual QA pass and screenshots with real serving data.
6. Triage the remaining npm advisories without bypassing peer compatibility.

