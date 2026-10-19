"""End-to-end smoke test of the speed layer on the integration profile (Person C).

Publishes event-contract 1.0.0 events through Person A's ingestion gateway
(``POST /v1/events``), lets the running ``speed-layer`` consume them from
Kafka, and checks the MongoDB serving documents and the S3A outputs on MinIO.

    run                              publish the scenario, verify, print a JSON report
    replay --base-time T --digest D  after restarting the speed layer, publish the same
                                     events again and verify that nothing changed

The scenario starts 40 minutes in the past (``base_time``) so every event is
older than its ingestion time; the watermark only depends on event times.

    phase 0  AAPL quotes +0:05 100, +0:30 102 (sent twice), +0:50 101; MSFT +0:10 300
             trades: buy 2 AAPL @101 +1:00, sell 1 AAPL @102 +2:00, cancelled MSFT +2:30
             user action +3:00; one event without event_id (the gateway must reject it)
    phase 1  AAPL +20:00 110   -> high-water mark, watermark +10:00
    phase 2  AAPL +20:30 111   -> second batch after the high-water mark
    phase 3  AAPL +1:30 105    -> older than the watermark: too late, never aggregated
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from uuid import UUID, uuid5

from pymongo import MongoClient

from serving.keys import market_series_key, pseudonymize_user_id, serving_id, user_series_key
from serving.mongo_sink import ASSET_TIME_SERIES, LATEST_MARKET, PIPELINE_METRICS, USER_ACTIVITY, USER_SESSIONS

NAMESPACE = UUID("3b8f2f61-8f0e-4f7c-9d2a-6c1e0a4b7d55")
SMOKE_SALT = "streaming-smoke-salt"
USER = pseudonymize_user_id("smoke-user-1", SMOKE_SALT)
SOURCE = "streaming-smoke"
# Execution metadata that legitimately changes between runs (see recovery-test.md).
VOLATILE = {"computed_at", "first_computed_at", "batch_id", "data_freshness_seconds", "query_name", "run_id"}
SERVING_COLLECTIONS = (ASSET_TIME_SERIES, LATEST_MARKET, USER_ACTIVITY, USER_SESSIONS)
EXPECTED_QUERIES = (
    "event_gate", "curated_events", "event_type_totals",
    "market_1m", "market_5m_rolling", "user_activity_5m", "user_sessions",
)


def iso(ts: dt.datetime) -> str:
    return ts.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def offset(minutes: int, seconds: int = 0) -> dt.timedelta:
    return dt.timedelta(minutes=minutes, seconds=seconds)


class Scenario:
    def __init__(self, base_time: dt.datetime):
        self.base = base_time

    def eid(self, name: str) -> str:
        # Unique per base time, so separate smoke runs never share event ids.
        return str(uuid5(NAMESPACE, f"{iso(self.base)}|{name}"))

    def _event(self, name, event_type, at, payload, *, symbol=None, user=None):
        event = {
            "event_id": self.eid(name),
            "event_type": event_type,
            "schema_version": "1.0.0",
            "source": SOURCE,
            "event_time": iso(self.base + at),
            "ingestion_time": iso(dt.datetime.now(dt.UTC)),
            "payload": payload,
        }
        if symbol:
            event["asset_symbol"] = symbol
        if user:
            event["user_id"] = user
        return event

    def quote(self, name, symbol, at, price, volume=None):
        payload = {"close_price": price, "currency": "VND"}
        if volume is not None:
            payload["volume"] = volume
        return self._event(name, "market_quote", at, payload, symbol=symbol)

    def trade(self, name, symbol, at, side, quantity, price, status="executed"):
        notional = quantity * price
        payload = {
            "order_id": self.eid(f"order-{name}"),
            "side": side,
            "quantity": quantity,
            "price": price,
            "fee": 0,
            "total": -notional if side == "buy" else notional,
            "order_kind": "market",
            "status": status,
        }
        return self._event(name, "trade_executed", at, payload, symbol=symbol, user=USER)

    def action(self, name, at, action_type="view_asset"):
        payload = {"action_id": self.eid(f"action-{name}"), "action_type": action_type, "metadata": {}}
        return self._event(name, "user_action", at, payload, user=USER)

    def phases(self) -> list[list[tuple[dict, int]]]:
        """Events per phase with the HTTP status the gateway must return."""
        invalid = self.quote("invalid", "AAPL", offset(0, 40), 99.0)
        del invalid["event_id"]
        return [
            [
                (self.quote("q1", "AAPL", offset(0, 5), 100.0, 1000.0), 202),
                (self.quote("q2", "AAPL", offset(0, 30), 102.0, 1200.0), 202),
                (self.quote("q3", "AAPL", offset(0, 50), 101.0, 1500.0), 202),
                (self.quote("q4", "MSFT", offset(0, 10), 300.0, 50.0), 202),
                (self.quote("q2", "AAPL", offset(0, 30), 102.0, 1200.0), 202),  # producer retry
                (self.trade("t1", "AAPL", offset(1), "buy", 2, 101.0), 202),
                (self.trade("t2", "AAPL", offset(2), "sell", 1, 102.0), 202),
                (self.trade("t3", "MSFT", offset(2, 30), "buy", 5, 300.0, status="cancelled"), 202),
                (self.action("a1", offset(3)), 202),
                (invalid, 422),
            ],
            [(self.quote("q5", "AAPL", offset(20), 110.0), 202)],
            [(self.quote("q6", "AAPL", offset(20, 30), 111.0), 202)],
            [(self.quote("q7", "AAPL", offset(1, 30), 105.0), 202)],
        ]


# --- gateway -------------------------------------------------------------------------------


def post_event(event: dict) -> int:
    url = os.environ["INGESTION_GATEWAY_URL"].rstrip("/") + "/v1/events"
    request = urllib.request.Request(
        url,
        data=json.dumps(event).encode(),
        method="POST",
        headers={"content-type": "application/json", "x-ingestion-token": os.environ["INGESTION_GATEWAY_TOKEN"]},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def publish(scenario: Scenario, pause: float) -> list[dict]:
    results = []
    for index, phase in enumerate(scenario.phases()):
        for event, expected in phase:
            status = post_event(event)
            results.append({"phase": index, "event_id": event.get("event_id"), "status": status, "expected": expected})
        time.sleep(pause)
    return results


# --- MinIO (S3 ListObjectsV2 with SigV4, stdlib only) ----------------------------------------------


def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode(), hashlib.sha256).digest()


def s3_keys(prefix: str, *, max_keys: int = 1000) -> list[str]:
    endpoint = urllib.parse.urlparse(os.environ["MINIO_ENDPOINT"])
    bucket, region = os.environ["MINIO_BUCKET"], "us-east-1"
    access, secret = os.environ["MINIO_ACCESS_KEY"], os.environ["MINIO_SECRET_KEY"]
    now = dt.datetime.now(dt.UTC)
    amz_date, date = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    params = {"list-type": "2", "max-keys": str(max_keys), "prefix": prefix}
    query = "&".join(
        f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}" for k, v in sorted(params.items())
    )
    payload_hash = hashlib.sha256(b"").hexdigest()
    headers = f"host:{endpoint.netloc}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed = "host;x-amz-content-sha256;x-amz-date"
    canonical = "\n".join(["GET", f"/{bucket}", query, headers, signed, payload_hash])
    scope = f"{date}/{region}/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    key = _sign(_sign(_sign(_sign(f"AWS4{secret}".encode(), date), region), "s3"), "aws4_request")
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        f"{endpoint.scheme}://{endpoint.netloc}/{bucket}?{query}",
        headers={
            "x-amz-date": amz_date,
            "x-amz-content-sha256": payload_hash,
            "authorization": f"AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders={signed}, Signature={signature}",
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        root = ET.fromstring(response.read())
    ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
    return [node.text for node in root.findall("s3:Contents/s3:Key", ns)]


# --- verification --------------------------------------------------------------------------


def database():
    client = MongoClient(os.environ["MONGO_URI"], tz_aware=True, serverSelectionTimeoutMS=5000)
    return client[os.environ.get("MONGO_DATABASE", "finsight")]


def digest(db) -> tuple[str, dict[str, int]]:
    """Hash of every serving document without execution metadata."""
    h = hashlib.sha256()
    counts = {}
    for name in SERVING_COLLECTIONS:
        docs = sorted(db[name].find({}), key=lambda d: str(d["_id"]))
        counts[name] = len(docs)
        for doc in docs:
            stable = {k: v for k, v in doc.items() if k not in VOLATILE}
            h.update(json.dumps(stable, sort_keys=True, default=str).encode())
    return h.hexdigest(), counts


def checks(db, scenario: Scenario) -> dict[str, tuple[bool, object]]:
    base, run_id = scenario.base, os.environ.get("RUN_ID", "compose-local")

    def window(symbol, minute):
        return db[ASSET_TIME_SERIES].find_one({"_id": serving_id("speed", market_series_key(symbol, "1m", base + offset(minute)))})

    aapl0, msft0, aapl1, aapl20 = window("AAPL", 0), window("MSFT", 0), window("AAPL", 1), window("AAPL", 20)
    latest = db[LATEST_MARKET].find_one({"_id": "AAPL"})
    activity = db[USER_ACTIVITY].find_one({"_id": serving_id("speed", user_series_key(USER, "5m", base))})
    gates = list(db[PIPELINE_METRICS].find({"kind": "gate", "run_id": run_id}))
    too_late = sum((g.get("by_lateness") or {}).get("too_late", 0) for g in gates)
    queries = set(db[PIPELINE_METRICS].distinct("query_name", {"kind": "progress"}))

    def ohlcv(doc):
        return doc and (doc["quote_count"], doc["open"], doc["high"], doc["low"], doc["close"], doc.get("volume"))

    def act(doc):
        return doc and (doc["trade_count"], doc["buy_count"], doc["sell_count"], doc["action_count"], doc["turnover"])

    return {
        "aapl_1m_window_dedup_ohlc_volume": (ohlcv(aapl0) == (3, 100.0, 102.0, 100.0, 101.0, 1500.0), ohlcv(aapl0)),
        "msft_1m_window": (bool(msft0) and msft0["quote_count"] == 1, msft0 and msft0["quote_count"]),
        "aapl_20m_window": (bool(aapl20) and (aapl20["quote_count"], aapl20["close"]) == (2, 111.0), aapl20 and aapl20["quote_count"]),
        "too_late_quote_not_aggregated": (aapl1 is None, aapl1 and aapl1["quote_count"]),
        "latest_quote_not_replaced_by_late": (bool(latest) and latest["last_price"] == 111.0, latest and latest["last_price"]),
        "user_activity_executed_trades_only": (act(activity) == (2, 1, 1, 1, 304.0), act(activity)),
        "gate_counted_too_late": (too_late == 1, too_late),
        "gate_saw_no_invalid_events": (sum(g.get("invalid", 0) for g in gates) == 0, sum(g.get("invalid", 0) for g in gates)),
        "progress_for_every_query": (set(EXPECTED_QUERIES) <= queries, sorted(queries)),
    }


def s3_checks(run_id: str) -> dict[str, tuple[bool, object]]:
    results = {}
    for name, prefix in {
        "checkpoints_on_s3a": f"checkpoints/speed/{run_id}/market_1m/",
        "curated_parquet_on_s3a": "silver/speed/event_type=market_quote/",
        "too_late_diagnostics_on_s3a": f"diagnostics/too_late/run={run_id}/",
    }.items():
        keys = s3_keys(prefix)
        results[name] = (bool(keys), len(keys))
    return results


def wait_for(db, scenario: Scenario, timeout: float) -> dict[str, tuple[bool, object]]:
    deadline = time.monotonic() + timeout
    while True:
        result = checks(db, scenario)
        if all(ok for ok, _ in result.values()) or time.monotonic() > deadline:
            return result
        time.sleep(5)


def report(payload: dict) -> int:
    print(json.dumps(payload, indent=2, default=str))
    failed = [name for name, (ok, _) in payload["checks"].items() if not ok]
    if failed:
        print(f"FAILED: {failed}", file=sys.stderr)
    return 1 if failed else 0


def cmd_run(args) -> int:
    start = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=40)
    # Align to 5 minutes so the 1-minute and 5-minute tumbling windows both start at base_time.
    base = start.replace(minute=start.minute - start.minute % 5, second=0, microsecond=0)
    scenario = Scenario(base)
    db = database()
    started = time.monotonic()
    published = publish(scenario, args.pause)
    result = {**checks_published(published), **wait_for(db, scenario, args.timeout)}
    result.update(s3_checks(os.environ.get("RUN_ID", "compose-local")))
    value, counts = digest(db)
    return report({
        "base_time": iso(base),
        "seconds": round(time.monotonic() - started, 1),
        "digest": value,
        "document_counts": counts,
        "checks": result,
    })


def checks_published(published: list[dict]) -> dict[str, tuple[bool, object]]:
    wrong = [p for p in published if p["status"] != p["expected"]]
    return {"gateway_status_codes": (not wrong, wrong or f"{len(published)} requests as expected")}


def cmd_replay(args) -> int:
    scenario = Scenario(dt.datetime.fromisoformat(args.base_time.replace("Z", "+00:00")))
    db = database()
    before, counts_before = digest(db)
    published = publish(scenario, args.pause)
    time.sleep(args.settle)
    after, counts_after = digest(db)
    result = {
        **checks_published(published),
        "expected_digest_before_replay": (before == args.digest, before),
        "serving_documents_unchanged": (after == args.digest, after),
        "no_new_documents": (counts_after == counts_before, counts_after),
    }
    return report({"base_time": args.base_time, "document_counts": counts_after, "checks": result})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("--pause", type=float, default=25.0, help="seconds between phases (> trigger interval)")
    run.add_argument("--timeout", type=float, default=180.0)
    replay = sub.add_parser("replay")
    replay.add_argument("--base-time", required=True)
    replay.add_argument("--digest", required=True)
    replay.add_argument("--pause", type=float, default=15.0)
    replay.add_argument("--settle", type=float, default=60.0, help="seconds to let the speed layer process the replay")
    args = parser.parse_args(argv)
    return cmd_run(args) if args.command == "run" else cmd_replay(args)


if __name__ == "__main__":
    raise SystemExit(main())
