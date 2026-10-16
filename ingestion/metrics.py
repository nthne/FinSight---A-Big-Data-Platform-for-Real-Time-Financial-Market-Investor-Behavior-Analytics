from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock


@dataclass
class IngestionMetrics:
    """Dependency-free counters that can be rendered in Prometheus text format."""

    accepted: dict[tuple[str, str], int] = field(default_factory=dict)
    rejected: dict[tuple[str, str], int] = field(default_factory=dict)
    publish_failures: dict[str, int] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock, repr=False)

    def record_accepted(self, source: str, event_type: str) -> None:
        with self._lock:
            key = (source, event_type)
            self.accepted[key] = self.accepted.get(key, 0) + 1

    def record_rejected(self, source: str, error_code: str) -> None:
        with self._lock:
            key = (source, error_code)
            self.rejected[key] = self.rejected.get(key, 0) + 1

    def record_publish_failure(self, topic: str) -> None:
        with self._lock:
            self.publish_failures[topic] = self.publish_failures.get(topic, 0) + 1

    def render(self) -> str:
        lines = [
            "# HELP finsight_ingestion_accepted_total Accepted events published to Kafka.",
            "# TYPE finsight_ingestion_accepted_total counter",
        ]
        for (source, event_type), value in sorted(self.accepted.items()):
            lines.append(
                f'finsight_ingestion_accepted_total{{source="{source}",event_type="{event_type}"}} {value}'
            )
        lines.extend(
            [
                "# HELP finsight_ingestion_rejected_total Events rejected before publishing.",
                "# TYPE finsight_ingestion_rejected_total counter",
            ]
        )
        for (source, error_code), value in sorted(self.rejected.items()):
            lines.append(
                f'finsight_ingestion_rejected_total{{source="{source}",error_code="{error_code}"}} {value}'
            )
        lines.extend(
            [
                "# HELP finsight_ingestion_publish_failures_total Kafka publishing failures.",
                "# TYPE finsight_ingestion_publish_failures_total counter",
            ]
        )
        for topic, value in sorted(self.publish_failures.items()):
            lines.append(f'finsight_ingestion_publish_failures_total{{topic="{topic}"}} {value}')
        return "\n".join(lines) + "\n"
