// Typed client for the analytics serving API (serving/api_contract.md section 4).
// Dashboard code passes the user's Supabase access token; it never sends a user id.

export interface AnalyticsFreshness {
  computed_at: string | null;
  last_event_time: string | null;
  age_seconds: number | null;
  stale: boolean;
  stale_after_seconds: number;
}

export interface AnalyticsMeta {
  generated_at: string;
  source: { collection: string; dataset?: string; layers?: string[]; batch_cutoff?: string | null };
  freshness: AnalyticsFreshness | null;
  disclaimer: string;
}

export interface AnalyticsResponse<T> {
  data: T;
  meta: AnalyticsMeta;
}

interface WindowPoint {
  window_start: string;
  window_end: string;
  /** "speed" points are provisional until the batch layer replaces them. */
  layer: "batch" | "speed";
  provisional: boolean;
}

export interface LatestQuote {
  asset_symbol: string;
  last_price: number;
  currency: string | null;
  source: string | null;
  last_event_time: string | null;
  quote_age_seconds: number | null;
  stale: boolean;
  window_return_pct: number | null;
}

export interface MarketPoint extends WindowPoint {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  avg_price: number | null;
  price_stddev: number | null;
  volatility_pct: number | null;
  return_pct: number | null;
  volume: number | null;
  quote_count: number | null;
}

export interface ActivityPoint extends WindowPoint {
  trade_count: number;
  buy_count: number;
  sell_count: number;
  action_count: number;
  turnover: number;
  fees: number;
  distinct_assets: number;
  buy_ratio: number | null;
  /** Educational heuristic, not a diagnosis or advice. */
  overtrading_signal: boolean;
}

export interface ActivitySession {
  session_start: string;
  session_end: string;
  session_seconds: number | null;
  event_count: number;
  trade_count: number;
  distinct_assets: number;
}

export interface PipelineQueryHealth {
  query_name: string;
  batch_id: number;
  timestamp: string | null;
  input_rows_per_second: number | null;
  processed_rows_per_second: number | null;
  watermark: string | null;
  rows_dropped_by_watermark: number;
  state_rows_total: number;
}

export interface PipelineHealth {
  queries: PipelineQueryHealth[];
  gate: {
    window_hours: number;
    batches: number;
    invalid: number;
    too_late: number;
    by_error_code: Record<string, number>;
  };
  lambda: Array<{ dataset: string; batch_cutoff: string | null; batch_run_id?: string }>;
}

export interface AnalyticsRoutes {
  "market/latest": LatestQuote[];
  "market/series": { asset_symbol: string; granularity: string; points: MarketPoint[] };
  "me/activity": { granularity: string; points: ActivityPoint[] };
  "me/sessions": ActivitySession[];
  "me/risk": Record<string, unknown> | null;
  "me/segment": Record<string, unknown> | null;
  "pipeline/health": PipelineHealth;
}

export class AnalyticsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchAnalytics<R extends keyof AnalyticsRoutes>(
  route: R,
  accessToken: string,
  params: Record<string, string | number | undefined> = {},
  init: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<AnalyticsResponse<AnalyticsRoutes[R]>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const suffix = query.size ? `?${query}` : "";
  const response = await fetch(`${init.baseUrl ?? ""}/api/analytics/${route}${suffix}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: init.signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AnalyticsApiError(
      response.status,
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? `Analytics API returned HTTP ${response.status}`,
    );
  }
  return body as AnalyticsResponse<AnalyticsRoutes[R]>;
}
