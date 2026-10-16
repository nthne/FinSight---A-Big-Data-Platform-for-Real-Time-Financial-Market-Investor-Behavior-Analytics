from __future__ import annotations

from dataclasses import dataclass

import pytest

from storage.jobs.kafka_to_bronze import write_and_commit


@dataclass
class FakeConsumer:
    commits: int = 0
    closed: bool = False

    def commit(self, *, asynchronous: bool):
        assert asynchronous is False
        self.commits += 1

    def close(self):
        self.closed = True


class FakeWriter:
    def __init__(self, *, fail: bool = False):
        self.fail = fail

    def write_run(self, events, *, run_id, kafka_metadata):
        assert run_id == "run-001"
        assert len(events) == len(kafka_metadata)
        if self.fail:
            raise RuntimeError("object storage unavailable")
        return {"accepted": len(events)}


def test_offsets_commit_only_after_bronze_write() -> None:
    consumer = FakeConsumer()
    result = write_and_commit([{"event_id": "one"}], [object()], consumer, FakeWriter(), run_id="run-001")
    assert result == {"accepted": 1}
    assert consumer.commits == 1
    assert consumer.closed is True


def test_failed_bronze_write_leaves_offsets_uncommitted() -> None:
    consumer = FakeConsumer()
    with pytest.raises(RuntimeError, match="object storage unavailable"):
        write_and_commit(
            [{"event_id": "one"}], [object()], consumer, FakeWriter(fail=True), run_id="run-001"
        )
    assert consumer.commits == 0
    assert consumer.closed is True
