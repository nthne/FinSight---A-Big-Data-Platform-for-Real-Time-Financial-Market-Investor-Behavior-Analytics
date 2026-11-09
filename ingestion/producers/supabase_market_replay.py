"""Replay genuine Supabase market_prices into FinSight's ingestion gateway.

Use only server-side credentials. Read in event-time order, keep original source
and UUID quote ID, and checkpoint the last acknowledged event for safe retries.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ingestion.producers.market_producer import EventContract, build_market_quote_event

SOURCES = ("coingecko", "yahoo", "alpha_vantage", "stooq")
PRICE_COLUMNS = "price_id,asset_id,timestamp,open_price,high_price,low_price,close_price,volume,source"
ASSET_COLUMNS = "asset_id,symbol,currency,provider_symbol"


def utc_iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("Timestamps must include a UTC offset")
    return dt.astimezone(UTC)


class HttpJsonClient:
    def __init__(self, url: str, api_key: str = "", *, timeout: float = 30.0):
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _request(self, request: Request) -> Any:
        for attempt in range(4):
            try:
                with urlopen(request, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except HTTPError as exc:
                if exc.code not in (408, 429, 500, 502, 503, 504) or attempt == 3:
                    raise RuntimeError(f"Remote HTTP {exc.code}") from exc
            except (URLError, TimeoutError) as exc:
                if attempt == 3:
                    raise RuntimeError("Remote connection failed") from exc
            time.sleep(min(2 ** attempt, 8))
        raise RuntimeError("Unreachable retry state")

    def select(self, table: str, params: list[tuple[str, str]]) -> list[dict]:
        query = urlencode(params, safe="(),.")
        req = Request(
            f"{self.url}/rest/v1/{table}?{query}",
            headers={"apikey": self.api_key, "Authorization": f"Bearer {self.api_key}"},
        )
        result = self._request(req)
        if not isinstance(result, list):
            raise RuntimeError("Expected a list of Supabase rows")
        return result

    def post_gateway(self, event: dict, token: str) -> None:
        req = Request(
            f"{self.url}/v1/events",
            data=json.dumps(event, separators=(",", ":")).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-ingestion-token": token},
            method="POST",
        )
        result = self._request(req)
        if result.get("event_id") != event["event_id"] or result.get("status") != "accepted":
            raise RuntimeError("Gateway did not acknowledge the expected event")


class SupabaseReader:
    def __init__(self, client: HttpJsonClient):
        self.client = client

    def assets(self) -> dict[str, dict]:
        rows = self.client.select("market_assets", [("select", ASSET_COLUMNS), ("limit", "1000")])
        return {str(x["asset_id"]): x for x in rows}

    def iter_prices(
        self, *, since: str | None, until: str, after: tuple[str, str] | None,
        page_size: int, max_events: int,
    ) -> Iterator[dict]:
        emitted = 0
        while emitted < max_events:
            params = [
                ("select", PRICE_COLUMNS),
                ("source", f"in.({','.join(SOURCES)})"),
                ("order", "timestamp.asc,price_id.asc"),
                ("limit", str(min(page_size, max_events - emitted))),
                ("timestamp", "lte." + until),
            ]
            if since is not None:
                params.append(("timestamp", "gte." + since))
            if after is not None:
                ts, price_id = after
                # PostgREST keyset pagination: (timestamp,price_id) > cursor.
                params.append(("or", f"(timestamp.gt.{ts},and(timestamp.eq.{ts},price_id.gt.{price_id}))"))
            batch = self.client.select("market_prices", params)
            if not batch:
                return
            for row in batch:
                cursor = (str(row["timestamp"]), str(row["price_id"]))
                if after is not None and (parse_iso(cursor[0]), cursor[1]) <= (parse_iso(after[0]), after[1]):
                    raise RuntimeError("Supabase pagination returned a non-increasing cursor")
                yield row
                after = cursor
                emitted += 1
            if len(batch) < int(dict(params)["limit"]):
                return


def to_quote_event(row: dict, asset: dict, ingestion_time: str) -> dict:
    record: dict[str, Any] = {
        "price_id": row["price_id"],
        "symbol": asset["symbol"],
        "source": row["source"],
        "timestamp": row["timestamp"],
        "close_price": float(row["close_price"]),
        "currency": asset.get("currency") or "VND",
        "provider_symbol": asset.get("provider_symbol"),
    }
    for field in ("open_price", "high_price", "low_price", "volume"):
        if row.get(field) is not None:
            record[field] = float(row[field])
    return build_market_quote_event(record, ingestion_time=ingestion_time)


def atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def run(args: argparse.Namespace) -> dict:
    if not 1 <= args.page_size <= 1000 or args.limit < 1 or args.rate < 0:
        raise ValueError("Use page-size 1..1000, limit >= 1 and rate >= 0")
    supabase_url = os.environ.get("SUPABASE_URL", "")
    api_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SECRET_KEY")
    if not supabase_url or not api_key:
        raise ValueError("SUPABASE_URL and a server-side Supabase secret key are required")
    gateway_url = os.environ.get("INGESTION_GATEWAY_URL", "")
    gateway_token = os.environ.get("INGESTION_GATEWAY_TOKEN", "")
    if not args.dry_run and (not gateway_url or not gateway_token):
        raise ValueError("Set INGESTION_GATEWAY_URL and INGESTION_GATEWAY_TOKEN")

    checkpoint_path = Path(args.resume_file)
    now = datetime.now(UTC)
    previous = json.loads(checkpoint_path.read_text(encoding="utf-8")) if checkpoint_path.exists() else None
    if previous:
        since, until = previous["since"], previous["until"]
        after = tuple(previous["after"]) if previous.get("after") else None
        if previous["dry_run"] != args.dry_run:
            raise ValueError("Cannot resume a dry run as a real publish or vice versa")
    else:
        until = utc_iso(parse_iso(args.before_utc)) if args.before_utc else utc_iso(now)
        since = utc_iso(parse_iso(args.since_utc)) if args.since_utc else (
            utc_iso(parse_iso(until) - timedelta(days=args.days)) if args.days > 0 else None
        )
        after = None
    state = previous or {"version": 1, "dry_run": args.dry_run, "since": since, "until": until,
                         "after": None, "acknowledged_total": 0, "per_source": {}}
    reader = SupabaseReader(HttpJsonClient(supabase_url, api_key))
    assets = reader.assets()
    contract = EventContract.from_file(Path(__file__).resolve().parents[2] / "data-contracts/events.schema.json")
    gateway = HttpJsonClient(gateway_url) if not args.dry_run else None
    new_count = 0
    counters = Counter(state["per_source"])
    started = time.monotonic()
    atomic_json(checkpoint_path, state)
    try:
        for row in reader.iter_prices(since=since, until=until, after=after,
                                      page_size=args.page_size, max_events=args.limit):
            asset = assets.get(str(row["asset_id"]))
            if asset is None:
                raise RuntimeError(f"Unknown market asset for row {row['price_id']}")
            event = to_quote_event(row, asset, utc_iso(datetime.now(UTC)))
            contract.validate(event)
            if gateway:
                gateway.post_gateway(event, gateway_token)
            new_count += 1
            counters[event["source"]] += 1
            state["after"] = [str(row["timestamp"]), str(row["price_id"])]
            state["acknowledged_total"] = int(state["acknowledged_total"]) + 1
            state["per_source"] = dict(counters)
            if new_count % 100 == 0:
                atomic_json(checkpoint_path, state)
            if args.rate:
                elapsed = time.monotonic() - started
                delay = new_count / args.rate - elapsed
                if delay > 0:
                    time.sleep(delay)
    finally:
        atomic_json(checkpoint_path, state)
    report = {"origin": "Supabase market_prices (external providers only)",
              "mode": "validated_only" if args.dry_run else "gateway_accepted",
              "new_records": new_count, "total_acknowledged": state["acknowledged_total"],
              "per_source_total": state["per_source"],
              "since": since, "until": until,
              "elapsed_seconds": round(time.monotonic() - started, 3),
              "note": "Gateway accepted != confirmed Bronze, Spark or MongoDB completion."}
    if args.report_file:
        atomic_json(Path(args.report_file), report)
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=5000, help="Maximum new source rows in this invocation")
    ap.add_argument("--days", type=int, default=30, help="Event-time lookback; 0 means all history")
    ap.add_argument("--since-utc", help="Override event-time start ISO timestamp")
    ap.add_argument("--before-utc", help="Freeze an explicit event-time upper bound")
    ap.add_argument("--page-size", type=int, default=500)
    ap.add_argument("--rate", type=float, default=25.0, help="Maximum gateway requests per second, 0 = unlimited")
    ap.add_argument("--resume-file", default="/reports/real-market-state.json")
    ap.add_argument("--report-file", default="/reports/real-market-report.json")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    report = run(args)
    print(json.dumps(report, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
