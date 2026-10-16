import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketQuoteEvent,
  publishMarketQuoteEvents,
} from "../../supabase/functions/market-refresh/analytics.ts";

const asset = { symbol: "AAPL", currency: "VND", provider_symbol: "AAPL" };
const price = {
  symbol: "AAPL",
  close: 4_900_000,
  source: "yahoo",
  volume: 123,
  timestamp: "2026-10-16T10:00:00.000Z",
};

test("builds stable provider event IDs", async () => {
  const first = await buildMarketQuoteEvent(price, asset, "2026-10-16T10:01:00.000Z");
  const retry = await buildMarketQuoteEvent(price, asset, "2026-10-16T10:02:00.000Z");
  assert.equal(first.event_id, retry.event_id);
  assert.equal(first.payload.currency, "VND");
  assert.equal(first.asset_symbol, "AAPL");
});

test("keeps gateway credentials outside event bodies", async () => {
  let requestBody = "";
  const result = await publishMarketQuoteEvents({
    prices: [price],
    assets: new Map([["AAPL", asset]]),
    ingestionTime: "2026-10-16T10:01:00.000Z",
    gatewayUrl: "https://ingestion.internal/",
    gatewayToken: "server-secret",
    fetchImpl: async (_input, init) => {
      requestBody = String(init?.body);
      assert.equal(new Headers(init?.headers).get("x-ingestion-token"), "server-secret");
      return new Response(null, { status: 202 });
    },
  });
  assert.deepEqual(result, { accepted: 1, failed: 0, disabled: false });
  assert.equal(requestBody.includes("server-secret"), false);
});

test("stays disabled until server secrets are configured", async () => {
  const result = await publishMarketQuoteEvents({
    prices: [price],
    assets: new Map([["AAPL", asset]]),
    ingestionTime: "2026-10-16T10:01:00.000Z",
  });
  assert.deepEqual(result, { accepted: 0, failed: 0, disabled: true });
});
