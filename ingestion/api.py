from __future__ import annotations

import hmac
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Response, status

from ingestion.metrics import IngestionMetrics
from ingestion.producers.kafka_publisher import ConfluentKafkaPublisher, KafkaPublishError
from ingestion.producers.market_producer import EventContract, EventValidationError, Publisher


TOPICS_BY_EVENT_TYPE = {
    "market_quote": "market-quotes",
    "trade_executed": "trades",
    "user_action": "user-actions",
    "portfolio_snapshot": "portfolio-snapshots",
}


def _schema_path() -> Path:
    return Path(__file__).resolve().parents[1] / "data-contracts" / "events.schema.json"


def _known_symbols() -> set[str]:
    return {item.strip().upper() for item in os.environ.get("KNOWN_ASSET_SYMBOLS", "").split(",") if item.strip()}


def create_app(
    *,
    publisher: Publisher | None = None,
    contract: EventContract | None = None,
    ingestion_token: str | None = None,
    metrics: IngestionMetrics | None = None,
) -> FastAPI:
    app = FastAPI(title="FinSight ingestion gateway", version="1.0.0")
    event_contract = contract or EventContract.from_file(_schema_path(), known_symbols=_known_symbols())
    event_publisher = publisher
    token = ingestion_token if ingestion_token is not None else os.environ.get("INGESTION_GATEWAY_TOKEN", "")
    counters = metrics or IngestionMetrics()

    def get_publisher() -> Publisher:
        nonlocal event_publisher
        if event_publisher is None:
            event_publisher = ConfluentKafkaPublisher.from_env()
        return event_publisher

    def authorize(value: str | None) -> None:
        if not token:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway token is not configured")
        if value is None or not hmac.compare_digest(value, token):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid ingestion token")

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz() -> dict[str, str]:
        candidate = get_publisher()
        if hasattr(candidate, "ready") and not candidate.ready():
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Kafka is unavailable")
        return {"status": "ready"}

    @app.get("/metrics")
    def prometheus_metrics() -> Response:
        return Response(counters.render(), media_type="text/plain; version=0.0.4")

    @app.post("/v1/events", status_code=status.HTTP_202_ACCEPTED)
    def publish_event(
        event: dict[str, Any], x_ingestion_token: str | None = Header(default=None)
    ) -> dict[str, str]:
        authorize(x_ingestion_token)
        source = str(event.get("source", "unknown"))
        try:
            event_contract.validate(event)
        except EventValidationError as error:
            counters.record_rejected(source, error.code)
            try:
                get_publisher().publish(
                    "dead-letter-events",
                    source,
                    {
                        "error_code": error.code,
                        "error_message": str(error),
                        "failed_at": datetime.now(UTC).isoformat(),
                        "source": source,
                        "raw_record": event,
                    },
                )
            except (KafkaPublishError, RuntimeError):
                counters.record_publish_failure("dead-letter-events")
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{error.code}: {error}") from error

        event_type = str(event["event_type"])
        topic = TOPICS_BY_EVENT_TYPE[event_type]
        key = str(event.get("asset_symbol") or event.get("user_id") or source)
        try:
            get_publisher().publish(topic, key, event)
        except (KafkaPublishError, RuntimeError) as error:
            counters.record_publish_failure(topic)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(error)) from error
        counters.record_accepted(source, event_type)
        return {"event_id": str(event["event_id"]), "topic": topic, "status": "accepted"}

    return app


app = create_app()
