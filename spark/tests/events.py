"""Deterministic event fixtures for the speed-layer tests.

Every helper builds an event that satisfies Person A's frozen contract
(``data-contracts/events.schema.json`` 1.0.0); ``test_contract_alignment.py``
validates them with the JSON Schema. Event ids are UUIDv5 values derived from
short names (``eid("q1")``) so tests can still refer to events by name.

Timeline used by most tests (UTC, watermark delay 10 minutes). Spark drops
rows of batch N against the watermark of batch N-1 (see spark/lib/lateness.py),
so batch 2 exists to make the late-events watermark of batch 3 equal 10:02.

batch 0  q1 AAPL 10:00:05 100 | q2 AAPL 10:00:30 102 | q3 MSFT 10:00:10 300
         q3 again (duplicate inside the batch) | one malformed line
batch 1  q4 AAPL 10:00:50 101 | q2 again (duplicate across batches)
         q5 AAPL 10:12:00 110  -> high-water mark 10:12
batch 2  q8 AAPL 10:12:30 111  -> on time; eviction watermark 10:02
batch 3  q6 AAPL 10:01:30 105  -> too late (<= 10:02), dropped
         q7 AAPL 10:05:00 108  -> accepted late (out of order, > 10:02)

AAPL volumes grow like a provider's cumulative session volume
(q1 1000, q2 1200, q4 1500), so a window must report the last value, not a sum.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid5

from serving.keys import pseudonymize_user_id

T0 = datetime(2026, 10, 5, 10, 0, tzinfo=timezone.utc)
SCHEMA_VERSION = "1.0.0"
FIXTURE_NAMESPACE = UUID("7d0c6f0e-3f55-4d8e-9a43-5f1a1c2b9e10")
TEST_SALT = "speed-layer-test-salt"

# Trigger used by tests: process every available file (one per micro-batch), then stop.
AVAILABLE_NOW = {"availableNow": True}


def at(minutes: int, seconds: int = 0) -> datetime:
    return T0 + timedelta(minutes=minutes, seconds=seconds)


def iso(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def eid(name: str) -> str:
    """Stable UUID for a fixture name, like the producers' deterministic ids."""
    return str(uuid5(FIXTURE_NAMESPACE, name))


def user(name: str) -> str:
    """Pseudonymous ``usr_<sha256>`` id, produced exactly like the ingestion side."""
    return pseudonymize_user_id(name, TEST_SALT)


USER1 = user("supabase-user-1")


def envelope(name, event_type, event_time, *, payload=None, asset_symbol=None, user_id=None, ingestion_time=None, **overrides):
    doc = {
        "event_id": eid(name),
        "event_type": event_type,
        "schema_version": SCHEMA_VERSION,
        "source": "test-fixture",
        "event_time": iso(event_time),
        "ingestion_time": iso(ingestion_time or event_time + timedelta(seconds=1)),
        "payload": payload if payload is not None else {},
    }
    # Optional envelope fields are omitted rather than null, as in the contract.
    if asset_symbol is not None:
        doc["asset_symbol"] = asset_symbol
    if user_id is not None:
        doc["user_id"] = user_id
    doc.update(overrides)
    return doc


def quote(name, symbol, event_time, price, volume=10.0, **kw):
    return envelope(
        name, "market_quote", event_time, asset_symbol=symbol,
        payload={"close_price": price, "volume": volume, "currency": "VND"}, **kw,
    )


def trade(name, user_id, symbol, event_time, side, quantity, price, fee=0.0, status="executed", **kw):
    notional = quantity * price
    total = -(notional + fee) if side == "buy" else notional - fee
    payload = {
        "order_id": eid(f"order-{name}"),
        "side": side,
        "quantity": quantity,
        "price": price,
        "fee": fee,
        "total": total,
        "order_kind": "market",
        "status": status,
    }
    return envelope(name, "trade_executed", event_time, asset_symbol=symbol, user_id=user_id, payload=payload, **kw)


def action(name, user_id, event_time, action_type="view_asset", symbol=None, **kw):
    payload = {"action_id": eid(f"action-{name}"), "action_type": action_type, "metadata": {}}
    return envelope(name, "user_action", event_time, asset_symbol=symbol, user_id=user_id, payload=payload, **kw)


def portfolio(name, user_id, event_time, total_value=1e8, cash_balance=4e7, **kw):
    payload = {
        "snapshot_id": eid(f"snapshot-{name}"),
        "total_value": total_value,
        "cash_balance": cash_balance,
        "invested_value": total_value - cash_balance,
        "pnl": 0.0,
        "risk_score": None,
        "diversification_score": None,
    }
    return envelope(name, "portfolio_snapshot", event_time, user_id=user_id, payload=payload, **kw)


LATE = at(12, 40)  # ingestion time of the late events in batch 3

MARKET_BATCHES = [
    [
        quote("q1", "AAPL", at(0, 5), 100.0, volume=1000.0),
        quote("q2", "AAPL", at(0, 30), 102.0, volume=1200.0),
        quote("q3", "MSFT", at(0, 10), 300.0),
        quote("q3", "MSFT", at(0, 10), 300.0),
        "{not valid json",
    ],
    [
        quote("q4", "AAPL", at(0, 50), 101.0, volume=1500.0),
        quote("q2", "AAPL", at(0, 30), 102.0, volume=1200.0),
        quote("q5", "AAPL", at(12, 0), 110.0),
    ],
    [quote("q8", "AAPL", at(12, 30), 111.0)],
    [
        quote("q6", "AAPL", at(1, 30), 105.0, ingestion_time=LATE),
        quote("q7", "AAPL", at(5, 0), 108.0, ingestion_time=LATE),
    ],
]


def write_batches(directory: Path, batches, *, start_index: int = 0) -> None:
    """Write one JSON-lines file per micro-batch with increasing mtimes."""
    directory.mkdir(parents=True, exist_ok=True)
    base = 1_700_000_000
    for offset, events in enumerate(batches):
        index = start_index + offset
        path = directory / f"batch-{index:03d}.json"
        lines = [e if isinstance(e, str) else json.dumps(e) for e in events]
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.utime(path, (base + index * 10, base + index * 10))
