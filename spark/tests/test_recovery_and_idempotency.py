"""Task 7 evidence: checkpoint restart, replay and retry produce identical serving data.

Run: python -m pytest spark/tests/test_recovery_and_idempotency.py -v
"""

from __future__ import annotations

import pytest
from pyspark.errors import StreamingQueryException

from serving.mongo_sink import ASSET_TIME_SERIES, LATEST_MARKET, PIPELINE_METRICS
from spark.jobs.streaming.common import SinkTarget, start_foreach_batch
from spark.jobs.streaming.market_stream import market_batch_writer, market_events, market_window_metrics, start_market_queries
from spark.lib.streaming_config import MARKET_1M
from spark.lib.streaming_sources import file_source
from spark.tests.events import AVAILABLE_NOW, MARKET_BATCHES, write_batches

# Fields that depend on wall-clock time or execution, not on the input events.
VOLATILE = {"computed_at", "first_computed_at", "batch_id", "data_freshness_seconds", "query_name", "run_id"}


def snapshot(db, collection):
    return {
        doc["_id"]: {k: v for k, v in doc.items() if k not in VOLATILE}
        for doc in db[collection].find({})
    }


def run_market_1m(spark, input_dir, cfg, db):
    raw = file_source(spark, str(input_dir))
    for query in start_market_queries(raw, cfg, SinkTarget(cfg, db), ["market_1m"], trigger=AVAILABLE_NOW):
        query.awaitTermination()


@pytest.fixture
def reference(spark, tmp_path, make_cfg, make_db):
    """Serving documents of one uninterrupted run over all three batches."""
    write_batches(tmp_path / "ref_input", MARKET_BATCHES)
    db = make_db()
    run_market_1m(spark, tmp_path / "ref_input", make_cfg("reference"), db)
    return db, snapshot(db, ASSET_TIME_SERIES), snapshot(db, LATEST_MARKET)


def test_restart_from_checkpoint_matches_uninterrupted_run(spark, tmp_path, make_cfg, make_db, reference):
    _, ref_series, ref_latest = reference
    cfg, db = make_cfg("restart"), make_db()
    input_dir = tmp_path / "restart_input"

    write_batches(input_dir, MARKET_BATCHES[:2])
    run_market_1m(spark, input_dir, cfg, db)  # first process run stops after two batches
    write_batches(input_dir, MARKET_BATCHES[2:], start_index=2)
    run_market_1m(spark, input_dir, cfg, db)  # restarted with the same checkpoint

    assert snapshot(db, ASSET_TIME_SERIES) == ref_series
    assert snapshot(db, LATEST_MARKET) == ref_latest


def test_replaying_the_same_events_creates_no_duplicates(spark, tmp_path, make_cfg, reference):
    db, ref_series, ref_latest = reference
    # A new checkpoint over the same input = replaying the topic from the earliest offset.
    run_market_1m(spark, tmp_path / "ref_input", make_cfg("replay"), db)

    assert snapshot(db, ASSET_TIME_SERIES) == ref_series
    assert snapshot(db, LATEST_MARKET) == ref_latest
    replay_sink = list(db[PIPELINE_METRICS].find({"kind": "sink", "query_name": "market_1m", "attempts": {"$gte": 2}}))
    assert replay_sink, "replayed batches should be recorded as repeated attempts"
    assert all(d["results"][ASSET_TIME_SERIES]["upserted"] == 0 for d in replay_sink)


def test_batch_retried_after_a_crash_does_not_duplicate(spark, tmp_path, make_cfg, make_db, reference):
    _, ref_series, ref_latest = reference
    cfg, db = make_cfg("crash"), make_db()
    write_batches(tmp_path / "crash_input", MARKET_BATCHES)
    target = SinkTarget(cfg, db)

    def start(fn):
        events = market_events(file_source(spark, str(tmp_path / "crash_input")), cfg)
        metrics = market_window_metrics(events, MARKET_1M, cfg.watermark_delay)
        return start_foreach_batch(metrics, name="market_1m", cfg=cfg, output_mode="update", fn=fn, trigger=AVAILABLE_NOW)

    writer = market_batch_writer(target, "market_1m")

    def crash_after_writing_batch_1(batch_df, batch_id):
        writer(batch_df, batch_id)
        if batch_id == 1:
            raise RuntimeError("simulated executor loss after the MongoDB write, before the commit")

    with pytest.raises(StreamingQueryException):
        start(crash_after_writing_batch_1).awaitTermination()

    start(writer).awaitTermination()  # restart: Spark re-runs batch 1 from the checkpoint

    assert snapshot(db, ASSET_TIME_SERIES) == ref_series
    assert snapshot(db, LATEST_MARKET) == ref_latest
    retried = db[PIPELINE_METRICS].find_one({"_id": "sink|market_1m|test|1"})
    assert retried["attempts"] == 2
