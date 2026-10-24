# Person B: Batch and Advanced Analytics Evidence

**Owner:** Person B · **Status:** implementation and deterministic tests are
authored; test execution, container-scale and cluster measurements remain
pending.

## Implemented

- Bronze Parquet input is filtered by inclusive `event_date`, parsed against
  the frozen 1.0.0 envelope, normalized, validated and deterministically
  deduplicated by `event_id`.
- Accepted Silver rows and rejected/duplicate rows are written separately as
  Snappy Parquet. Run metadata records source partitions, input/accepted/
  rejected counts, configuration, code version and output locations.
- Market Gold includes event-level return, moving average, sample volatility,
  z-score, drawdown, return/volume rolling correlation, daily OHLC/volume,
  weighted volatility, `rollup`, `cube`, source pivot and long-form metrics.
- Portfolio analytics include snapshot drawdown and volatility, trade
  frequency/turnover, buy/sell counts, concentration HHI computed from
  executed-trade notional (a proxy, not current holdings), action counts and
  model feature lineage.
- MLlib uses standardized KMeans features, a fixed seed, silhouette
  evaluation, cluster profiles and explicit educational-use metadata.
- GraphFrames workflow builds pseudonymous user-to-asset edges and reports
  degree, PageRank and label-propagation communities.
- Join helpers expose broadcast and sort-merge strategies. Benchmark records
  include physical plans, wall-clock runtime, row counts and input file counts.
  Bucketed writes require the persistent Hive metastore settings in
  `spark/conf/catalog.conf`.

## Reproducible local checks

```powershell
python -m pytest spark/tests/test_batch_transformations.py `
  spark/tests/test_join_strategies.py `
  spark/tests/test_advanced_analytics.py -v
```

The tests compare deterministic Spark outputs with reference calculations,
exercise invalid and duplicate event handling, verify physical join operators,
and check model metadata. The graph test runs GraphFrames metrics when its
Python package and Spark jar are available and
`FINSIGHT_TEST_GRAPHFRAMES=1`; otherwise it verifies the missing Python
dependency diagnostic or skips the cluster-dependent graph execution.

In this checkout, these tests have not been executed: the configured Python
environment lacks PySpark and pytest, the attempted PySpark download remained
zero bytes, and no Docker daemon or `spark-submit` is available. Python syntax
compilation and `git diff --check` pass.

## Measurement boundary and remaining evidence

No Spark throughput, p95 latency, shuffle, peak-memory, cluster-scaling or
GraphFrames execution result is claimed by this document. The repository has
a Person A 1-million-event generation benchmark, but event generation is not
a Spark batch benchmark and cannot be substituted for one.

Required follow-up measurements:

1. Run the batch job on the 1-million-event Bronze replay and record input
   size, executor/driver resources, runtime, processed rows and rejected rows.
2. Compare baseline and optimized broadcast/sort-merge/multi-join plans on the
   same data. Capture Spark UI/event-log shuffle and peak-memory metrics.
3. Compare cached/non-cached and catalog-bucketed/non-bucketed runs only after
   the persistent metastore is configured; keep each optimization only if the
   measured workload improves.
4. Execute the GraphFrames package on the target Spark image and record graph
   size, algorithm settings and output counts.
5. Record KMeans silhouette and cluster profiles from the replay data; cluster
   numbers are arbitrary and must not be interpreted as investor diagnoses.

These steps are intentionally marked pending until run in the target Spark
environment; the test fixture outputs are correctness checks, not performance
claims.
