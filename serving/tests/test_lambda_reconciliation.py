from datetime import datetime, timedelta, timezone

import pytest

from serving.keys import market_series_key, serving_id
from serving.lambda_reconciliation import (
    dataset_id,
    prune_superseded_speed,
    publish_batch_cutoff,
    read_cutoff,
    reconcile,
    serving_filter,
)

T = datetime(2026, 10, 5, 10, 0, tzinfo=timezone.utc)


def window(layer, minute, count):
    start = T + timedelta(minutes=minute)
    key = market_series_key("AAPL", "1m", start)
    return {
        "_id": serving_id(layer, key),
        "series_key": key,
        "layer": layer,
        "asset_symbol": "AAPL",
        "granularity": "1m",
        "window_start": start,
        "window_end": start + timedelta(minutes=1),
        "quote_count": count,
    }


# Batch has recomputed 10:00-10:03 (and wrote 10:03 ahead of its cutoff);
# speed has provisional values for 10:01-10:05. The batch count for 10:01
# includes a too-late event that the speed layer dropped.
DOCS = [
    window("batch", 0, 3),
    window("batch", 1, 2),
    window("batch", 2, 4),
    window("batch", 3, 9),
    window("speed", 1, 1),
    window("speed", 2, 4),
    window("speed", 3, 5),
    window("speed", 4, 6),
]
CUTOFF = T + timedelta(minutes=3)  # batch complete for windows ending <= 10:03


def served(docs, cutoff):
    return [(d["window_start"].minute, d["layer"], d["quote_count"]) for d in reconcile(docs, cutoff)]


def test_each_window_comes_from_exactly_one_layer():
    assert served(DOCS, CUTOFF) == [
        (0, "batch", 3),
        (1, "batch", 2),  # authoritative value replaces the provisional 1
        (2, "batch", 4),
        (3, "speed", 5),  # beyond the cutoff: the uncommitted batch doc is ignored
        (4, "speed", 6),
    ]


def test_without_a_published_cutoff_only_speed_is_served():
    assert [layer for _, layer, _ in served(DOCS, None)] == ["speed"] * 4


def test_reconcile_detects_double_counting():
    with pytest.raises(ValueError):
        reconcile([window("speed", 5, 1), window("speed", 5, 2)], CUTOFF)


def test_mongo_filter_matches_the_in_memory_rule(plain_db):
    coll = plain_db["asset_time_series_summary"]
    coll.insert_many([dict(d) for d in DOCS])
    for cutoff in (None, CUTOFF, T, T + timedelta(minutes=10)):
        from_mongo = coll.find(serving_filter(cutoff, {"asset_symbol": "AAPL"}))
        assert sorted(d["_id"] for d in from_mongo) == sorted(d["_id"] for d in reconcile(DOCS, cutoff))


def test_cutoff_only_moves_forward(mongo_db):
    state = mongo_db["lambda_state"]
    ds = dataset_id("market", "1m")
    assert read_cutoff(state, ds) is None
    assert publish_batch_cutoff(state, ds, CUTOFF, "batch-2")
    assert publish_batch_cutoff(state, ds, CUTOFF, "batch-2")  # idempotent re-publish
    assert not publish_batch_cutoff(state, ds, T, "batch-1")  # an older run cannot move it back
    assert read_cutoff(state, ds) == CUTOFF
    assert state.find_one({"_id": ds})["batch_run_id"] == "batch-2"


def test_prune_superseded_speed_documents(plain_db):
    coll = plain_db["asset_time_series_summary"]
    coll.insert_many([dict(d) for d in DOCS])
    deleted = prune_superseded_speed(coll, CUTOFF, timedelta(minutes=1), {"granularity": "1m"})
    assert deleted == 1  # speed 10:01 (ends 10:02 <= cutoff - grace)
    assert coll.count_documents({"layer": "speed"}) == 3
