import hashlib
import re
from datetime import datetime, timedelta, timezone

import pytest

from serving.keys import market_series_key, pseudonymize_user_id, serving_id, session_key, user_series_key

UTC7 = timezone(timedelta(hours=7))


def test_market_key_is_normalised_and_timezone_independent():
    start = datetime(2026, 10, 5, 10, 0, tzinfo=timezone.utc)
    key = market_series_key(" aapl ", "1m", start)
    assert key == "mkt|AAPL|1m|2026-10-05T10:00:00Z"
    assert market_series_key("AAPL", "1m", start.astimezone(UTC7)) == key
    assert serving_id("speed", key) == "speed|mkt|AAPL|1m|2026-10-05T10:00:00Z"


def test_user_and_session_keys():
    start = datetime(2026, 10, 5, 10, 0, tzinfo=timezone.utc)
    assert user_series_key("abc", "5m", start) == "usr|abc|5m|2026-10-05T10:00:00Z"
    assert session_key("abc", start) == "ses|abc|2026-10-05T10:00:00Z"


@pytest.mark.parametrize(
    "call",
    [
        lambda: market_series_key("AAPL", "1m", datetime(2026, 10, 5, 10, 0)),  # naive
        lambda: market_series_key("A|B", "1m", datetime(2026, 10, 5, tzinfo=timezone.utc)),
        lambda: serving_id("hot", "mkt|AAPL"),
    ],
)
def test_invalid_key_inputs_are_rejected(call):
    with pytest.raises(ValueError):
        call()


def test_pseudonymized_ids_follow_the_event_contract():
    uid = "6f9619ff-8b86-d011-b42d-00c04fc964ff"
    first = pseudonymize_user_id(uid, "salt-a")
    assert first == "usr_" + hashlib.sha256(f"salt-a:{uid}".encode()).hexdigest()
    assert re.fullmatch(r"usr_[a-f0-9]{64}", first) and uid not in first
    assert first == pseudonymize_user_id(uid, "salt-a")
    assert first != pseudonymize_user_id(uid, "salt-b")
    with pytest.raises(ValueError):
        pseudonymize_user_id(uid, "")


def test_pseudonymized_ids_match_the_ingestion_producers():
    """The API must find the documents keyed by the user_id that producers put in events."""
    pytest.importorskip("jsonschema")  # imported by the producer module
    from ingestion.producers.market_producer import pseudonymize_user_id as producer_pseudonym

    uid = "a4f33138-b9c9-4e46-bc03-91ada28f6d03"
    assert pseudonymize_user_id(uid, "shared-salt") == producer_pseudonym(uid, "shared-salt")
