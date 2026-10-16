from __future__ import annotations

import json
import os
from collections.abc import Mapping
from typing import Any


class KafkaPublishError(RuntimeError):
    """Raised when Kafka does not acknowledge a record within the bounded timeout."""


class ConfluentKafkaPublisher:
    """Small synchronous adapter with idempotent Kafka producer settings."""

    def __init__(self, config: Mapping[str, Any], *, flush_timeout: float = 10.0) -> None:
        try:
            from confluent_kafka import Producer
        except ImportError as error:
            raise RuntimeError(
                "confluent-kafka is required for live publishing; install ingestion/requirements.txt"
            ) from error

        self._producer = Producer(dict(config))
        self._flush_timeout = flush_timeout

    @classmethod
    def from_env(cls) -> ConfluentKafkaPublisher:
        bootstrap_servers = os.environ.get("KAFKA_BOOTSTRAP_SERVERS")
        if not bootstrap_servers:
            raise RuntimeError("KAFKA_BOOTSTRAP_SERVERS is required")

        config: dict[str, Any] = {
            "bootstrap.servers": bootstrap_servers,
            "client.id": os.environ.get("KAFKA_CLIENT_ID", "finsight-ingestion"),
            "enable.idempotence": True,
            "acks": "all",
            "retries": 10,
            "max.in.flight.requests.per.connection": 5,
            "delivery.timeout.ms": int(os.environ.get("KAFKA_DELIVERY_TIMEOUT_MS", "10000")),
            "request.timeout.ms": int(os.environ.get("KAFKA_REQUEST_TIMEOUT_MS", "5000")),
        }
        optional = {
            "security.protocol": "KAFKA_SECURITY_PROTOCOL",
            "sasl.mechanism": "KAFKA_SASL_MECHANISM",
            "sasl.username": "KAFKA_SASL_USERNAME",
            "sasl.password": "KAFKA_SASL_PASSWORD",
            "ssl.ca.location": "KAFKA_SSL_CA_LOCATION",
        }
        for kafka_key, env_key in optional.items():
            if value := os.environ.get(env_key):
                config[kafka_key] = value
        return cls(config)

    def publish(self, topic: str, key: str, value: Mapping[str, Any]) -> None:
        errors: list[str] = []

        def on_delivery(error, _message) -> None:
            if error is not None:
                errors.append(str(error))

        try:
            self._producer.produce(
                topic=topic,
                key=key.encode("utf-8"),
                value=json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8"),
                on_delivery=on_delivery,
            )
        except BufferError as error:
            raise KafkaPublishError("Kafka producer queue is full") from error

        outstanding = self._producer.flush(self._flush_timeout)
        if outstanding:
            raise KafkaPublishError(f"Kafka delivery timed out with {outstanding} record(s) pending")
        if errors:
            raise KafkaPublishError(errors[0])

    def ready(self, timeout: float = 3.0) -> bool:
        try:
            self._producer.list_topics(timeout=timeout)
        except Exception:
            return False
        return True
