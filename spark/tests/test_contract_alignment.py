"""The speed layer and Person A's frozen event contract agree.

* every fixture the speed-layer tests use is a valid contract 1.0.0 event, and
* the contract's own fixtures (``data-contracts/fixtures``) are accepted or
  rejected by ``parse_events`` the same way the ingestion gateway treats them.

Run: python -m pytest spark/tests/test_contract_alignment.py -v
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from spark.lib.envelope import EVENT_TYPES, SUPPORTED_SCHEMA_VERSIONS, parse_events
from spark.tests.events import MARKET_BATCHES, USER1, action, at, portfolio, trade

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "data-contracts" / "events.schema.json"
FIXTURES = ROOT / "data-contracts" / "fixtures"
# deploy/k8s/ingestion-config.yaml KNOWN_ASSET_SYMBOLS
KNOWN_SYMBOLS = ("AAPL", "TSLA", "MSFT", "BTC", "GOLD")


def contract() -> dict:
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def sample_events() -> list[dict]:
    market = [e for batch in MARKET_BATCHES for e in batch if isinstance(e, dict)]
    return market + [
        trade("c-t1", USER1, "AAPL", at(0), "buy", 2, 100.0, fee=0.5),
        trade("c-t2", USER1, "MSFT", at(1), "sell", 1, 300.0, status="cancelled"),
        action("c-a1", USER1, at(2), symbol="AAPL"),
        action("c-a2", USER1, at(3)),
        portfolio("c-p1", USER1, at(4)),
    ]


def test_speed_layer_constants_match_the_contract():
    schema = contract()
    assert set(schema["properties"]["event_type"]["enum"]) == set(EVENT_TYPES)
    assert SUPPORTED_SCHEMA_VERSIONS == (schema["properties"]["schema_version"]["const"],)


def test_test_fixtures_are_valid_contract_events():
    jsonschema = pytest.importorskip("jsonschema")
    validator = jsonschema.Draft202012Validator(contract(), format_checker=jsonschema.FormatChecker())
    for event in sample_events():
        errors = [f"{'/'.join(map(str, e.absolute_path))}: {e.message}" for e in validator.iter_errors(event)]
        assert not errors, (event["event_id"], errors)


def test_contract_fixtures_are_classified_like_the_gateway(spark):
    def fixture(name):
        return json.loads((FIXTURES / name).read_text(encoding="utf-8"))

    rows = [
        (json.dumps(fixture("valid-market-quote.json")), "valid"),
        (json.dumps(fixture("invalid-missing-event-id.json")), "missing-id"),
        (json.dumps(fixture("invalid-timestamp.json")), "timestamp"),
        (json.dumps(fixture("invalid-unknown-symbol.json")), "unknown-symbol"),
    ] + [(json.dumps(event), f"duplicate-{i}") for i, event in enumerate(fixture("invalid-duplicate-event.json"))]
    raw = spark.createDataFrame(rows, "value string, name string")
    result = {r["name"]: r for r in parse_events(raw, known_symbols=KNOWN_SYMBOLS).collect()}

    valid = result["valid"]
    assert valid["error_code"] is None
    assert (valid["asset_symbol"], valid["payload"]["close_price"], valid["payload"]["currency"]) == ("AAPL", 6287500.0, "VND")
    assert valid["payload"]["volume"] == 42133700.0
    assert result["missing-id"]["error_code"] == "MISSING_EVENT_ID"
    assert result["timestamp"]["error_code"] == "INVALID_EVENT_TIME"
    assert result["unknown-symbol"]["error_code"] == "UNKNOWN_SYMBOL"
    # A duplicate id is a stream invariant, not a per-event error: both copies are
    # valid here and the windows drop the second one (dropDuplicatesWithinWatermark).
    assert result["duplicate-0"]["error_code"] is None and result["duplicate-1"]["error_code"] is None
    assert result["duplicate-0"]["event_id"] == result["duplicate-1"]["event_id"]


def test_test_fixtures_pass_speed_layer_validation(spark):
    raw = spark.createDataFrame([(json.dumps(e),) for e in sample_events()], "value string")
    errors = [(r["event_id"], r["error_code"]) for r in parse_events(raw, known_symbols=KNOWN_SYMBOLS).collect() if r["error_code"]]
    assert errors == []
