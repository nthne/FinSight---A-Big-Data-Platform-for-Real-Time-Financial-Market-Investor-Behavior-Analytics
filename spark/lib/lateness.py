"""Late-event policy for the speed layer.

Spark 4 tracks two watermarks per micro-batch N of a stateful query
(SPARK-40925, used since Spark 3.4):

    eviction watermark      ew(N) = max(event_time in batches < N)     - delay
    late-events watermark   lw(N) = ew(N - 1)
                                  = max(event_time in batches < N - 1) - delay

State is evicted with ``ew`` but input rows are only dropped when
``event_time <= lw``, i.e. Spark is one micro-batch more lenient than the
watermark it reports. Whether a too-late event is dropped therefore depends
on micro-batch boundaries (a restart or an idle no-data batch moves them),
which is why the batch layer, not the speed layer, is authoritative.

Spark does not expose the rows it drops, so the event gate reproduces the
rule and gives every valid event one of three documented classes:

* ``on_time``       event_time >= high-water mark before this batch
* ``accepted_late`` out of order but newer than lw(N); still aggregated
* ``too_late``      event_time <= lw(N); dropped by the speed layer and
                    written to the diagnostic output. The batch layer still
                    includes it from bronze.

The gate runs as its own query, so its batches line up with an aggregation
query's batches only when both read the same offsets per trigger. The marks
are persisted per (query, run_id, group) so that a retried micro-batch is
classified exactly like its first attempt.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

ON_TIME = "on_time"
ACCEPTED_LATE = "accepted_late"
TOO_LATE = "too_late"

# Events that share a Spark query share a watermark, so lateness is tracked
# per group of event types rather than globally.
LATENESS_GROUPS = {
    "market_quote": "market",
    "trade_executed": "behavior",
    "user_action": "behavior",
    "portfolio_snapshot": "portfolio",
}


def as_utc(value: datetime | None) -> datetime | None:
    """Normalise datetimes read from MongoDB (naive UTC or aware) to aware UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def spark_ts_to_utc(value: datetime | None) -> datetime | None:
    """PySpark builds naive datetimes in the Python process's local zone."""
    if value is None:
        return None
    return value.astimezone(timezone.utc)


@dataclass(frozen=True)
class BatchMarks:
    """What a micro-batch is classified against."""

    high_water_mark: datetime | None  # max event time in batches < N
    late_watermark: datetime | None  # lw(N); None until two batches have run


def classify(event_time: datetime, marks: BatchMarks) -> str:
    if marks.high_water_mark is None or event_time >= marks.high_water_mark:
        return ON_TIME
    if marks.late_watermark is not None and event_time <= marks.late_watermark:
        return TOO_LATE
    return ACCEPTED_LATE


@dataclass(frozen=True)
class GroupState:
    """Rolling high-water marks for one lateness group.

    After batch ``last_batch_id`` (= L) committed:
    ``max_event_time`` = hwm before L + 1, ``prev_max_event_time`` = hwm
    before L and ``prev_prev_max_event_time`` = hwm before L - 1.
    """

    last_batch_id: int | None = None
    max_event_time: datetime | None = None
    prev_max_event_time: datetime | None = None
    prev_prev_max_event_time: datetime | None = None

    def _hwm_before(self, batch_id: int) -> tuple[datetime | None, datetime | None]:
        """(hwm before batch_id, hwm before batch_id - 1)."""
        if self.last_batch_id is not None and batch_id == self.last_batch_id:
            # Retry of the last committed batch: reuse its original marks.
            return self.prev_max_event_time, self.prev_prev_max_event_time
        return self.max_event_time, self.prev_max_event_time

    def marks_for_batch(self, batch_id: int, delay: timedelta) -> BatchMarks:
        hwm, previous_hwm = self._hwm_before(batch_id)
        return BatchMarks(hwm, previous_hwm - delay if previous_hwm is not None else None)

    def advance(self, batch_id: int, batch_max: datetime | None) -> "GroupState":
        hwm, previous_hwm = self._hwm_before(batch_id)
        candidates = [t for t in (hwm, batch_max) if t is not None]
        return GroupState(
            last_batch_id=batch_id,
            max_event_time=max(candidates) if candidates else None,
            prev_max_event_time=hwm,
            prev_prev_max_event_time=previous_hwm,
        )

    def to_doc(self) -> dict:
        return {
            "last_batch_id": self.last_batch_id,
            "max_event_time": self.max_event_time,
            "prev_max_event_time": self.prev_max_event_time,
            "prev_prev_max_event_time": self.prev_prev_max_event_time,
        }

    @classmethod
    def from_doc(cls, doc: dict | None) -> "GroupState":
        if not doc:
            return cls()
        return cls(
            last_batch_id=doc.get("last_batch_id"),
            max_event_time=as_utc(doc.get("max_event_time")),
            prev_max_event_time=as_utc(doc.get("prev_max_event_time")),
            prev_prev_max_event_time=as_utc(doc.get("prev_prev_max_event_time")),
        )


class LatenessStateStore:
    """Persists ``GroupState`` per (query, run_id, group) in MongoDB."""

    def __init__(self, collection, query_name: str, run_id: str):
        self._collection = collection
        self._prefix = f"lateness|{query_name}|{run_id}"

    def _id(self, group: str) -> str:
        return f"{self._prefix}|{group}"

    def load(self, group: str) -> GroupState:
        return GroupState.from_doc(self._collection.find_one({"_id": self._id(group)}))

    def save(self, group: str, state: GroupState) -> None:
        doc = state.to_doc()
        doc["updated_at"] = datetime.now(timezone.utc)
        self._collection.replace_one({"_id": self._id(group)}, doc, upsert=True)


def lateness_column(event_time_col, group_col, marks: dict[str, BatchMarks]):
    """Spark expression implementing ``classify`` for every group at once."""
    from pyspark.sql import functions as F

    expr = None
    for group, m in marks.items():
        if m.high_water_mark is None:
            branch = F.lit(ON_TIME)
        else:
            branch = F.when(event_time_col >= F.lit(m.high_water_mark), F.lit(ON_TIME))
            if m.late_watermark is not None:
                branch = branch.when(event_time_col <= F.lit(m.late_watermark), F.lit(TOO_LATE))
            branch = branch.otherwise(F.lit(ACCEPTED_LATE))
        condition = group_col == F.lit(group)
        expr = F.when(condition, branch) if expr is None else expr.when(condition, branch)
    return F.lit(ON_TIME) if expr is None else expr.otherwise(F.lit(ON_TIME))
