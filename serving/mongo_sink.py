"""Idempotent MongoDB writes for the speed and batch layers.

Spark Structured Streaming gives at-least-once execution of ``foreachBatch``:
after a failure the last micro-batch is re-run with the same ``batch_id`` and
the same input offsets. Writes are made idempotent by

1. upserting on a deterministic ``_id`` (see ``serving/keys.py``), and
2. ``$set``-ing complete aggregate values (never ``$inc``),

so a retried or replayed batch rewrites identical values instead of adding
duplicates. Together with the checkpointed Kafka offsets this gives an
*effectively exactly-once* serving view; it is not a distributed transaction.

``latest_market_metrics`` additionally uses a guard field so an older quote
can never overwrite a newer one (see ``guarded_upsert``).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from typing import Callable, Iterable, Iterator

from pymongo import MongoClient, UpdateOne
from pymongo.errors import BulkWriteError

DUPLICATE_KEY_ERROR = 11000
BULK_CHUNK = 1000

# Collection names (see serving/mongo_schema.js and serving/api_contract.md).
ASSET_TIME_SERIES = "asset_time_series_summary"
LATEST_MARKET = "latest_market_metrics"
USER_ACTIVITY = "user_activity_windows"
USER_SESSIONS = "user_sessions"
PIPELINE_METRICS = "pipeline_quality_metrics"
LAMBDA_STATE = "lambda_state"
STREAM_STATE = "stream_state"


@dataclass
class SinkResult:
    rows: int = 0
    matched: int = 0
    modified: int = 0
    upserted: int = 0
    # Guarded upserts rejected because the stored document is newer.
    stale_skipped: int = 0

    def __add__(self, other: "SinkResult") -> "SinkResult":
        return SinkResult(*(a + b for a, b in zip(self.as_tuple(), other.as_tuple(), strict=True)))

    def as_tuple(self) -> tuple[int, int, int, int, int]:
        return (self.rows, self.matched, self.modified, self.upserted, self.stale_skipped)

    def as_dict(self) -> dict:
        return asdict(self)


def to_bson(value):
    """Convert values from ``Row.asDict(recursive=True)`` into BSON-safe values.

    PySpark turns TimestampType into naive datetimes in the *local* zone of
    the Python worker, so naive values are interpreted as local time and
    converted to aware UTC. Pass aware datetimes from non-Spark callers.
    """
    if isinstance(value, dt.datetime):
        return value.astimezone(dt.timezone.utc)
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {k: to_bson(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_bson(v) for v in value]
    return value


@dataclass(frozen=True)
class SinkSettings:
    """Plain, picklable settings shipped to Spark executors."""

    mongo_uri: str
    database: str
    collection: str
    query_name: str
    run_id: str
    layer: str | None = None
    # When set, only overwrite documents whose guard value is <= the incoming one.
    guard_field: str | None = None
    extra_meta: dict = field(default_factory=dict)


def _metadata(settings: SinkSettings, batch_id: int, computed_at: dt.datetime) -> dict:
    meta = {
        "query_name": settings.query_name,
        "run_id": settings.run_id,
        "batch_id": batch_id,
        "computed_at": computed_at,
        **settings.extra_meta,
    }
    if settings.layer is not None:
        meta["layer"] = settings.layer
        meta["provisional"] = settings.layer == "speed"
    return meta


def _with_freshness(fields: dict, computed_at: dt.datetime) -> dict:
    last_event = fields.get("last_event_time")
    if isinstance(last_event, dt.datetime):
        fields["data_freshness_seconds"] = round((computed_at - last_event).total_seconds(), 3)
    return fields


def _update_doc(doc: dict, meta: dict) -> dict:
    fields = {k: v for k, v in doc.items() if k != "_id"}
    fields.update(meta)
    _with_freshness(fields, meta["computed_at"])
    return {"$set": fields, "$setOnInsert": {"first_computed_at": meta["computed_at"]}}


def upsert_op(doc: dict, meta: dict) -> UpdateOne:
    return UpdateOne({"_id": doc["_id"]}, _update_doc(doc, meta), upsert=True)


def guarded_upsert(doc: dict, meta: dict, guard_field: str) -> UpdateOne:
    """Upsert that refuses to move ``guard_field`` backwards.

    If the stored document has a newer guard value the filter does not match,
    MongoDB tries to insert the same ``_id`` and reports a duplicate-key
    error, which ``execute`` counts as ``stale_skipped``.
    """
    guard_value = doc.get(guard_field)
    if guard_value is None:
        raise ValueError(f"guarded document {doc.get('_id')!r} has no {guard_field!r}")
    flt = {
        "_id": doc["_id"],
        "$or": [{guard_field: {"$lte": guard_value}}, {guard_field: {"$exists": False}}],
    }
    return UpdateOne(flt, _update_doc(doc, meta), upsert=True)


def execute(collection, ops: list[UpdateOne]) -> SinkResult:
    if not ops:
        return SinkResult()
    try:
        result = collection.bulk_write(ops, ordered=False)
        return SinkResult(
            rows=len(ops),
            matched=result.matched_count,
            modified=result.modified_count,
            upserted=result.upserted_count,
        )
    except BulkWriteError as exc:
        details = exc.details or {}
        errors = details.get("writeErrors", [])
        if any(err.get("code") != DUPLICATE_KEY_ERROR for err in errors):
            raise
        return SinkResult(
            rows=len(ops),
            matched=details.get("nMatched", 0),
            modified=details.get("nModified", 0),
            upserted=details.get("nUpserted", 0),
            stale_skipped=len(errors),
        )


def write_docs(collection, docs: Iterable[dict], settings: SinkSettings, batch_id: int, computed_at: dt.datetime) -> SinkResult:
    meta = _metadata(settings, batch_id, computed_at)
    total = SinkResult()
    chunk: list[UpdateOne] = []
    for raw in docs:
        doc = to_bson(raw)
        chunk.append(guarded_upsert(doc, meta, settings.guard_field) if settings.guard_field else upsert_op(doc, meta))
        if len(chunk) >= BULK_CHUNK:
            total = total + execute(collection, chunk)
            chunk = []
    return total + execute(collection, chunk)


_CLIENTS: dict[str, MongoClient] = {}


def shared_client(uri: str) -> MongoClient:
    """One pooled client per process (driver or executor Python worker)."""
    client = _CLIENTS.get(uri)
    if client is None:
        client = MongoClient(uri, tz_aware=True, retryWrites=True)
        _CLIENTS[uri] = client
    return client


def _partition_writer(settings: SinkSettings, batch_id: int, computed_at: dt.datetime):
    def run(rows: Iterator) -> Iterator[tuple]:
        collection = shared_client(settings.mongo_uri)[settings.database][settings.collection]
        docs = (row.asDict(recursive=True) for row in rows)
        yield write_docs(collection, docs, settings, batch_id, computed_at).as_tuple()

    return run


class MongoUpsertWriter:
    """Writes a micro-batch DataFrame (must contain ``_id``) to MongoDB.

    ``mode="executor"`` writes from each Spark partition in parallel;
    ``mode="driver"`` collects the batch first, which is fine for the small
    aggregate outputs of the speed layer and lets tests inject a fake
    collection through ``collection_factory``.
    """

    def __init__(
        self,
        settings: SinkSettings,
        *,
        mode: str = "executor",
        collection_factory: Callable[[], object] | None = None,
    ):
        if mode not in ("executor", "driver"):
            raise ValueError("mode must be 'executor' or 'driver'")
        if mode == "executor" and collection_factory is not None:
            raise ValueError("collection_factory only applies to driver mode")
        self.settings = settings
        self.mode = mode
        self._collection_factory = collection_factory

    def collection(self):
        if self._collection_factory is not None:
            return self._collection_factory()
        return shared_client(self.settings.mongo_uri)[self.settings.database][self.settings.collection]

    def write(self, df, batch_id: int, computed_at: dt.datetime | None = None) -> SinkResult:
        if "_id" not in df.columns:
            raise ValueError("serving DataFrames must contain an _id column")
        computed_at = computed_at or dt.datetime.now(dt.timezone.utc)
        if self.mode == "driver":
            docs = (row.asDict(recursive=True) for row in df.toLocalIterator())
            return write_docs(self.collection(), docs, self.settings, batch_id, computed_at)
        parts = df.rdd.mapPartitions(_partition_writer(self.settings, batch_id, computed_at)).collect()
        total = SinkResult()
        for part in parts:
            total = total + SinkResult(*part)
        return total


def record_batch_metrics(collection, *, kind: str, query_name: str, run_id: str, batch_id: int, values: dict) -> None:
    """Store per-micro-batch counters, keyed so a retry overwrites them.

    ``attempts`` counts how many times the batch ran, which is the evidence
    that a retried batch did not change the serving documents.
    """
    now = dt.datetime.now(dt.timezone.utc)
    collection.update_one(
        {"_id": f"{kind}|{query_name}|{run_id}|{batch_id}"},
        {
            "$set": {
                "kind": kind,
                "query_name": query_name,
                "run_id": run_id,
                "batch_id": batch_id,
                "computed_at": now,
                **to_bson(values),
            },
            "$inc": {"attempts": 1},
            "$setOnInsert": {"first_attempt_at": now},
        },
        upsert=True,
    )
