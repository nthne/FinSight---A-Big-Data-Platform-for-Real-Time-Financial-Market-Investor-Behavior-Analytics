from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from ingestion.producers.market_producer import (
    DLQ_TOPIC,
    MARKET_TOPIC,
    EventContract,
    EventValidationError,
    MarketQuoteProducer,
    MemoryPublisher,
    build_market_quote_event,
    pseudonymize_user_id,
)


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "data-contracts" / "fixtures"
SCHEMA = ROOT / "data-contracts" / "events.schema.json"


def load_json(name: str):
    with (FIXTURES / name).open(encoding="utf-8") as stream:
        return json.load(stream)


@pytest.fixture
def contract() -> EventContract:
    return EventContract.from_file(SCHEMA, known_symbols={"AAPL", "TSLA", "BTC"})


def provider_record(**overrides):
    record = {
        "price_id": "d705d879-8f7c-49a9-8b70-8e18489f3622",
        "symbol": " aapl ",
        "source": "Yahoo",
        "timestamp": "2026-10-15T16:30:00+07:00",
        "open_price": 6242800,
        "high_price": 6300000,
        "low_price": 6215000,
        "close_price": 6287500,
        "volume": 42133700,
        "currency": "vnd",
        "provider_symbol": "AAPL",
    }
    record.update(overrides)
    return record


def test_valid_fixture_passes_contract(contract: EventContract) -> None:
    contract.validate(load_json("valid-market-quote.json"))


@pytest.mark.parametrize(
    ("fixture", "message"),
    [
        ("invalid-missing-event-id.json", "event_id"),
        ("invalid-timestamp.json", "date-time"),
    ],
)
def test_invalid_schema_fixtures_fail(contract: EventContract, fixture: str, message: str) -> None:
    with pytest.raises(EventValidationError, match=message) as error:
        contract.validate(load_json(fixture))
    assert error.value.code == "SCHEMA_VALIDATION_ERROR"


def test_unknown_symbol_fails_reference_validation(contract: EventContract) -> None:
    with pytest.raises(EventValidationError, match="UNKNOWN_ASSET") as error:
        contract.validate(load_json("invalid-unknown-symbol.json"))
    assert error.value.code == "UNKNOWN_SYMBOL"


def test_duplicate_fixture_fails_batch_validation(contract: EventContract) -> None:
    with pytest.raises(EventValidationError, match="Duplicate event_id") as error:
        contract.validate_many(load_json("invalid-duplicate-event.json"))
    assert error.value.code == "DUPLICATE_EVENT_ID"


def test_market_event_is_normalized_and_id_is_stable(contract: EventContract) -> None:
    first = build_market_quote_event(provider_record(), ingestion_time="2026-10-15T09:30:01Z")
    retry = build_market_quote_event(provider_record(), ingestion_time="2026-10-15T09:31:01Z")

    assert first["event_id"] == retry["event_id"]
    assert first["event_id"] == load_json("valid-market-quote.json")["event_id"]
    assert first["asset_symbol"] == "AAPL"
    assert first["source"] == "yahoo"
    assert first["event_time"] == "2026-10-15T09:30:00.000Z"
    assert first["payload"]["currency"] == "VND"
    contract.validate(first)


def test_producer_uses_symbol_key_for_valid_record(contract: EventContract) -> None:
    publisher = MemoryPublisher()
    producer = MarketQuoteProducer(publisher, contract)

    accepted = producer.publish_record(provider_record(), ingestion_time="2026-10-15T09:30:01Z")

    assert accepted is True
    assert len(publisher.records) == 1
    assert publisher.records[0].topic == MARKET_TOPIC
    assert publisher.records[0].key == "AAPL"


def test_producer_routes_invalid_record_to_dlq(contract: EventContract) -> None:
    publisher = MemoryPublisher()
    producer = MarketQuoteProducer(publisher, contract)

    accepted = producer.publish_record(
        provider_record(symbol="UNKNOWN_ASSET"), ingestion_time="2026-10-15T09:30:01Z"
    )

    assert accepted is False
    assert len(publisher.records) == 1
    assert publisher.records[0].topic == DLQ_TOPIC
    assert publisher.records[0].value["error_code"] == "UNKNOWN_SYMBOL"


def test_user_id_is_pseudonymous_and_salt_dependent() -> None:
    first = pseudonymize_user_id("a4f33138-b9c9-4e46-bc03-91ada28f6d03", "test-salt")
    second = pseudonymize_user_id("a4f33138-b9c9-4e46-bc03-91ada28f6d03", "other-salt")

    assert first.startswith("usr_")
    assert len(first) == 68
    assert first != second
    assert "a4f33138" not in first


def test_topic_declaration_contains_required_topics_and_key_rules() -> None:
    with (ROOT / "ingestion" / "kafka" / "topics.yaml").open(encoding="utf-8") as stream:
        config = yaml.safe_load(stream)

    topics = {topic["name"]: topic for topic in config["topics"]}
    assert set(topics) == {
        "market-quotes",
        "trades",
        "user-actions",
        "portfolio-snapshots",
        "dead-letter-events",
    }
    assert topics["market-quotes"]["key"] == "asset_symbol"
    assert topics["trades"]["key"] == "user_id"
    assert all(topic["retention_ms"] > 0 for topic in topics.values())
