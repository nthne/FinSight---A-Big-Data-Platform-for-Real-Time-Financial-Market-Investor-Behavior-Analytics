from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from ingestion.producers.market_producer import EventContract, EventValidationError, pseudonymize_user_id


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "data-contracts" / "events.schema.json"
FIXTURES = ROOT / "data-contracts" / "fixtures"


def read_json(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_contract_rejects_unknown_schema_version() -> None:
    contract = EventContract.from_file(SCHEMA, known_symbols={"AAPL"})
    event = read_json("valid-market-quote.json")
    event["schema_version"] = "9.0.0"
    with pytest.raises(EventValidationError, match="schema_version"):
        contract.validate(event)


def test_pseudonymization_is_non_reversible_for_known_user_id() -> None:
    user_id = "a4f33138-b9c9-4e46-bc03-91ada28f6d03"
    pseudonym = pseudonymize_user_id(user_id, "quality-test-salt")
    assert pseudonym.startswith("usr_")
    assert user_id not in pseudonym
    assert re.fullmatch(r"usr_[0-9a-f]{64}", pseudonym)


def test_repository_has_no_common_private_key_material() -> None:
    forbidden = [
        re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
        re.compile(r"AKIA[0-9A-Z]{16}"),
        re.compile(r"sk_live_[A-Za-z0-9]{16,}"),
    ]
    ignored_parts = {".git", "node_modules", "dist", ".codex_tmp"}
    for path in ROOT.rglob("*"):
        if not path.is_file() or ignored_parts.intersection(path.parts):
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        assert not any(pattern.search(content) for pattern in forbidden), path
