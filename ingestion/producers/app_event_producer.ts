import { createHash } from "node:crypto";

export type FinSightEventType =
  | "trade_executed"
  | "user_action"
  | "portfolio_snapshot";

export interface FinSightEvent {
  event_id: string;
  event_type: FinSightEventType;
  schema_version: "1.0.0";
  source: "finsight_app";
  event_time: string;
  ingestion_time: string;
  asset_symbol?: string;
  user_id: string;
  payload: Record<string, unknown>;
}

export interface TradeRecord {
  id: string;
  userId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  total: number;
  orderKind?: "market" | "limit" | "stop";
  status?: "pending" | "executed" | "cancelled" | "rejected";
  executedAt: string;
}

export interface UserActionRecord {
  id: string;
  userId: string;
  actionType: string;
  symbol?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface PortfolioSnapshotRecord {
  id: string;
  userId: string;
  totalValue: number;
  cashBalance: number;
  investedValue: number;
  pnl: number;
  riskScore?: number | null;
  diversificationScore?: number | null;
  createdAt: string;
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid event timestamp");
  return parsed.toISOString();
}

function positive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`);
  return value;
}

function nonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be non-negative`);
  return value;
}

export function pseudonymizeUserId(userId: string, salt: string): string {
  if (!userId || !salt) throw new Error("userId and ANALYTICS_USER_SALT are required");
  return `usr_${createHash("sha256").update(`${salt}:${userId}`).digest("hex")}`;
}

function envelope(
  eventId: string,
  eventType: FinSightEventType,
  userId: string,
  salt: string,
  eventTime: string,
): Omit<FinSightEvent, "payload"> {
  return {
    event_id: eventId,
    event_type: eventType,
    schema_version: "1.0.0",
    source: "finsight_app",
    event_time: timestamp(eventTime),
    ingestion_time: new Date().toISOString(),
    user_id: pseudonymizeUserId(userId, salt),
  };
}

export function buildTradeEvent(record: TradeRecord, salt: string): FinSightEvent {
  return {
    ...envelope(record.id, "trade_executed", record.userId, salt, record.executedAt),
    asset_symbol: record.symbol.trim().toUpperCase(),
    payload: {
      order_id: record.id,
      side: record.side,
      quantity: positive(record.quantity, "quantity"),
      price: positive(record.price, "price"),
      fee: nonNegative(record.fee, "fee"),
      total: record.total,
      order_kind: record.orderKind ?? "market",
      status: record.status ?? "executed",
    },
  };
}

export function buildUserActionEvent(record: UserActionRecord, salt: string): FinSightEvent {
  const event: FinSightEvent = {
    ...envelope(record.id, "user_action", record.userId, salt, record.createdAt),
    payload: {
      action_id: record.id,
      action_type: record.actionType,
      metadata: record.metadata ?? {},
    },
  };
  if (record.symbol) event.asset_symbol = record.symbol.trim().toUpperCase();
  return event;
}

export function buildPortfolioSnapshotEvent(
  record: PortfolioSnapshotRecord,
  salt: string,
): FinSightEvent {
  return {
    ...envelope(record.id, "portfolio_snapshot", record.userId, salt, record.createdAt),
    payload: {
      snapshot_id: record.id,
      total_value: nonNegative(record.totalValue, "totalValue"),
      cash_balance: nonNegative(record.cashBalance, "cashBalance"),
      invested_value: nonNegative(record.investedValue, "investedValue"),
      pnl: record.pnl,
      risk_score: record.riskScore ?? null,
      diversification_score: record.diversificationScore ?? null,
    },
  };
}

export async function publishAppEvent(
  event: FinSightEvent,
  options: {
    gatewayUrl?: string;
    token?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const gatewayUrl = options.gatewayUrl ?? process.env.INGESTION_GATEWAY_URL;
  const token = options.token ?? process.env.INGESTION_GATEWAY_TOKEN;
  if (!gatewayUrl || !token) throw new Error("Ingestion gateway is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 3000);
  try {
    const response = await (options.fetcher ?? fetch)(`${gatewayUrl.replace(/\/$/, "")}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ingestion-token": token },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ingestion gateway returned HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}
