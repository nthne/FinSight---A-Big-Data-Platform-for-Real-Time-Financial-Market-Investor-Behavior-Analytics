import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortfolioSnapshotEvent,
  buildTradeEvent,
  buildUserActionEvent,
  publishAppEvent,
  pseudonymizeUserId,
} from "../producers/app_event_producer.ts";

const userId = "a4f33138-b9c9-4e46-bc03-91ada28f6d03";
const salt = "test-only-salt";

test("builds stable pseudonymous trade event", () => {
  const event = buildTradeEvent(
    {
      id: "71fdc15d-9484-4ce5-8139-70c4a8208f4f",
      userId,
      symbol: " aapl ",
      side: "buy",
      quantity: 2,
      price: 100,
      fee: 1,
      total: -201,
      executedAt: "2026-10-15T09:30:00Z",
    },
    salt,
  );
  assert.equal(event.event_id, "71fdc15d-9484-4ce5-8139-70c4a8208f4f");
  assert.equal(event.asset_symbol, "AAPL");
  assert.equal(event.payload.total, -201);
  assert.equal(event.user_id, pseudonymizeUserId(userId, salt));
  assert.equal(event.user_id.includes(userId), false);
});

test("builds user action and portfolio snapshot events", () => {
  const action = buildUserActionEvent(
    {
      id: "c92f8cc6-9e39-4e1f-811a-1f87be8bc6b6",
      userId,
      actionType: "view_portfolio",
      metadata: { page: "portfolio" },
      createdAt: "2026-10-15T09:30:00Z",
    },
    salt,
  );
  const snapshot = buildPortfolioSnapshotEvent(
    {
      id: "31e2e182-05b9-4632-84c1-ca7535c1dbce",
      userId,
      totalValue: 1000,
      cashBalance: 400,
      investedValue: 600,
      pnl: -20,
      createdAt: "2026-10-15T09:31:00Z",
    },
    salt,
  );
  assert.equal(action.event_type, "user_action");
  assert.equal(snapshot.event_type, "portfolio_snapshot");
  assert.equal(snapshot.payload.pnl, -20);
});

test("publishes only through configured server gateway", async () => {
  const event = buildUserActionEvent(
    {
      id: "c92f8cc6-9e39-4e1f-811a-1f87be8bc6b6",
      userId,
      actionType: "view_portfolio",
      createdAt: "2026-10-15T09:30:00Z",
    },
    salt,
  );
  let request: { url: string; init?: RequestInit } | undefined;
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    request = { url: String(input), init };
    return new Response(null, { status: 202 });
  };
  await publishAppEvent(event, {
    gatewayUrl: "http://ingestion:8080/",
    token: "internal-token",
    fetcher,
  });
  assert.equal(request?.url, "http://ingestion:8080/v1/events");
  assert.equal((request?.init?.headers as Record<string, string>)["x-ingestion-token"], "internal-token");
});
