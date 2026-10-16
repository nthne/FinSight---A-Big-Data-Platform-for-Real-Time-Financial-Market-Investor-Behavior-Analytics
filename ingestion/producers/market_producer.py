from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID, uuid5

from jsonschema import Draft202012Validator, FormatChecker


SCHEMA_VERSION = "1.0.0"
MARKET_TOPIC = "market-quotes"
DLQ_TOPIC = "dead-letter-events"
EVENT_NAMESPACE = UUID("b056c339-1f25-44c2-bc9d-d66b94e823df")


class EventValidationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class Publisher(Protocol):
    def publish(self, topic: str, key: str, value: Mapping[str, Any]) -> None: ...


@dataclass(frozen=True)
class PublishedRecord:
    topic: str
    key: str
    value: Mapping[str, Any]


class MemoryPublisher:
    """Deterministic test publisher used before a shared Kafka broker is available."""

    def __init__(self) -> None:
        self.records: list[PublishedRecord] = []

    def publish(self, topic: str, key: str, value: Mapping[str, Any]) -> None:
        self.records.append(PublishedRecord(topic=topic, key=key, value=dict(value)))


class EventContract:
    def __init__(self, schema: Mapping[str, Any], known_symbols: Iterable[str] = ()) -> None:
        Draft202012Validator.check_schema(schema)
        self._validator = Draft202012Validator(schema, format_checker=FormatChecker())
        self._known_symbols = {normalize_symbol(symbol) for symbol in known_symbols}

    @classmethod
    def from_file(cls, path: str | Path, known_symbols: Iterable[str] = ()) -> EventContract:
        with Path(path).open(encoding="utf-8") as stream:
            return cls(json.load(stream), known_symbols=known_symbols)

    def validate(self, event: Mapping[str, Any]) -> None:
        errors = sorted(self._validator.iter_errors(event), key=lambda error: list(error.path))
        if errors:
            error = errors[0]
            location = "/".join(str(part) for part in error.absolute_path) or "$"
            raise EventValidationError("SCHEMA_VALIDATION_ERROR", f"{location}: {error.message}")

        for field in ("event_time", "ingestion_time"):
            try:
                normalize_timestamp(event[field])
            except EventValidationError as error:
                raise EventValidationError(
                    "SCHEMA_VALIDATION_ERROR", f"{field}: must be a valid RFC 3339 date-time"
                ) from error

        symbol = event.get("asset_symbol")
        if symbol and self._known_symbols and symbol not in self._known_symbols:
            raise EventValidationError("UNKNOWN_SYMBOL", f"Unknown asset symbol: {symbol}")

    def validate_many(self, events: Iterable[Mapping[str, Any]]) -> None:
        seen: set[str] = set()
        for event in events:
            self.validate(event)
            event_id = str(event["event_id"])
            if event_id in seen:
                raise EventValidationError("DUPLICATE_EVENT_ID", f"Duplicate event_id: {event_id}")
            seen.add(event_id)


def normalize_symbol(value: Any) -> str:
    symbol = str(value).strip().upper()
    if not symbol:
        raise EventValidationError("NORMALIZATION_ERROR", "symbol is required")
    return symbol


def normalize_source(value: Any) -> str:
    source = str(value).strip().lower().replace(" ", "_")
    if len(source) < 2:
        raise EventValidationError("NORMALIZATION_ERROR", "source is required")
    return source


def normalize_timestamp(value: Any) -> str:
    if not isinstance(value, str):
        raise EventValidationError("NORMALIZATION_ERROR", "timestamp must be a string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise EventValidationError("NORMALIZATION_ERROR", "timestamp must be RFC 3339") from error
    if parsed.tzinfo is None:
        raise EventValidationError("NORMALIZATION_ERROR", "timestamp must include a timezone")
    return parsed.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _optional_number(record: Mapping[str, Any], key: str) -> float | int | None:
    value = record.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EventValidationError("NORMALIZATION_ERROR", f"{key} must be numeric")
    return value


def build_market_quote_event(
    record: Mapping[str, Any], *, ingestion_time: str | None = None
) -> dict[str, Any]:
    symbol = normalize_symbol(record.get("symbol"))
    source = normalize_source(record.get("source"))
    event_time = normalize_timestamp(record.get("timestamp"))
    accepted_at = normalize_timestamp(ingestion_time or datetime.now(UTC).isoformat())

    close_price = record.get("close_price", record.get("price"))
    if isinstance(close_price, bool) or not isinstance(close_price, (int, float)):
        raise EventValidationError("NORMALIZATION_ERROR", "close_price must be numeric")

    provider_record_id = record.get("price_id") or record.get("provider_event_id")
    identity = (
        f"{source}|{provider_record_id}"
        if provider_record_id
        else f"{source}|{symbol}|{event_time}"
    )
    event_id = str(uuid5(EVENT_NAMESPACE, f"market_quote|{identity}"))

    payload: dict[str, Any] = {
        "close_price": close_price,
        "currency": str(record.get("currency", "VND")).strip().upper(),
    }
    quote_id = record.get("price_id")
    if quote_id is not None:
        payload["quote_id"] = str(quote_id)
    for field in ("open_price", "high_price", "low_price", "volume"):
        value = _optional_number(record, field)
        if value is not None:
            payload[field] = value
    provider_symbol = record.get("provider_symbol")
    if provider_symbol:
        payload["provider_symbol"] = str(provider_symbol)

    return {
        "event_id": event_id,
        "event_type": "market_quote",
        "schema_version": SCHEMA_VERSION,
        "source": source,
        "event_time": event_time,
        "ingestion_time": accepted_at,
        "asset_symbol": symbol,
        "payload": payload,
    }


def pseudonymize_user_id(user_id: str, salt: str) -> str:
    if not user_id or not salt:
        raise ValueError("user_id and salt are required")
    digest = hashlib.sha256(f"{salt}:{user_id}".encode()).hexdigest()
    return f"usr_{digest}"


class MarketQuoteProducer:
    def __init__(self, publisher: Publisher, contract: EventContract) -> None:
        self._publisher = publisher
        self._contract = contract

    def publish_record(self, record: Mapping[str, Any], *, ingestion_time: str | None = None) -> bool:
        try:
            event = build_market_quote_event(record, ingestion_time=ingestion_time)
            self._contract.validate(event)
        except EventValidationError as error:
            source = str(record.get("source", "unknown"))
            failed_at = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            self._publisher.publish(
                DLQ_TOPIC,
                source,
                {
                    "error_code": error.code,
                    "error_message": str(error),
                    "failed_at": failed_at,
                    "source": source,
                    "raw_record": dict(record),
                },
            )
            return False

        self._publisher.publish(MARKET_TOPIC, event["asset_symbol"], event)
        return True


def _default_schema_path() -> Path:
    return Path(__file__).resolve().parents[2] / "data-contracts" / "events.schema.json"


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize and validate a FinSight market fixture")
    parser.add_argument("fixture", type=Path, help="JSON provider record to normalize")
    parser.add_argument("--schema", type=Path, default=_default_schema_path())
    parser.add_argument("--known-symbol", action="append", default=[])
    args = parser.parse_args()

    with args.fixture.open(encoding="utf-8") as stream:
        record = json.load(stream)
    contract = EventContract.from_file(args.schema, known_symbols=args.known_symbol)
    event = build_market_quote_event(record)
    contract.validate(event)
    print(json.dumps(event, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
