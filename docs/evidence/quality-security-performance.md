# Member A quality, security and performance evidence

## Verification commands

| Boundary | Command | Result |
| --- | --- | --- |
| Python ingestion and storage | `python -m pytest ingestion/tests storage/tests tests/data_quality -q --basetemp .codex_tmp/pytest_quality` | 24 passed on 2026-10-19 |
| TypeScript server producers | `node --test --experimental-strip-types ingestion/tests/*.test.ts` | 6 passed |
| Application build | `npm.cmd run build` | passed |
| Deployment YAML | `python -c "import pathlib,yaml; [list(yaml.safe_load_all(p.read_text())) for p in pathlib.Path('deploy').rglob('*.y*ml')]"` | passed |

## Scale baseline

The required one-million-event local generation baseline completed with the repository scale harness on 2026-10-19:

- Events and accepted: 1,000,000 / 1,000,000
- Rejected: 0
- Generated input bytes: 272,750,000
- Runtime: 73.018480 seconds
- Generation rate: 13,695.16 events/second
- Sampled p95 event-generation latency: 0.1238 ms across 100,000 samples
- Peak Python allocation reported by `tracemalloc`: 3,202,846 bytes

This is a bounded event-generation measurement, not an end-to-end Kafka/Spark/MinIO throughput claim. The Docker end-to-end run is recorded separately in `docs/evidence/member-a-ingestion-storage.md`.

## Security checks

- User IDs are SHA-256 pseudonyms with a server-side salt; the browser never receives the salt or gateway token.
- Application events are sent from server functions and the market refresh Edge Function, not from browser code.
- Gateway requests require `x-ingestion-token`; invalid events are rejected and copied to the dead-letter topic.
- The data-quality suite scans tracked text files for private-key, AWS-key and live API-key patterns.
- Real Kubernetes secrets are ignored; only `deploy/k8s/secrets.example.yaml` is committed.

## Limitations and human gates

- `kubectl` cannot be verified until a cluster context exists.
- Supabase production requires `INGESTION_GATEWAY_URL` and `INGESTION_GATEWAY_TOKEN` secrets before market refresh events are enabled.
- The MinIO source-built image is for isolated coursework only; a human owner must choose the maintained S3-compatible provider, licensing and retention policy before production.
