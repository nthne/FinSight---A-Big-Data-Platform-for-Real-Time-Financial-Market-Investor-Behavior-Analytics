# FinSight runtime and connector matrix

**Baseline frozen:** 2026-10-25. The matrix favors the versions already exercised by the ingestion and speed-layer workstreams. A version change requires a clean image rebuild plus contract, S3A, streaming-restart and serving smoke tests.

| Boundary | Pinned version / coordinate | Compatibility decision | Verification state |
| --- | --- | --- | --- |
| Java | Eclipse Temurin 21, image `eclipse-temurin:21-jre-noble` | Spark 4.0.4 supports Java 17/21. | Speed image resolved OpenJDK 21.0.12.1 in the recorded Person C run; shared image rebuild pending a Docker daemon. |
| Python | 3.12 in images; project range `>=3.12,<3.14` | Spark supports Python 3.9+, while GraphFrames 0.12.3 is tested through Python 3.13. Python 3.14 is deliberately excluded. | Dependency metadata is locked; image import smoke pending. |
| Node.js | 22.23.0, image `node:22.23.0-bookworm-slim` | LTS line used by the successful API evidence. Nitro `node-server` is required for the MongoDB TCP driver. | `npm ci` and host build pass; image build pending Docker. |
| Apache Spark / PySpark | 4.0.4 / Scala 2.13 | Spark 4 uses Scala 2.13. | Structured Streaming integration previously passed on Spark 4.0.4. |
| Kafka broker | `apache/kafka:4.3.1` | KRaft single-broker profile for coursework; production requires replication. | Kafka-to-MinIO and streaming integration previously passed. |
| Spark Kafka connector | `org.apache.spark:spark-sql-kafka-0-10_2.13:4.0.4` | Exact Spark and Scala binary match. | Previously resolved and exercised by speed layer. |
| Hadoop S3A | `org.apache.hadoop:hadoop-aws:3.4.1` | Hadoop 3.4.1 uses AWS SDK v2 and supports third-party S3 endpoints; path-style access is enabled for MinIO. | Read/write/checkpoint paths previously exercised. |
| MongoDB | `mongo:8.0.34` | Serves deterministic upserts and analytics reads. | Local restart/replay evidence passes. |
| MongoDB Spark Connector | `org.mongodb.spark:mongo-spark-connector_2.13:11.1.0` | Connector 11.1 supports Spark 4.0+ and MongoDB 4.2+. | Coordinate frozen in shared image; batch connector smoke pending Person B workload. |
| PyMongo | 4.15.3 | Used by `foreachBatch`, setup and smoke tools. | Unit and local integration evidence passes on the 4.x line; exact shared-image import pending. |
| GraphFrames | Python `graphframes-py==0.12.3`; JVM `io.graphframes:graphframes-spark4_2.13:0.12.3` | Spark-4/Scala-2.13 artifact selected explicitly. | Coordinate frozen; graph algorithm smoke remains Person B's gate. |
| MinIO | source release `RELEASE.2025-10-15T17-29-55Z` via `finsight-minio:course` | Coursework-only S3-compatible target; licensing/provider approval remains a production gate. | Object-store and Bronze evidence passes. |
| React / TanStack | React 19.2.0; TanStack Start 1.168.60; Vite 7.3.7 resolved by lockfile | Existing application retained. TanStack Start is pinned to the first locally compatible patch beyond the reported critical advisory range. Local/container build uses Nitro Node server; hosted Lovable builds keep their forced Cloudflare preset. | `npm ci` and `npm run build` pass on 2026-10-25. `npm audit --omit=dev` reports 7 production advisories (5 moderate, 2 high, 0 critical); the remaining Nitro/Miniflare/Undici and Zod fixes require breaking-version changes and remain release gates rather than forced upgrades. |
| Kubernetes CLI/profile | kubectl 1.36.1; manifests `apps/v1`, `batch/v1` | Uses stable APIs, PVCs, probes and bounded resources. | Client schema/unit validation is available; no cluster context was configured on 2026-10-25. |

## Sources and rules

- [Spark 4.0.4 documentation](https://spark.apache.org/docs/4.0.4/index.html) records Java 17/21, Scala 2.13 and Python 3.9+ support.
- [GraphFrames installation](https://graphframes.io/02-quick-start/01-installation.html) defines the Spark-4/Scala-2.13 coordinate and Python package used above.
- [MongoDB Spark Connector compatibility](https://www.mongodb.com/docs/spark-connector/current/) states that connector 11.1 supports Spark 4.0+ and MongoDB 4.2+.
- [Hadoop 3.4.1 S3A documentation](https://hadoop.apache.org/docs/r3.4.1/hadoop-aws/tools/hadoop-aws/connecting.html) is authoritative for the third-party S3 endpoint boundary.

Do not treat a successful dependency resolution as an end-to-end compatibility proof. The release gate is the component smoke test using the built image, followed by the Kubernetes restart/replay scenario.
