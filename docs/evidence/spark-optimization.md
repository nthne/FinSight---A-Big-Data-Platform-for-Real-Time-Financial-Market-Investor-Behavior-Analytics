# Person B: Spark Join and Optimization Evidence

**Owner:** Person B · **Status:** reproducible experiment code and plan
assertions are in place; workload measurements are pending.

## Experiments provided

| Experiment | Implementation | Current evidence |
| --- | --- | --- |
| Small dimension join | `broadcast_asset_join` forces a broadcast hint | Unit test asserts `BroadcastHashJoin` appears in the physical plan |
| Large quote/trade fact join | `sort_merge_quote_trade_join` applies merge hints to both inputs | Unit test asserts `SortMergeJoin` appears in the physical plan |
| Multi-join baseline vs optimized | `multi_join_pipeline(optimized=False/True)` and `compare_join_variants` | Deterministic fixture checks equal row counts and stores physical and formatted plans |
| Cache lifecycle | `benchmark_cached_frame` uses `MEMORY_AND_DISK` and releases the cache in `finally` | Runtime path is covered by helper design; a workload comparison is pending |
| Catalog-backed bucketing | `persist_bucketed_table` plus `spark/conf/catalog.conf` | Requires a persistent Hive metastore and representative join benchmark; not yet measured |
| Adaptive Query Execution | `enable_aqe` configures AQE and partition coalescing | Must be compared on the same replay workload; no result claimed |

## Reproduction

```powershell
python -m pytest spark/tests/test_join_strategies.py -v
```

`benchmark_frame` records executed and formatted plans, elapsed wall-clock
time, output rows and input-file count. It does not fabricate shuffle or
peak-memory measurements: those fields remain `null` unless collected from
Spark event logs/UI for that exact run.

The optimized helper applies date-not-null filtering, projections,
repartitioning, a merge-hinted fact join and an explicit broadcast of the
small asset dimension. Those are experimental controls, not universal
recommendations. The optimized plan should only be retained for a production
workload if its before/after result and resource measurements support it.

## Pending evidence

- Run the same 1-million-event Silver join data through baseline and optimized
  variants with AQE both disabled and enabled.
- Record Spark 4.0.4, Java/Python versions, driver/executor memory and cores,
  input files/bytes, output rows, runtime, shuffle read/write, spill and peak
  memory.
- Repeat with cache on/off and bucketed/unbucketed tables using the persistent
  metastore. Record the bucket count and verify the actual physical plan.
- Capture the formatted plan and Spark UI/event-log extract with each run.

No local unit-test runtime is presented as distributed performance evidence.
