"""Lambda reconciliation: authoritative batch results replace provisional speed results.

Both layers write window documents into the same collection with the same
``series_key`` and a ``layer`` field (``_id = "<layer>|<series_key>"``), so they
never overwrite each other.

Rule (one per dataset, e.g. ``market:1m``):

* After a batch run has written *every* window whose ``window_end <= T``, it
  publishes ``batch_cutoff = T`` in ``lambda_state``. Publishing is the commit
  marker: batch documents beyond the cutoff, or from a run that never
  published, are ignored.
* Readers take batch documents with ``window_end <= cutoff`` and speed
  documents with ``window_end > cutoff``. Each window therefore comes from
  exactly one layer and is never double counted.
* With no published cutoff, only speed documents are served.
* The cutoff only moves forward, so publishing is idempotent and a slow,
  older batch run cannot hide newer batch results.

Too-late events that the speed layer dropped are still in bronze, so the
batch layer's numbers for those windows are complete; that is how the
architecture corrects late data.
"""

from __future__ import annotations

import datetime as dt
from typing import Iterable

from pymongo.errors import DuplicateKeyError

BATCH = "batch"
SPEED = "speed"


def dataset_id(kind: str, granularity: str) -> str:
    return f"{kind}:{granularity}"


def _utc(value: dt.datetime | None) -> dt.datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value.astimezone(dt.timezone.utc)


def publish_batch_cutoff(collection, dataset: str, cutoff: dt.datetime, batch_run_id: str) -> bool:
    """Advance the dataset's cutoff; returns False if a later cutoff already exists.

    Person B's batch job calls this only after its writes for the dataset
    completed successfully.
    """
    if cutoff.tzinfo is None:
        raise ValueError("cutoff must be timezone-aware")
    try:
        collection.update_one(
            {
                "_id": dataset,
                "$or": [{"batch_cutoff": {"$lte": cutoff}}, {"batch_cutoff": {"$exists": False}}],
            },
            {
                "$set": {
                    "batch_cutoff": cutoff,
                    "batch_run_id": batch_run_id,
                    "published_at": dt.datetime.now(dt.timezone.utc),
                }
            },
            upsert=True,
        )
        return True
    except DuplicateKeyError:
        return False


def read_cutoff(collection, dataset: str) -> dt.datetime | None:
    doc = collection.find_one({"_id": dataset}, {"batch_cutoff": 1})
    return _utc(doc.get("batch_cutoff")) if doc else None


def serving_filter(cutoff: dt.datetime | None, base: dict | None = None) -> dict:
    """MongoDB filter that selects exactly one layer per window."""
    base = dict(base or {})
    if cutoff is None:
        return {**base, "layer": SPEED}
    return {
        **base,
        "$or": [
            {"layer": BATCH, "window_end": {"$lte": cutoff}},
            {"layer": SPEED, "window_end": {"$gt": cutoff}},
        ],
    }


def is_served(doc: dict, cutoff: dt.datetime | None) -> bool:
    window_end = _utc(doc["window_end"])
    if cutoff is None:
        return doc["layer"] == SPEED
    if doc["layer"] == BATCH:
        return window_end <= cutoff
    return doc["layer"] == SPEED and window_end > cutoff


def reconcile(docs: Iterable[dict], cutoff: dt.datetime | None) -> list[dict]:
    """In-memory equivalent of ``serving_filter``, ordered by window start.

    Raises if two served documents share a series key, which would mean the
    rule double counts a window.
    """
    chosen: dict[str, dict] = {}
    for doc in docs:
        if not is_served(doc, cutoff):
            continue
        key = doc["series_key"]
        if key in chosen:
            raise ValueError(f"window {key} served by more than one document")
        chosen[key] = doc
    return sorted(chosen.values(), key=lambda d: _utc(d["window_start"]))


def prune_superseded_speed(collection, cutoff: dt.datetime, grace: dt.timedelta, base: dict | None = None) -> int:
    """Delete speed documents that the batch layer has superseded.

    The grace period keeps recent speed documents around for comparison in
    the reconciliation evidence. Returns the number of deleted documents.
    """
    flt = {**(base or {}), "layer": SPEED, "window_end": {"$lte": cutoff - grace}}
    return collection.delete_many(flt).deleted_count
