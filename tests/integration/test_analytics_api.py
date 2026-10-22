"""Analytics API: authentication, per-user authorization, Lambda reconciliation, freshness.

Run (see conftest.py for requirements):
    FINSIGHT_TEST_MONGO_URI=mongodb://127.0.0.1:27018 python -m pytest tests/integration/test_analytics_api.py -v
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import urllib.error
import urllib.request

import pytest

from serving.keys import market_series_key, pseudonymize_user_id, serving_id, session_key, user_series_key
from serving.lambda_reconciliation import dataset_id, publish_batch_cutoff
from serving.mongo_sink import (
    ASSET_TIME_SERIES,
    LAMBDA_STATE,
    LATEST_MARKET,
    PIPELINE_METRICS,
    USER_ACTIVITY,
    USER_SESSIONS,
    SinkSettings,
    write_docs,
)
from tests.integration.conftest import USER_SALT

SUB_A = "a4f33138-b9c9-4e46-bc03-91ada28f6d03"
SUB_B = "0b0e6a55-7c1d-4a3e-9f62-5d3c2b1a0f99"
SUB_ADMIN = "9d1e8c47-2f6b-4c55-8a0e-3b7f6d2c1e44"
USER_A = pseudonymize_user_id(SUB_A, USER_SALT)
USER_B = pseudonymize_user_id(SUB_B, USER_SALT)
NOW = dt.datetime.now(dt.UTC).replace(microsecond=0)
T = (NOW - dt.timedelta(minutes=30)).replace(second=0)


def minutes(n: float) -> dt.timedelta:
    return dt.timedelta(minutes=n)


def write(db, collection, docs, *, layer=None, guard_field=None):
    """Write exactly like the pipelines do (serving/mongo_sink.py)."""
    settings = SinkSettings("unused", db.name, collection, "integration-seed", "seed", layer=layer, guard_field=guard_field)
    write_docs(db[collection], docs, settings, batch_id=0, computed_at=NOW)


def market_window(layer, minute, close):
    key = market_series_key("AAPL", "1m", T + minutes(minute))
    return {
        "_id": serving_id(layer, key), "series_key": key, "asset_symbol": "AAPL", "granularity": "1m",
        "window_start": T + minutes(minute), "window_end": T + minutes(minute + 1), "window_seconds": 60,
        "quote_count": 3, "open": close - 1, "high": close + 1, "low": close - 2, "close": close,
        "avg_price": close, "price_stddev": 1.0, "volatility_pct": 1.0, "return_pct": 0.5, "volume": 1000.0,
        "last_event_time": T + minutes(minute + 0.9),
    }


def activity_window(layer, user, minute, trades):
    key = user_series_key(user, "5m", T + minutes(minute))
    return {
        "_id": serving_id(layer, key), "series_key": key, "user_id": user, "granularity": "5m",
        "window_start": T + minutes(minute), "window_end": T + minutes(minute + 5), "window_seconds": 300,
        "event_count": trades, "trade_count": trades, "buy_count": trades, "sell_count": 0, "action_count": 0,
        "turnover": 100.0 * trades, "fees": 0.0, "distinct_assets": 1, "buy_ratio": 1.0,
        "overtrading_signal": False, "last_event_time": T + minutes(minute + 4),
    }


@pytest.fixture(scope="module")
def seeded(analytics_db):
    db = analytics_db
    # Market: speed windows 0..5; batch windows 0..3 with a published cutoff at T+3, so
    # windows 0-2 come from batch, 3-5 from speed and the batch window 3 is not committed yet.
    write(db, ASSET_TIME_SERIES, [market_window("speed", m, 100.0 + m) for m in range(6)], layer="speed")
    write(db, ASSET_TIME_SERIES, [market_window("batch", m, 200.0 + m) for m in range(4)], layer="batch")
    publish_batch_cutoff(db[LAMBDA_STATE], dataset_id("market", "1m"), T + minutes(3), "batch-run-1")

    write(db, LATEST_MARKET, [
        {"_id": "AAPL", "asset_symbol": "AAPL", "last_price": 105.0, "currency": "VND", "source": "yahoo",
         "last_event_time": NOW - dt.timedelta(seconds=30), "window_return_pct": 0.5},
        {"_id": "MSFT", "asset_symbol": "MSFT", "last_price": 300.0, "currency": "VND", "source": "yahoo",
         "last_event_time": NOW - dt.timedelta(hours=1), "window_return_pct": -0.2},
    ], guard_field="last_event_time")

    # Activity: speed windows at 0 (provisional) and 5; the batch run covers every user's
    # window 0 (cutoff T+5), so window 0 is served from batch and window 5 from speed.
    write(db, USER_ACTIVITY, [activity_window("speed", USER_A, 0, 2), activity_window("speed", USER_A, 5, 3),
                              activity_window("speed", USER_B, 0, 6)], layer="speed")
    write(db, USER_ACTIVITY, [activity_window("batch", USER_A, 0, 9), activity_window("batch", USER_B, 0, 7)], layer="batch")
    publish_batch_cutoff(db[LAMBDA_STATE], dataset_id("user_activity", "5m"), T + minutes(5), "batch-run-1")

    write(db, USER_SESSIONS, [
        {"_id": serving_id("speed", session_key(user, T)), "series_key": session_key(user, T), "user_id": user,
         "session_start": T, "session_end": T + minutes(20), "session_seconds": 1200, "event_count": n,
         "trade_count": n, "distinct_assets": 1, "last_event_time": T + minutes(5)}
        for user, n in ((USER_A, 4), (USER_B, 8))
    ], layer="speed")
    db["portfolio_risk_views"].insert_one({"user_id": USER_A, "computed_at": NOW, "max_drawdown_pct": 12.5, "run_id": "b1"})
    db[PIPELINE_METRICS].insert_many([
        {"_id": "progress|market_1m|r|7", "kind": "progress", "query_name": "market_1m", "batch_id": 7,
         "timestamp": NOW - dt.timedelta(seconds=10), "input_rows_per_second": 4.0, "processed_rows_per_second": 5.0,
         "watermark": T, "rows_dropped_by_watermark": 1, "state_rows_total": 12},
        {"_id": "gate|event_gate|r|7", "kind": "gate", "query_name": "event_gate", "computed_at": NOW,
         "invalid": 2, "by_error_code": {"INVALID_PRICE": 2}, "by_lateness": {"on_time": 5, "too_late": 1}},
    ])
    return db


def call(api, path, token=None, raw_token=None):
    headers = {}
    if token or raw_token:
        headers["authorization"] = f"Bearer {raw_token or token}"
    request = urllib.request.Request(f"{api}/api/analytics/{path}", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.headers, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, error.headers, json.loads(error.read() or b"null")


@pytest.fixture(scope="module")
def tokens(supabase):
    supabase.admins.add(SUB_ADMIN)
    return {"a": supabase.issue(SUB_A), "b": supabase.issue(SUB_B), "admin": supabase.issue(SUB_ADMIN)}


# --- authentication -------------------------------------------------------------------------


def test_requests_without_a_valid_token_are_rejected(api, seeded, supabase, tokens):
    header, payload, signature = tokens["a"].split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=="))
    forged = base64.urlsafe_b64encode(json.dumps({**claims, "sub": SUB_B}).encode()).rstrip(b"=").decode()

    for raw in (None, "not-a-jwt", supabase.issue(SUB_A, register=False), f"{header}.{forged}.{signature}",
                supabase.issue(SUB_A, expires_in=-60)):
        status, _, body = call(api, "me/activity", raw_token=raw)
        assert status == 401, raw
        assert body["error"]["code"] == "UNAUTHORIZED"
    assert call(api, "no/such/route")[0] == 401  # routes are not enumerable anonymously
    assert call(api, "no/such/route", tokens["a"])[0] == 404


# --- authorization ---------------------------------------------------------------------------


def test_users_only_see_their_own_activity(api, seeded, tokens):
    status, headers, body = call(api, "me/activity", tokens["a"])
    assert status == 200
    points = body["data"]["points"]
    # Window 0 comes from the batch layer (9 trades), window 5 is after the cutoff (speed, 3 trades).
    assert [(p["layer"], p["trade_count"], p["provisional"]) for p in points] == [("batch", 9, False), ("speed", 3, True)]
    assert headers.get("cache-control") == "private, no-store"

    # A user id parameter is ignored: the server derives the id from the token only.
    _, _, spoof = call(api, f"me/activity?user_id={USER_A}", tokens["b"])
    assert [(p["layer"], p["trade_count"]) for p in spoof["data"]["points"]] == [("batch", 7)]
    assert USER_A not in json.dumps(spoof) and SUB_A not in json.dumps(spoof)


def test_sessions_and_batch_views_are_per_user(api, seeded, tokens):
    _, _, a_sessions = call(api, "me/sessions", tokens["a"])
    _, _, b_sessions = call(api, "me/sessions", tokens["b"])
    assert [s["event_count"] for s in a_sessions["data"]] == [4]
    assert [s["event_count"] for s in b_sessions["data"]] == [8]

    _, _, a_risk = call(api, "me/risk", tokens["a"])
    _, _, b_risk = call(api, "me/risk", tokens["b"])
    assert a_risk["data"]["max_drawdown_pct"] == 12.5 and "user_id" not in a_risk["data"]
    assert b_risk["data"] is None and b_risk["meta"]["freshness"] is None


def test_pipeline_health_requires_the_admin_role(api, seeded, tokens):
    status, _, body = call(api, "pipeline/health", tokens["a"])
    assert (status, body["error"]["code"]) == (403, "FORBIDDEN")

    status, _, body = call(api, "pipeline/health", tokens["admin"])
    assert status == 200
    assert body["data"]["gate"]["invalid"] == 2 and body["data"]["gate"]["too_late"] == 1
    assert [q["query_name"] for q in body["data"]["queries"]] == ["market_1m"]
    assert {(entry["dataset"], entry["batch_run_id"]) for entry in body["data"]["lambda"]} == {
        ("market:1m", "batch-run-1"), ("user_activity:5m", "batch-run-1"),
    }


# --- serving semantics -----------------------------------------------------------------------


def test_market_series_serves_each_window_from_exactly_one_layer(api, seeded, tokens):
    status, _, body = call(api, "market/series?symbol=AAPL&granularity=1m", tokens["a"])
    assert status == 200
    points = body["data"]["points"]
    assert [(p["layer"], p["close"]) for p in points] == [
        ("batch", 200.0), ("batch", 201.0), ("batch", 202.0),  # window_end <= cutoff
        ("speed", 103.0), ("speed", 104.0), ("speed", 105.0),  # after the cutoff; batch window 3 ignored
    ]
    assert len({p["window_start"] for p in points}) == len(points)
    assert body["meta"]["source"]["batch_cutoff"].startswith((T + minutes(3)).strftime("%Y-%m-%dT%H:%M"))
    assert body["meta"]["source"]["layers"] == ["batch", "speed"]
    assert body["meta"]["freshness"]["stale_after_seconds"] == 300

    _, _, limited = call(api, "market/series?symbol=AAPL&limit=2", tokens["a"])
    assert [p["close"] for p in limited["data"]["points"]] == [104.0, 105.0]  # most recent windows, ascending


@pytest.mark.parametrize(
    "query",
    ["market/series", "market/series?symbol=aapl", "market/series?symbol=AAPL&granularity=7m",
     "market/series?symbol=AAPL&limit=0", "market/series?symbol=AAPL&limit=1001",
     "market/series?symbol=AAPL&from=yesterday", "me/activity?limit=289", "market/latest?symbols=A|B"],
)
def test_invalid_parameters_are_rejected(api, seeded, tokens, query):
    status, _, body = call(api, query, tokens["a"])
    assert (status, body["error"]["code"]) == (400, "INVALID_PARAMETER")


def test_latest_quotes_report_staleness_and_the_disclaimer(api, seeded, tokens):
    status, _, body = call(api, "market/latest?symbols=AAPL,MSFT,TSLA", tokens["a"])
    assert status == 200
    quotes = {q["asset_symbol"]: q for q in body["data"]}
    assert set(quotes) == {"AAPL", "MSFT"}  # unknown symbols return no data, not an error
    assert quotes["AAPL"]["stale"] is False and quotes["MSFT"]["stale"] is True
    assert 25 <= quotes["AAPL"]["quote_age_seconds"] <= 600
    assert body["meta"]["freshness"]["stale_after_seconds"] == 120
    assert body["meta"]["disclaimer"].startswith("Educational analytics")
