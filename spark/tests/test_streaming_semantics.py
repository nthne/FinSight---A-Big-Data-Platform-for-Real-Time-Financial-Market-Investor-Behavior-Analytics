"""Task 6 evidence: validation, windows, watermark, late data and output modes.

Run: python -m pytest spark/tests/test_streaming_semantics.py -v
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest

from serving.keys import market_series_key, serving_id
from serving.mongo_sink import ASSET_TIME_SERIES, LATEST_MARKET, PIPELINE_METRICS, STREAM_STATE, USER_ACTIVITY, USER_SESSIONS
from spark.jobs.streaming.behavior_stream import start_behavior_queries
from spark.jobs.streaming.common import SinkTarget, start_foreach_batch
from spark.jobs.streaming.event_gate import event_type_totals, start_gate_queries
from spark.jobs.streaming.market_stream import market_events, market_window_metrics, start_market_queries
from spark.lib.envelope import ERROR_CODES, parse_events
from spark.lib.lateness import ACCEPTED_LATE, ON_TIME, TOO_LATE, BatchMarks, GroupState, as_utc, classify, spark_ts_to_utc
from spark.lib.progress_listener import progress_as_dict, progress_doc
from spark.lib.streaming_config import MARKET_1M
from spark.lib.streaming_sources import file_source
from spark.tests.events import (
    AVAILABLE_NOW,
    MARKET_BATCHES,
    USER1,
    action,
    at,
    eid,
    envelope,
    portfolio,
    quote,
    trade,
    write_batches,
)


def run_to_end(queries):
    for query in queries:
        query.awaitTermination()
    return queries


def collect_batches(df, *, name, cfg, mode):
    emitted = []

    def fn(batch_df, batch_id):
        emitted.append((batch_id, [r.asDict(recursive=True) for r in batch_df.collect()]))

    query = start_foreach_batch(df, name=name, cfg=cfg, output_mode=mode, fn=fn, trigger=AVAILABLE_NOW)
    query.awaitTermination()
    return emitted, query


def market_input(spark, tmp_path, batches=MARKET_BATCHES):
    write_batches(tmp_path / "input", batches)
    return file_source(spark, str(tmp_path / "input"))


# --- validation -----------------------------------------------------------------


def test_validation_assigns_one_error_code_per_rule(spark):
    t = at(0)
    q = quote("e", "AAPL", t, 100.0)
    tr = trade("e", USER1, "AAPL", t, "buy", 1, 100.0)
    cases = {
        "ok-quote": quote("ok-quote", "AAPL", t, 100.0),
        "ok-quote-offset": {**quote("ok-quote-offset", "AAPL", t, 100.0), "event_time": "2026-10-05T17:00:00.250+07:00"},
        "ok-trade": trade("ok-trade", USER1, "AAPL", t, "buy", 2, 100.0),
        "ok-trade-cancelled": trade("ok-trade-cancelled", USER1, "AAPL", t, "sell", 2, 100.0, status="cancelled"),
        "ok-action": action("ok-action", USER1, t, symbol="AAPL"),
        "ok-portfolio": portfolio("ok-portfolio", USER1, t),
        "MISSING_EVENT_ID": {**q, "event_id": ""},
        "INVALID_EVENT_ID": {**q, "event_id": "q1"},
        "UNKNOWN_EVENT_TYPE": envelope("e", "trade", t, asset_symbol="AAPL", user_id=USER1),
        "UNSUPPORTED_SCHEMA_VERSION": {**q, "schema_version": "1.1.0"},
        "INVALID_EVENT_TIME": {**q, "event_time": "yesterday"},
        "INVALID_EVENT_TIME_NO_ZONE": {**q, "event_time": "2026-10-05T10:00:00"},
        "INVALID_INGESTION_TIME": {k: v for k, v in q.items() if k != "ingestion_time"},
        "FUTURE_EVENT_TIME": quote("e", "AAPL", t, 100.0, ingestion_time=t - timedelta(hours=1)),
        "MISSING_ASSET_SYMBOL": quote("e", None, t, 100.0),
        "INVALID_ASSET_SYMBOL": quote("e", "aapl", t, 100.0),
        "INVALID_ASSET_SYMBOL_SEPARATOR": quote("e", "AA|PL", t, 100.0),
        "UNKNOWN_SYMBOL": quote("e", "ZZZ", t, 100.0),
        "MISSING_USER_ID": trade("e", None, "AAPL", t, "buy", 1, 100.0),
        "INVALID_USER_ID": trade("e", "6f9619ff-8b86-d011-b42d-00c04fc964ff", "AAPL", t, "buy", 1, 100.0),
        "INVALID_PRICE": quote("e", "AAPL", t, -1.0),
        "INVALID_PRICE_STRING": quote("e", "AAPL", t, "100"),
        "INVALID_PRICE_OPEN": {**q, "payload": {**q["payload"], "open_price": -1}},
        "INVALID_PRICE_TRADE": trade("e", USER1, "AAPL", t, "buy", 1, 0.0),
        "INVALID_VOLUME": quote("e", "AAPL", t, 100.0, volume=-5.0),
        "INVALID_CURRENCY": {**q, "payload": {**q["payload"], "currency": "vnd"}},
        "INVALID_SIDE": trade("e", USER1, "AAPL", t, "BUY", 1, 100.0),
        "INVALID_QUANTITY": trade("e", USER1, "AAPL", t, "buy", 0, 100.0),
        "INVALID_FEE": trade("e", USER1, "AAPL", t, "buy", 1, 100.0, fee=-1.0),
        "INVALID_PORTFOLIO_VALUE": portfolio("e", USER1, t, total_value=-1.0, cash_balance=0.0),
        "MISSING_PAYLOAD_FIELD": {**tr, "payload": {k: v for k, v in tr["payload"].items() if k != "total"}},
        "MISSING_PAYLOAD_FIELD_ACTION": envelope("e", "user_action", t, user_id=USER1, payload={"action_type": "view_asset"}),
    }
    rows = [(json.dumps(doc), name) for name, doc in cases.items()] + [("{oops", "MALFORMED_JSON"), ("[1,2]", "MALFORMED_JSON_ARRAY")]
    raw = spark.createDataFrame(rows, "value string, expected string")
    result = {r["expected"]: r for r in parse_events(raw, known_symbols=("AAPL", "MSFT")).collect()}

    def expected_code(name):
        if name.startswith("ok-"):
            return None
        # Case names are "<ERROR_CODE>" or "<ERROR_CODE>_<variant>"; take the longest matching code.
        return max((code for code in ERROR_CODES if name == code or name.startswith(code + "_")), key=len)

    for name, row in result.items():
        assert row["error_code"] == expected_code(name), name
    assert {row["error_code"] for row in result.values()} - {None} == set(ERROR_CODES)  # every rule is exercised
    assert result["ok-quote"]["asset_symbol"] == "AAPL"
    assert result["ok-quote"]["payload"]["close_price"] == 100.0
    assert spark_ts_to_utc(result["ok-quote"]["event_time"]) == at(0)
    assert spark_ts_to_utc(result["ok-quote-offset"]["event_time"]) == at(0) + timedelta(milliseconds=250)


# --- lateness policy (pure Python) ------------------------------------------------


DELAY = timedelta(minutes=10)


def test_lateness_classes_follow_the_watermark_rule():
    marks = BatchMarks(high_water_mark=at(12, 30), late_watermark=at(2))
    assert classify(at(0), BatchMarks(None, None)) == ON_TIME
    assert classify(at(12, 30), marks) == ON_TIME
    assert classify(at(5), marks) == ACCEPTED_LATE
    assert classify(at(2), marks) == TOO_LATE  # exactly at the watermark is late, as in Spark
    assert classify(at(1, 30), marks) == TOO_LATE


def test_late_watermark_lags_one_batch_like_spark():
    state = GroupState().advance(0, at(0, 30)).advance(1, at(12))
    # Batch 2 sees hwm 10:12 but drops only rows older than hwm(before batch 1) - delay.
    assert state.marks_for_batch(2, DELAY) == BatchMarks(at(12), at(0, 30) - DELAY)
    state = state.advance(2, at(12, 30))
    assert state.marks_for_batch(3, DELAY) == BatchMarks(at(12, 30), at(2))


def test_retried_batch_is_classified_against_its_original_marks():
    state = GroupState().advance(0, at(0, 30)).advance(1, at(12))
    assert state.marks_for_batch(1, DELAY) == BatchMarks(at(0, 30), None)  # retry of batch 1
    assert state.advance(1, at(12)) == state  # re-running batch 1 does not move the marks


# --- market windows ------------------------------------------------------------------


def _doc(db, symbol, granularity, minute):
    return db[ASSET_TIME_SERIES].find_one({"_id": serving_id("speed", market_series_key(symbol, granularity, at(minute)))})


def test_market_1m_dedups_and_applies_watermark(spark, tmp_path, cfg, mongo_db):
    raw = market_input(spark, tmp_path)
    (query,) = run_to_end(start_market_queries(raw, cfg, SinkTarget(cfg, mongo_db), ["market_1m"], trigger=AVAILABLE_NOW))

    aapl_10_00 = _doc(mongo_db, "AAPL", "1m", 0)
    # q1, q2, q4: the duplicate q2 is counted once and the too-late q6 (10:01:30) is excluded.
    assert aapl_10_00["quote_count"] == 3
    assert (aapl_10_00["open"], aapl_10_00["high"], aapl_10_00["low"], aapl_10_00["close"]) == (100.0, 102.0, 100.0, 101.0)
    assert aapl_10_00["volume"] == 1500.0  # last cumulative volume (q4), not the sum 3700
    assert aapl_10_00["layer"] == "speed" and aapl_10_00["provisional"] is True
    assert aapl_10_00["window_end"] == at(1)
    assert _doc(mongo_db, "MSFT", "1m", 0)["quote_count"] == 1  # in-batch duplicate removed
    assert _doc(mongo_db, "AAPL", "1m", 5)["quote_count"] == 1  # accepted-late q7
    aapl_10_12 = _doc(mongo_db, "AAPL", "1m", 12)
    assert (aapl_10_12["quote_count"], aapl_10_12["close"]) == (2, 111.0)
    assert _doc(mongo_db, "AAPL", "1m", 1) is None  # too-late q6 never aggregated
    assert mongo_db[ASSET_TIME_SERIES].count_documents({}) == 4

    dropped = sum(progress_doc(progress_as_dict(p))["rows_dropped_by_watermark"] for p in query.recentProgress)
    assert dropped == 1

    # latest_market_metrics keeps 10:12:30 (111); the late 10:05 window must not replace it.
    latest = mongo_db[LATEST_MARKET].find_one({"_id": "AAPL"})
    assert latest["last_price"] == 111.0 and latest["last_event_time"] == at(12, 30)
    sink_docs = list(mongo_db[PIPELINE_METRICS].find({"kind": "sink", "query_name": "market_1m"}))
    assert sum(d["results"][LATEST_MARKET]["stale_skipped"] for d in sink_docs) == 1


def test_rolling_5m_window_matches_reference(spark, tmp_path, cfg, mongo_db):
    raw = market_input(spark, tmp_path)
    run_to_end(start_market_queries(raw, cfg, SinkTarget(cfg, mongo_db), ["market_5m_rolling"], trigger=AVAILABLE_NOW))

    window = _doc(mongo_db, "AAPL", "5m_rolling", 0)  # [10:00, 10:05)
    prices = [100.0, 102.0, 101.0]
    mean = sum(prices) / len(prices)
    stddev = (sum((p - mean) ** 2 for p in prices) / (len(prices) - 1)) ** 0.5
    assert window["quote_count"] == 3
    assert window["avg_price"] == pytest.approx(mean)
    assert window["price_stddev"] == pytest.approx(stddev)
    assert window["window_end"] - window["window_start"] == timedelta(minutes=5)
    # Sliding windows: q1 at 10:00:05 belongs to the five windows starting 09:56 .. 10:00.
    starts = {d["window_start"] for d in mongo_db[ASSET_TIME_SERIES].find({"asset_symbol": "AAPL", "quote_count": {"$gte": 1}})}
    assert {at(m) for m in range(-4, 1)} <= starts


def test_update_mode_emits_changes_and_append_mode_emits_final_windows(spark, tmp_path, make_cfg):
    def windows_for(mode, name):
        events = market_events(market_input(spark, tmp_path / name), make_cfg(name))
        metrics = market_window_metrics(events, MARKET_1M, "10 minutes")
        emitted, _ = collect_batches(metrics, name=name, cfg=make_cfg(name), mode=mode)
        return [
            (batch_id, row["quote_count"])
            for batch_id, rows in emitted
            for row in rows
            if row["asset_symbol"] == "AAPL" and spark_ts_to_utc(row["window_start"]) == at(0)
        ]

    update = windows_for("update", "update_mode")
    append = windows_for("append", "append_mode")
    assert [count for _, count in update] == [2, 3]  # provisional value, then the corrected one
    assert [count for _, count in append] == [3]  # emitted once, after the watermark passed 10:01


def test_complete_mode_re_emits_every_key(spark, tmp_path, cfg):
    batches = [
        [quote("a", "AAPL", at(0), 100.0)],
        [trade("b", USER1, "AAPL", at(1), "buy", 1, 100.0)],
        [quote("c", "AAPL", at(2), 101.0)],
    ]
    write_batches(tmp_path / "input", batches)
    parsed = parse_events(file_source(spark, str(tmp_path / "input")))
    emitted, _ = collect_batches(event_type_totals(parsed, "test"), name="totals", cfg=cfg, mode="complete")
    last_batch = {row["event_type"]: row["events_including_duplicates"] for row in emitted[-1][1]}
    assert last_batch == {"market_quote": 2, "trade_executed": 1}  # re-emitted although batch 2 had no trade


# --- event gate --------------------------------------------------------------------------


def test_event_gate_routes_invalid_and_too_late_events(spark, tmp_path, cfg, mongo_db):
    raw = market_input(spark, tmp_path)
    run_to_end(start_gate_queries(raw, cfg, SinkTarget(cfg, mongo_db), ["event_gate"], trigger=AVAILABLE_NOW))

    gate = {d["batch_id"]: d for d in mongo_db[PIPELINE_METRICS].find({"kind": "gate"})}
    assert sorted(gate) == [0, 1, 2, 3]
    assert gate[0]["invalid"] == 1 and gate[0]["by_error_code"] == {"MALFORMED_JSON": 1}
    assert gate[0]["duplicates_in_batch"] == 1
    assert gate[0]["by_lateness"] == {ON_TIME: 4}
    assert gate[1]["by_lateness"] == {ON_TIME: 3}
    assert gate[2]["by_lateness"] == {ON_TIME: 1}
    assert gate[3]["by_lateness"] == {TOO_LATE: 1, ACCEPTED_LATE: 1}
    assert as_utc(gate[3]["watermarks"]["market"]) == at(2)
    assert as_utc(gate[3]["high_water_marks"]["market"]) == at(12, 30)

    dead = spark.read.parquet(f"{cfg.diagnostics('dead_letter')}/run=test/batch=0").collect()
    assert [(r["error_code"], r["raw_value"]) for r in dead] == [("MALFORMED_JSON", "{not valid json")]
    late = spark.read.parquet(f"{cfg.diagnostics('too_late')}/run=test/batch=3").collect()
    assert [r["event_id"] for r in late] == [eid("q6")]
    assert late[0]["lateness_seconds"] == (at(12, 30) - at(1, 30)).total_seconds()

    state = mongo_db[STREAM_STATE].find_one({"_id": "lateness|event_gate|test|market"})
    assert as_utc(state["max_event_time"]) == at(12, 30)


def test_gate_and_aggregation_agree_when_spark_keeps_a_row_behind_its_watermark(spark, tmp_path, make_cfg, make_db):
    """Without batch 2, q6 arrives while Spark's late-events watermark is still 09:50:30.

    Spark then aggregates q6 although the reported watermark is already 10:02;
    the gate classifies it as accepted_late, consistent with what Spark did.
    """
    batches = [MARKET_BATCHES[0], MARKET_BATCHES[1], MARKET_BATCHES[3]]
    write_batches(tmp_path / "input", batches)
    agg_db, gate_db = make_db(), make_db()
    raw = file_source(spark, str(tmp_path / "input"))
    run_to_end(start_market_queries(raw, make_cfg("agg"), SinkTarget(make_cfg("agg"), agg_db), ["market_1m"], trigger=AVAILABLE_NOW))
    run_to_end(start_gate_queries(raw, make_cfg("gate"), SinkTarget(make_cfg("gate"), gate_db), ["event_gate"], trigger=AVAILABLE_NOW))

    assert _doc(agg_db, "AAPL", "1m", 1)["quote_count"] == 1  # q6 kept by Spark
    gate = gate_db[PIPELINE_METRICS].find_one({"kind": "gate", "batch_id": 2})
    assert gate["by_lateness"] == {ACCEPTED_LATE: 2}


def test_curated_events_are_parquet_partitioned(spark, tmp_path, cfg, mongo_db):
    raw = market_input(spark, tmp_path)
    run_to_end(start_gate_queries(raw, cfg, SinkTarget(cfg, mongo_db), ["curated_events"], trigger=AVAILABLE_NOW))
    curated = spark.read.parquet(cfg.curated_root)
    assert curated.count() == 10  # 11 lines - 1 malformed; duplicates are removed later in silver
    partitions = {(r["event_type"], str(r["event_date"])) for r in curated.select("event_type", "event_date").distinct().collect()}
    assert partitions == {("market_quote", "2026-10-05")}


# --- behaviour -------------------------------------------------------------------------------


def test_user_activity_windows_and_sessions(spark, tmp_path, cfg, mongo_db):
    batches = [
        [
            trade("t1", USER1, "AAPL", at(0), "buy", 2, 100.0, fee=0.1),
            trade("t2", USER1, "MSFT", at(1), "buy", 1, 300.0),
            trade("t3", USER1, "AAPL", at(2), "sell", 1, 110.0),
            trade("t4", USER1, "TSLA", at(2, 30), "buy", 5, 200.0, status="cancelled"),  # did not trade
            action("a1", USER1, at(3), symbol="AAPL"),
        ],
        [trade("t1", USER1, "AAPL", at(0), "buy", 2, 100.0, fee=0.1), action("a2", USER1, at(40))],
        [action("a3", USER1, at(90))],  # advances the watermark to 11:20 so both sessions close
        [action("a4", USER1, at(91))],
    ]
    write_batches(tmp_path / "input", batches)
    raw = file_source(spark, str(tmp_path / "input"))
    run_to_end(start_behavior_queries(raw, cfg, SinkTarget(cfg, mongo_db), ["user_activity_5m", "user_sessions"], trigger=AVAILABLE_NOW))

    window = mongo_db[USER_ACTIVITY].find_one({"user_id": USER1, "window_start": at(0)})
    assert (window["trade_count"], window["buy_count"], window["sell_count"], window["action_count"]) == (3, 2, 1, 1)
    assert window["turnover"] == pytest.approx(2 * 100.0 + 300.0 + 110.0)
    assert window["distinct_assets"] == 2
    assert window["overtrading_signal"] is False

    sessions = sorted(mongo_db[USER_SESSIONS].find({"user_id": USER1}), key=lambda d: d["session_start"])
    assert [(s["session_start"], s["session_end"], s["event_count"]) for s in sessions] == [
        (at(0), at(18), 4),
        (at(40), at(55), 1),
    ]
