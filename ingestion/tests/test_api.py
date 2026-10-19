from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from ingestion.api import create_app
from ingestion.metrics import IngestionMetrics
from ingestion.producers.market_producer import EventContract, MemoryPublisher


ROOT = Path(__file__).resolve().parents[2]


def valid_event() -> dict:
    with (ROOT / "data-contracts" / "fixtures" / "valid-market-quote.json").open(
        encoding="utf-8"
    ) as stream:
        return json.load(stream)


def make_client():
    publisher = MemoryPublisher()
    metrics = IngestionMetrics()
    contract = EventContract.from_file(
        ROOT / "data-contracts" / "events.schema.json", known_symbols={"AAPL"}
    )
    app = create_app(
        publisher=publisher,
        contract=contract,
        ingestion_token="test-token",
        metrics=metrics,
    )
    return TestClient(app), publisher, metrics


def test_gateway_requires_internal_token() -> None:
    client, publisher, _metrics = make_client()
    response = client.post("/v1/events", json=valid_event())
    assert response.status_code == 401
    assert publisher.records == []


def test_gateway_routes_valid_event_by_symbol() -> None:
    client, publisher, metrics = make_client()
    response = client.post(
        "/v1/events", json=valid_event(), headers={"x-ingestion-token": "test-token"}
    )
    assert response.status_code == 202
    assert response.json()["topic"] == "market-quotes"
    assert publisher.records[0].key == "AAPL"
    assert metrics.accepted[("yahoo", "market_quote")] == 1


def test_gateway_rejects_invalid_event_and_exports_metric() -> None:
    client, publisher, metrics = make_client()
    event = valid_event()
    event.pop("event_id")
    response = client.post(
        "/v1/events", json=event, headers={"x-ingestion-token": "test-token"}
    )
    assert response.status_code == 422
    assert publisher.records[0].topic == "dead-letter-events"
    assert publisher.records[0].value["error_code"] == "SCHEMA_VALIDATION_ERROR"
    assert metrics.rejected[("yahoo", "SCHEMA_VALIDATION_ERROR")] == 1
    assert "finsight_ingestion_rejected_total" in client.get("/metrics").text


def test_gateway_reports_bounded_publish_failure() -> None:
    class FailingPublisher(MemoryPublisher):
        def publish(self, topic, key, value):
            raise RuntimeError("broker unavailable")

    metrics = IngestionMetrics()
    contract = EventContract.from_file(
        ROOT / "data-contracts" / "events.schema.json", known_symbols={"AAPL"}
    )
    client = TestClient(
        create_app(
            publisher=FailingPublisher(),
            contract=contract,
            ingestion_token="test-token",
            metrics=metrics,
        )
    )
    response = client.post(
        "/v1/events", json=valid_event(), headers={"x-ingestion-token": "test-token"}
    )
    assert response.status_code == 503
    assert metrics.publish_failures["market-quotes"] == 1
