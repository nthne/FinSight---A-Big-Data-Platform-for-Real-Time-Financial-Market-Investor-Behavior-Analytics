from datetime import datetime, timedelta, timezone

from serving.mongo_sink import SinkSettings, record_batch_metrics, to_bson, write_docs

T = datetime(2026, 10, 5, 10, 0, tzinfo=timezone.utc)


def settings(collection, **kw):
    return SinkSettings(mongo_uri="unused", database="unused", collection=collection, query_name="q", run_id="r", **kw)


def window_docs(close):
    return [
        {"_id": "speed|mkt|AAPL|1m|2026-10-05T10:00:00Z", "close": close, "last_event_time": T},
        {"_id": "speed|mkt|MSFT|1m|2026-10-05T10:00:00Z", "close": 300.0, "last_event_time": T},
    ]


def test_rewriting_the_same_batch_is_idempotent(mongo_db):
    coll = mongo_db["series"]
    first = write_docs(coll, window_docs(101.0), settings("series", layer="speed"), batch_id=3, computed_at=T)
    again = write_docs(coll, window_docs(101.0), settings("series", layer="speed"), batch_id=3, computed_at=T + timedelta(seconds=5))

    assert (first.upserted, first.matched) == (2, 0)
    assert (again.upserted, again.matched) == (0, 2)
    assert coll.count_documents({}) == 2
    doc = coll.find_one({"_id": "speed|mkt|AAPL|1m|2026-10-05T10:00:00Z"})
    assert doc["close"] == 101.0 and doc["provisional"] is True and doc["layer"] == "speed"
    assert doc["first_computed_at"] == T  # kept from the first write
    assert doc["data_freshness_seconds"] == 5.0


def test_update_mode_overwrites_with_the_newer_aggregate(mongo_db):
    coll = mongo_db["series"]
    write_docs(coll, window_docs(101.0), settings("series", layer="speed"), batch_id=1, computed_at=T)
    write_docs(coll, window_docs(103.0), settings("series", layer="speed"), batch_id=2, computed_at=T)
    assert coll.find_one({"_id": "speed|mkt|AAPL|1m|2026-10-05T10:00:00Z"})["close"] == 103.0
    assert coll.count_documents({}) == 2


def test_guarded_upsert_never_moves_backwards(mongo_db):
    coll = mongo_db["latest"]
    guarded = settings("latest", guard_field="last_event_time")
    newer = {"_id": "AAPL", "last_price": 110.0, "last_event_time": T + timedelta(minutes=12)}
    older = {"_id": "AAPL", "last_price": 108.0, "last_event_time": T + timedelta(minutes=5)}

    assert write_docs(coll, [newer], guarded, 1, T).upserted == 1
    result = write_docs(coll, [older], guarded, 2, T)
    assert result.stale_skipped == 1 and result.modified == 0
    assert write_docs(coll, [newer], guarded, 3, T).matched == 1  # same value again is accepted
    assert coll.find_one({"_id": "AAPL"})["last_price"] == 110.0


def test_batch_metrics_count_attempts(mongo_db):
    coll = mongo_db["metrics"]
    for _ in range(2):
        record_batch_metrics(coll, kind="sink", query_name="q", run_id="r", batch_id=7, values={"rows": 4})
    doc = coll.find_one({"_id": "sink|q|r|7"})
    assert doc["attempts"] == 2 and doc["rows"] == 4


def test_to_bson_converts_naive_local_datetimes_to_utc():
    naive_local = T.astimezone().replace(tzinfo=None)  # what PySpark hands to Python
    assert to_bson({"t": naive_local})["t"] == T
