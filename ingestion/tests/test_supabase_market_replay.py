"""Tests for paginated Supabase replay and deterministic event IDs."""
from __future__ import annotations

import unittest

from ingestion.producers.supabase_market_replay import SupabaseReader, to_quote_event
from ingestion.producers.market_producer import EventContract
from pathlib import Path


class FakeClient:
    def __init__(self, pages):
        self.pages = iter(pages)
        self.calls = []

    def select(self, table, params):
        self.calls.append((table, params))
        return next(self.pages)


class SupabaseReplayTests(unittest.TestCase):
    def test_keyset_pagination(self):
        first = {"timestamp": "2026-11-01T00:00:00+00:00", "price_id": "00000000-0000-4000-8000-000000000001"}
        second = {"timestamp": "2026-11-01T00:00:00+00:00", "price_id": "00000000-0000-4000-8000-000000000002"}
        client = FakeClient([[first, second], []])
        items = list(SupabaseReader(client).iter_prices(
            since="2026-10-01T00:00:00Z",
            until="2026-11-02T00:00:00Z",
            after=None, page_size=2, max_events=10,
        ))
        self.assertEqual(len(items), 2)
        query = dict(client.calls[1][1])
        self.assertIn(second["price_id"], query["or"])
        self.assertIn("coingecko", dict(client.calls[0][1])["source"])

    def test_event_schema_and_stable_id(self):
        row = {
            "price_id": "f63d5b50-95a1-4428-8a74-727c01dc6711",
            "asset_id": "a",
            "source": "coingecko",
            "timestamp": "2026-11-01T02:00:00+00:00",
            "close_price": "2500000.25",
            "open_price": None,
            "high_price": None,
            "low_price": None,
            "volume": "120",
        }
        asset = {"symbol": "BTC", "currency": "VND", "provider_symbol": "bitcoin"}
        first = to_quote_event(row, asset, "2026-11-09T02:00:00Z")
        second = to_quote_event(row, asset, "2026-11-09T02:00:05Z")
        self.assertEqual(first["event_id"], second["event_id"])
        self.assertEqual(first["source"], "coingecko")
        self.assertEqual(first["payload"]["quote_id"], row["price_id"])
        EventContract.from_file(Path(__file__).resolve().parents[2] / "data-contracts/events.schema.json").validate(first)


if __name__ == "__main__":
    unittest.main()
