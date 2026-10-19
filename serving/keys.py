"""Deterministic serving keys shared by Spark jobs, tests and the API.

A serving document's ``_id`` is ``"<layer>|<series_key>"``. The series key only
depends on business identifiers and the event-time window, never on wall-clock
time, batch ids or retries, so re-running a micro-batch or replaying the same
events always targets the same document.

Series key formats (timestamps are UTC, second precision, ``Z`` suffix):

    market window   mkt|<ASSET_SYMBOL>|<granularity>|<window_start>
    user window     usr|<pseudo_user_id>|<granularity>|<window_start>
    user session    ses|<pseudo_user_id>|<session_start>
    latest quote    <ASSET_SYMBOL>            (collection latest_market_metrics)

The Spark expressions in ``spark/jobs/streaming`` build the same strings;
``serving/tests/test_keys.py`` checks that both implementations agree.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

LAYERS = ("batch", "speed")
SEP = "|"
# Spark date_format pattern that renders the same text as ``iso_utc``.
SPARK_TS_PATTERN = "yyyy-MM-dd'T'HH:mm:ss'Z'"


def iso_utc(ts: datetime) -> str:
    if ts.tzinfo is None:
        raise ValueError("serving keys need timezone-aware datetimes")
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _check_part(part: str) -> str:
    if not part or SEP in part:
        raise ValueError(f"invalid key component {part!r}")
    return part


def market_series_key(asset_symbol: str, granularity: str, window_start: datetime) -> str:
    return SEP.join(
        ["mkt", _check_part(asset_symbol.strip().upper()), _check_part(granularity), iso_utc(window_start)]
    )


def user_series_key(pseudo_user_id: str, granularity: str, window_start: datetime) -> str:
    return SEP.join(["usr", _check_part(pseudo_user_id), _check_part(granularity), iso_utc(window_start)])


def session_key(pseudo_user_id: str, session_start: datetime) -> str:
    return SEP.join(["ses", _check_part(pseudo_user_id), iso_utc(session_start)])


def serving_id(layer: str, series_key: str) -> str:
    if layer not in LAYERS:
        raise ValueError(f"layer must be one of {LAYERS}, got {layer!r}")
    return f"{layer}{SEP}{series_key}"


def pseudonymize_user_id(raw_user_id: str, salt: str) -> str:
    """Pseudonymous analytics id (``usr_<sha256>``) for a Supabase user id.

    Must stay byte-for-byte identical to the producers, which put this value in
    every event's ``user_id`` (``ingestion/producers/market_producer.py`` and
    ``pseudonymizeUserId`` in ``ingestion/producers/app_event_producer.ts``):
    ``"usr_" + sha256(f"{salt}:{user_id}").hexdigest()``. ``salt`` is the
    server-only ``ANALYTICS_USER_SALT`` secret shared with the ingestion
    gateway. The API uses it to map an authenticated user to their analytics
    documents without storing raw ids.
    """
    if not raw_user_id or not salt:
        raise ValueError("raw_user_id and ANALYTICS_USER_SALT are required")
    return "usr_" + hashlib.sha256(f"{salt}:{raw_user_id}".encode()).hexdigest()
