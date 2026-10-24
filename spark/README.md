# Spark Batch and Advanced Analytics

This directory contains Person B's Spark batch workstream. It reads Person A's
Bronze Parquet files, validates the frozen event envelope, writes normalized
Silver data, then produces reproducible Gold analytics. It does not replace or
change the existing Structured Streaming jobs.

## Runtime

- Python 3.11 and Java 21 are the recorded project runtime.
- PySpark 4.0.4 is pinned by the existing streaming image and development
  environment.
- Set `PYSPARK_PYTHON` to the interpreter that has PySpark installed.
- The batch job needs no Kafka or MongoDB connector; its input is Bronze
  Parquet. MinIO/S3A access uses the Spark S3A settings in
  `storage/minio/spark-defaults.conf`; set `SPARK_CONF_DIR` to the directory
  containing that file and provide the AWS-compatible credentials through
  environment variables/cluster Secrets. For an `s3a://` batch path, the
  launcher resolves the pinned `hadoop-aws:3.4.1` package.
- The optional GraphFrames runtime requires
  `pip install -r spark/requirements-analytics.txt` and the matching Maven
  coordinate `io.graphframes:graphframes-spark4_2.13:0.12.3`. Resolve the JVM
  package with `spark-submit --packages` in an environment permitted to fetch
  Maven artifacts.

## Batch run

```powershell
python -m spark.jobs.batch.market_batch `
  --input s3a://fin-sight/bronze `
  --output s3a://fin-sight `
  --run-id 2026-10-24-baseline `
  --start-date 2026-10-01 `
  --end-date 2026-10-24 `
  --config spark/batch-config.example.json
```

Input date bounds are inclusive and applied to Bronze `event_date`. `run_id`
is restricted to letters, numbers, dot, underscore and dash. Reusing a run ID
rebuilds only that run's Silver, rejected, Gold and metadata paths; do not reuse
one while another job is writing it.

Outputs:

- `silver/run_id=<run-id>/event_type=.../event_date=...`: normalized events,
  deduplicated by event ID.
- `quality/rejected/run_id=<run-id>/...`: invalid and duplicate rows with a
  stable `quality_error` code and original Bronze fields.
- `gold/<dataset>/run_id=<run-id>/...`: market time series/daily summaries,
  rollup/cube, source pivot, long-form metrics, portfolio risk and user
  behavior features.
- `_runs/<run-id>`: one JSON line with input partitions, counts, configuration,
  code version, accepted event-type/rejected-rule counters and output
  locations.
  `code_version` uses `GIT_COMMIT` when supplied; otherwise it records a SHA-256
  digest of the Spark Python source tree.
  Credential-bearing paths are rejected and secret-like configuration keys are
  redacted in run metadata; provide storage credentials through Spark's secret
  configuration, not the JSON config file.

All Parquet outputs use Snappy compression. The market job records the
partition range and row counts, applies deterministic event-ID de-duplication,
and persists the normalized frame only while its dependent outputs are built.
`market_rolling_rows` controls the observation count in rolling market
statistics; the example config also supplies the allowlist used for unknown
symbol rejection. The session time zone is pinned to UTC by the batch runner.

## Advanced analytics and plan evidence

`spark.jobs.analytics.behavior_ml.train_investor_segments` builds a scaled
MLlib KMeans model from documented Gold features and returns assignments,
cluster profiles, silhouette and model metadata. `classify_behavior` is a
Spark UDF that emits only educational activity signals; these labels are not
diagnoses or recommendations.

`spark.jobs.analytics.market_graph.build_interaction_graph` constructs
pseudonymous investor-to-asset edges and computes degree, PageRank and label
propagation. It fails explicitly if the pinned GraphFrames runtime is not
available. The graph is not run implicitly as part of the regular batch job,
because GraphFrames requires an additional Spark package.

After running the batch job, run the advanced outputs with GraphFrames
available to `spark-submit`:

```powershell
spark-submit `
  --packages io.graphframes:graphframes-spark4_2.13:0.12.3,org.apache.hadoop:hadoop-aws:3.4.1 `
  spark/jobs/analytics/advanced_batch.py `
  --features s3a://fin-sight/gold/portfolio_behavior_features/run_id=2026-10-24-baseline `
  --silver s3a://fin-sight/silver/run_id=2026-10-24-baseline `
  --output s3a://fin-sight `
  --run-id 2026-10-24-baseline
```

The join experiment helpers expose explicit broadcast and sort-merge joins.
`benchmark_frame` records wall-clock runtime, row count, input files and the
physical plan. Shuffle bytes and peak memory remain null unless Spark
event-log/UI instrumentation is available; they must not be inferred from
runtime alone. `benchmark_cached_frame` releases its persisted frame in a
`finally` block. `persist_bucketed_table` requires a persistent Hive
metastore, configured using `spark/conf/catalog.conf`.

## Tests

```powershell
python -m pytest spark/tests/test_batch_transformations.py `
  spark/tests/test_join_strategies.py `
  spark/tests/test_advanced_analytics.py -v
```

Run the entire Spark suite with:

```powershell
python -m pytest spark/tests -v
```

To execute the GraphFrames integration test, install the Python wrapper and
start pytest with its compatible Spark package:

```powershell
python -m pip install -r spark/requirements-analytics.txt
$env:FINSIGHT_TEST_GRAPHFRAMES = "1"
$env:PYSPARK_SUBMIT_ARGS = "--packages io.graphframes:graphframes-spark4_2.13:0.12.3 pyspark-shell"
python -m pytest spark/tests/test_advanced_analytics.py -v
```

The test implementation and pending verification items are tracked in
`docs/evidence/advanced-analytics.md`.
