from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
import tracemalloc
from pathlib import Path


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) - 1) * fraction)))
    return ordered[index]


def run(events: int, output: Path | None = None) -> dict[str, object]:
    if events < 1:
        raise ValueError("events must be positive")
    sample_every = max(1, events // 100_000)
    samples: list[float] = []
    input_bytes = 0
    accepted = 0
    output_stream = output.open("wb") if output else None
    tracemalloc.start()
    started = time.perf_counter()
    try:
        for index in range(events):
            event_started = time.perf_counter_ns()
            symbol = ("AAPL", "TSLA", "MSFT", "BTC")[index % 4]
            event = {
                "event_id": hashlib.sha256(f"scale-{index}".encode()).hexdigest()[:32],
                "event_type": "market_quote",
                "schema_version": "1.0.0",
                "source": "scale_fixture",
                "event_time": "2026-10-15T16:30:00Z",
                "ingestion_time": "2026-10-15T16:30:01Z",
                "asset_symbol": symbol,
                "payload": {"close_price": 100 + (index % 1000) / 10, "currency": "USD"},
            }
            encoded = (json.dumps(event, separators=(",", ":")) + "\n").encode()
            input_bytes += len(encoded)
            if output_stream:
                output_stream.write(encoded)
            accepted += 1
            if index % sample_every == 0:
                samples.append((time.perf_counter_ns() - event_started) / 1_000_000)
    finally:
        if output_stream:
            output_stream.close()
    elapsed = time.perf_counter() - started
    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return {
        "events": events,
        "accepted": accepted,
        "rejected": events - accepted,
        "input_bytes": input_bytes,
        "runtime_seconds": round(elapsed, 6),
        "events_per_second": round(events / elapsed, 2),
        "p95_event_generation_ms_sampled": round(percentile(samples, 0.95), 6),
        "latency_sample_count": len(samples),
        "peak_python_memory_bytes": peak_bytes,
        "output": str(output) if output else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure the ingestion event-generation baseline")
    parser.add_argument("--events", type=int, default=1_000_000)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = run(args.events, args.output)
    print(json.dumps(result, indent=2, sort_keys=True))
    if args.output:
        print(json.dumps({"output_bytes": os.path.getsize(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
