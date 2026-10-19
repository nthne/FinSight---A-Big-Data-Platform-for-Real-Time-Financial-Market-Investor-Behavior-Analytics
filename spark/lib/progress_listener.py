"""Records StreamingQueryProgress events in ``pipeline_quality_metrics``.

Spark does not expose rows dropped by the watermark, but it does count them
(``numRowsDroppedByWatermark``). Storing every progress event gives the
monitoring dashboard and the report the input/processing rates, batch
durations, watermark, state size and dropped-row counts per query.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from typing import Callable

from pyspark.sql.streaming import StreamingQueryListener

log = logging.getLogger(__name__)


def _parse_ts(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def progress_as_dict(progress) -> dict:
    """Accept a StreamingQueryProgress object or an already-parsed dict."""
    if isinstance(progress, dict):
        return progress
    return json.loads(progress.json)


def progress_doc(progress: dict) -> dict:
    ops = progress.get("stateOperators") or []
    event_time = progress.get("eventTime") or {}
    return {
        "_id": f"progress|{progress.get('name')}|{progress.get('runId')}|{progress.get('batchId')}",
        "kind": "progress",
        "query_name": progress.get("name"),
        "query_id": progress.get("id"),
        "query_run_id": progress.get("runId"),
        "batch_id": progress.get("batchId"),
        "timestamp": _parse_ts(progress.get("timestamp")),
        "num_input_rows": progress.get("numInputRows", 0),
        "input_rows_per_second": progress.get("inputRowsPerSecond"),
        "processed_rows_per_second": progress.get("processedRowsPerSecond"),
        "duration_ms": progress.get("durationMs") or {},
        "watermark": _parse_ts(event_time.get("watermark")),
        "max_event_time": _parse_ts(event_time.get("max")),
        "state_rows_total": sum(op.get("numRowsTotal", 0) for op in ops),
        "state_rows_updated": sum(op.get("numRowsUpdated", 0) for op in ops),
        "rows_dropped_by_watermark": sum(op.get("numRowsDroppedByWatermark", 0) for op in ops),
        "state_memory_bytes": sum(op.get("memoryUsedBytes", 0) for op in ops),
        "sources": [
            {
                "description": src.get("description"),
                "start_offset": json.dumps(src.get("startOffset")),
                "end_offset": json.dumps(src.get("endOffset")),
                "latest_offset": json.dumps(src.get("latestOffset")),
                "num_input_rows": src.get("numInputRows"),
                "metrics": src.get("metrics") or {},
            }
            for src in progress.get("sources") or []
        ],
    }


class MongoProgressListener(StreamingQueryListener):
    """Must never raise: a failing listener would only lose metrics."""

    def __init__(self, collection_factory: Callable[[], object]):
        self._collection_factory = collection_factory

    def onQueryStarted(self, event):
        pass

    def onQueryProgress(self, event):
        try:
            doc = progress_doc(progress_as_dict(event.progress))
            self._collection_factory().replace_one({"_id": doc["_id"]}, doc, upsert=True)
        except Exception:  # noqa: BLE001 - metrics are best effort
            log.exception("could not store streaming progress")

    def onQueryIdle(self, event):
        pass

    def onQueryTerminated(self, event):
        if event.exception:
            log.error("streaming query %s terminated with error: %s", event.id, event.exception)
