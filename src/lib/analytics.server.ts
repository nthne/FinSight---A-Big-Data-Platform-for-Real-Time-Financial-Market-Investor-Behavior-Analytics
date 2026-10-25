// Analytics serving API (Person C): authenticated, read-only views over the MongoDB
// serving collections written by the speed layer (Spark Structured Streaming) and
// the batch layer. Contract: serving/api_contract.md section 4.
//
// Framework-independent on purpose: the TanStack route (src/routes/api/analytics.$.ts)
// only wires authentication and the database into handleAnalyticsRequest.
import type { Db, Document } from "mongodb";

import { pseudonymizeUserId } from "../../ingestion/producers/app_event_producer";
import { observeAnalyticsRequest } from "./app-metrics.server";

export const DISCLAIMER = "Educational analytics on simulated trading. Not investment advice.";

// Collections (serving/mongo_sink.py) and staleness budgets (api_contract.md 4.2).
const COLLECTIONS = {
  latest: "latest_market_metrics",
  series: "asset_time_series_summary",
  activity: "user_activity_windows",
  sessions: "user_sessions",
  risk: "portfolio_risk_views",
  segments: "investor_behavior_segments",
  metrics: "pipeline_quality_metrics",
  lambda: "lambda_state",
} as const;
const STALE_AFTER_SECONDS = { latest: 120, speed: 300, batch: 26 * 3600, pipeline: 300 } as const;
const MARKET_GRANULARITIES = ["1m", "5m_rolling", "1d"];
const ACTIVITY_GRANULARITIES = ["5m", "1d"];
// Same pattern as asset_symbol in data-contracts/events.schema.json.
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._=-]{0,31}$/;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Viewer {
  /** Supabase Auth user id (JWT `sub`); never stored or returned. */
  userId: string;
  isAdmin(): Promise<boolean>;
}

export interface AnalyticsDeps {
  authenticate(request: Request): Promise<Viewer>;
  database(): Promise<Db>;
  /** ANALYTICS_USER_SALT, shared with the ingestion gateway. */
  userSalt: string | null;
  now?: () => Date;
}

interface Freshness {
  computed_at: string | null;
  last_event_time: string | null;
  age_seconds: number | null;
  stale: boolean;
  stale_after_seconds: number;
}

interface RouteResult {
  data: unknown;
  source: Record<string, unknown>;
  freshness: Freshness | null;
}

interface RouteContext {
  params: URLSearchParams;
  viewer: Viewer;
  db: Db;
  now: Date;
  /** Pseudonymous analytics id of the viewer, as written into events by the producers. */
  analyticsUserId(): string;
}

interface Route {
  admin?: boolean;
  handler(ctx: RouteContext): Promise<RouteResult>;
}

// --- helpers -----------------------------------------------------------------------------

function iso(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function asDate(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

function invalid(message: string): ApiError {
  return new ApiError(400, "INVALID_PARAMETER", message);
}

function parseLimit(params: URLSearchParams, fallback: number, max: number): number {
  const raw = params.get("limit");
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw invalid(`limit must be an integer between 1 and ${max}`);
  }
  return value;
}

function parseChoice(
  params: URLSearchParams,
  name: string,
  allowed: string[],
  fallback: string,
): string {
  const value = params.get(name) ?? fallback;
  if (!allowed.includes(value)) throw invalid(`${name} must be one of ${allowed.join(", ")}`);
  return value;
}

function parseTime(params: URLSearchParams, name: string): Date | null {
  const raw = params.get(name);
  if (raw === null || raw === "") return null;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) throw invalid(`${name} must be an ISO-8601 timestamp`);
  return value;
}

function parseSymbol(raw: string | null, name: string): string {
  if (!raw || !SYMBOL_PATTERN.test(raw))
    throw invalid(`${name} must be a canonical asset symbol such as AAPL`);
  return raw;
}

function freshness(
  lastEvent: Date | null,
  computedAt: Date | null,
  staleAfter: number,
  now: Date,
): Freshness {
  const age = lastEvent ? Math.round((now.getTime() - lastEvent.getTime()) / 100) / 10 : null;
  return {
    computed_at: iso(computedAt),
    last_event_time: iso(lastEvent),
    age_seconds: age,
    // Missing timestamps count as stale: never present unknown data as current.
    stale: age === null || age > staleAfter,
    stale_after_seconds: staleAfter,
  };
}

async function readCutoff(db: Db, dataset: string): Promise<Date | null> {
  const doc = await db.collection<Document>(COLLECTIONS.lambda).findOne({ _id: dataset as never });
  return asDate(doc?.batch_cutoff);
}

/** Lambda rule from serving/lambda_reconciliation.py: exactly one layer per window. */
function servingFilter(cutoff: Date | null): Document {
  if (!cutoff) return { layer: "speed" };
  return {
    $or: [
      { layer: "batch", window_end: { $lte: cutoff } },
      { layer: "speed", window_end: { $gt: cutoff } },
    ],
  };
}

/** Defensive: never serve two documents for one window, even if the store is inconsistent. */
function onePerWindow(docs: Document[]): Document[] {
  const chosen = new Map<string, Document>();
  for (const doc of docs) {
    const current = chosen.get(doc.series_key);
    if (!current) chosen.set(doc.series_key, doc);
    else if (doc.layer === "batch" && current.layer !== "batch") chosen.set(doc.series_key, doc);
  }
  return [...chosen.values()].sort(
    (a, b) => (asDate(a.window_start)?.getTime() ?? 0) - (asDate(b.window_start)?.getTime() ?? 0),
  );
}

async function windowSeries(
  ctx: RouteContext,
  collection: string,
  dataset: string,
  match: Document,
  limit: number,
  from: Date | null = null,
  to: Date | null = null,
) {
  const cutoff = await readCutoff(ctx.db, dataset);
  const range: Document = {};
  if (from) range.$gte = from;
  if (to) range.$lt = to;
  const filter: Document = { ...match, ...servingFilter(cutoff) };
  if (from || to) filter.window_start = range;
  const docs = await ctx.db
    .collection(collection)
    .find(filter)
    .sort({ window_start: -1 })
    .limit(limit)
    .toArray();
  const points = onePerWindow(docs);
  const last = points.at(-1);
  const staleAfter =
    last?.layer === "batch" ? STALE_AFTER_SECONDS.batch : STALE_AFTER_SECONDS.speed;
  return {
    points,
    source: {
      collection,
      dataset,
      layers: [...new Set(points.map((p) => p.layer))].sort(),
      batch_cutoff: iso(cutoff),
    },
    freshness: last
      ? freshness(
          asDate(last.last_event_time) ?? asDate(last.window_end),
          asDate(last.computed_at),
          staleAfter,
          ctx.now,
        )
      : null,
  };
}

function windowFields(doc: Document) {
  return {
    window_start: iso(doc.window_start),
    window_end: iso(doc.window_end),
    layer: doc.layer,
    provisional: doc.layer !== "batch",
  };
}

async function latestUserDoc(ctx: RouteContext, collection: string): Promise<RouteResult> {
  const doc = await ctx.db
    .collection(collection)
    .find({ user_id: ctx.analyticsUserId() }, { projection: { _id: 0, user_id: 0 } })
    .sort({ computed_at: -1 })
    .limit(1)
    .next();
  const data = doc
    ? Object.fromEntries(
        Object.entries(doc).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
      )
    : null;
  return {
    data,
    source: { collection, layers: ["batch"] },
    freshness: doc
      ? freshness(
          asDate(doc.computed_at),
          asDate(doc.computed_at),
          STALE_AFTER_SECONDS.batch,
          ctx.now,
        )
      : null,
  };
}

// --- routes ------------------------------------------------------------------------------

const ROUTES: Record<string, Route> = {
  "market/latest": {
    async handler(ctx) {
      const raw = ctx.params.get("symbols");
      const symbols = raw
        ? [
            ...new Set(
              raw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ]
        : null;
      if (symbols && symbols.length > 50) throw invalid("symbols accepts at most 50 symbols");
      symbols?.forEach((s) => parseSymbol(s, "symbols"));
      const docs = await ctx.db
        .collection<Document>(COLLECTIONS.latest)
        .find(symbols ? { _id: { $in: symbols as never[] } } : {})
        .sort({ _id: 1 })
        .limit(500)
        .toArray();
      const data = docs.map((doc) => {
        const quote = freshness(
          asDate(doc.last_event_time),
          asDate(doc.computed_at),
          STALE_AFTER_SECONDS.latest,
          ctx.now,
        );
        return {
          asset_symbol: doc.asset_symbol,
          last_price: doc.last_price,
          currency: doc.currency ?? null,
          source: doc.source ?? null,
          last_event_time: quote.last_event_time,
          quote_age_seconds: quote.age_seconds,
          stale: quote.stale,
          window_return_pct: doc.window_return_pct ?? null,
        };
      });
      const newest = docs.reduce<Document | null>(
        (best, doc) =>
          !best ||
          (asDate(doc.last_event_time)?.getTime() ?? 0) >
            (asDate(best.last_event_time)?.getTime() ?? 0)
            ? doc
            : best,
        null,
      );
      return {
        data,
        source: { collection: COLLECTIONS.latest, layers: ["speed"] },
        freshness: newest
          ? freshness(
              asDate(newest.last_event_time),
              asDate(newest.computed_at),
              STALE_AFTER_SECONDS.latest,
              ctx.now,
            )
          : null,
      };
    },
  },

  "market/series": {
    async handler(ctx) {
      const symbol = parseSymbol(ctx.params.get("symbol"), "symbol");
      const granularity = parseChoice(ctx.params, "granularity", MARKET_GRANULARITIES, "1m");
      const limit = parseLimit(ctx.params, 200, 1000);
      const from = parseTime(ctx.params, "from");
      const to = parseTime(ctx.params, "to");
      const series = await windowSeries(
        ctx,
        COLLECTIONS.series,
        `market:${granularity}`,
        { asset_symbol: symbol, granularity },
        limit,
        from,
        to,
      );
      return {
        data: {
          asset_symbol: symbol,
          granularity,
          points: series.points.map((p) => ({
            ...windowFields(p),
            open: p.open ?? null,
            high: p.high ?? null,
            low: p.low ?? null,
            close: p.close ?? null,
            avg_price: p.avg_price ?? null,
            price_stddev: p.price_stddev ?? null,
            volatility_pct: p.volatility_pct ?? null,
            return_pct: p.return_pct ?? null,
            volume: p.volume ?? null,
            quote_count: p.quote_count ?? null,
          })),
        },
        source: series.source,
        freshness: series.freshness,
      };
    },
  },

  "me/activity": {
    async handler(ctx) {
      const granularity = parseChoice(ctx.params, "granularity", ACTIVITY_GRANULARITIES, "5m");
      const limit = parseLimit(ctx.params, 48, 288);
      const series = await windowSeries(
        ctx,
        COLLECTIONS.activity,
        `user_activity:${granularity}`,
        { user_id: ctx.analyticsUserId(), granularity },
        limit,
      );
      return {
        data: {
          granularity,
          points: series.points.map((p) => ({
            ...windowFields(p),
            trade_count: p.trade_count ?? 0,
            buy_count: p.buy_count ?? 0,
            sell_count: p.sell_count ?? 0,
            action_count: p.action_count ?? 0,
            turnover: p.turnover ?? 0,
            fees: p.fees ?? 0,
            distinct_assets: p.distinct_assets ?? 0,
            buy_ratio: p.buy_ratio ?? null,
            overtrading_signal: p.overtrading_signal ?? false,
          })),
        },
        source: series.source,
        freshness: series.freshness,
      };
    },
  },

  "me/sessions": {
    async handler(ctx) {
      const limit = parseLimit(ctx.params, 20, 50);
      const docs = await ctx.db
        .collection(COLLECTIONS.sessions)
        .find({ user_id: ctx.analyticsUserId() })
        .sort({ session_end: -1 })
        .limit(limit)
        .toArray();
      const newest = docs[0];
      return {
        data: docs.map((d) => ({
          session_start: iso(d.session_start),
          session_end: iso(d.session_end),
          session_seconds: d.session_seconds ?? null,
          event_count: d.event_count ?? 0,
          trade_count: d.trade_count ?? 0,
          distinct_assets: d.distinct_assets ?? 0,
        })),
        source: { collection: COLLECTIONS.sessions, layers: ["speed"] },
        // Sessions are final once emitted (append mode), so they age like batch views.
        freshness: newest
          ? freshness(
              asDate(newest.last_event_time),
              asDate(newest.computed_at),
              STALE_AFTER_SECONDS.batch,
              ctx.now,
            )
          : null,
      };
    },
  },

  "me/risk": { handler: (ctx) => latestUserDoc(ctx, COLLECTIONS.risk) },
  "me/segment": { handler: (ctx) => latestUserDoc(ctx, COLLECTIONS.segments) },

  "pipeline/health": {
    admin: true,
    async handler(ctx) {
      const metrics = ctx.db.collection(COLLECTIONS.metrics);
      const since = new Date(ctx.now.getTime() - 24 * 3600 * 1000);
      const [progress, gates, lambda] = await Promise.all([
        metrics
          .aggregate([
            { $match: { kind: "progress" } },
            { $sort: { timestamp: -1 } },
            { $group: { _id: "$query_name", doc: { $first: "$$ROOT" } } },
            { $replaceRoot: { newRoot: "$doc" } },
            { $sort: { query_name: 1 } },
          ])
          .toArray(),
        metrics.find({ kind: "gate", computed_at: { $gte: since } }).toArray(),
        ctx.db.collection(COLLECTIONS.lambda).find({}).sort({ _id: 1 }).toArray(),
      ]);
      const byError: Record<string, number> = {};
      let invalidTotal = 0;
      let tooLate = 0;
      for (const gate of gates) {
        invalidTotal += gate.invalid ?? 0;
        tooLate += gate.by_lateness?.too_late ?? 0;
        for (const [code, n] of Object.entries(
          (gate.by_error_code ?? {}) as Record<string, number>,
        )) {
          byError[code] = (byError[code] ?? 0) + n;
        }
      }
      const newest = progress.reduce<Date | null>((best, p) => {
        const ts = asDate(p.timestamp);
        return ts && (!best || ts > best) ? ts : best;
      }, null);
      return {
        data: {
          queries: progress.map((p) => ({
            query_name: p.query_name,
            batch_id: p.batch_id,
            timestamp: iso(p.timestamp),
            input_rows_per_second: p.input_rows_per_second ?? null,
            processed_rows_per_second: p.processed_rows_per_second ?? null,
            watermark: iso(p.watermark),
            rows_dropped_by_watermark: p.rows_dropped_by_watermark ?? 0,
            state_rows_total: p.state_rows_total ?? 0,
          })),
          gate: {
            window_hours: 24,
            batches: gates.length,
            invalid: invalidTotal,
            too_late: tooLate,
            by_error_code: byError,
          },
          lambda: lambda.map((l) => ({
            dataset: l._id,
            batch_cutoff: iso(l.batch_cutoff),
            batch_run_id: l.batch_run_id,
          })),
        },
        source: { collection: COLLECTIONS.metrics },
        freshness: freshness(newest, newest, STALE_AFTER_SECONDS.pipeline, ctx.now),
      };
    },
  },
};

// --- entry point ---------------------------------------------------------------------------

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Responses contain per-user data; never cache them in shared caches.
      "cache-control": "private, no-store",
    },
  });
}

function errorResponse(error: ApiError): Response {
  return json(error.status, { error: { code: error.code, message: error.message } });
}

export async function handleAnalyticsRequest(
  request: Request,
  deps: AnalyticsDeps,
): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const path = new URL(request.url).pathname
    .replace(/^\/api\/analytics\/?/, "")
    .replace(/\/+$/, "");
  const startedAt = performance.now();
  let status = 500;
  try {
    // Authenticate before resolving the route so anonymous callers learn nothing.
    const viewer = await deps.authenticate(request);
    const route = ROUTES[path];
    if (!route) throw new ApiError(404, "NOT_FOUND", "Unknown analytics route");
    if (route.admin && !(await viewer.isAdmin())) {
      throw new ApiError(403, "FORBIDDEN", "This view requires the admin role");
    }

    let db: Db;
    try {
      db = await deps.database();
    } catch (error) {
      console.error("analytics: serving store unavailable", error);
      throw new ApiError(503, "SERVING_UNAVAILABLE", "The analytics store is unavailable");
    }

    const ctx: RouteContext = {
      params: new URL(request.url).searchParams,
      viewer,
      db,
      now,
      analyticsUserId() {
        if (!deps.userSalt) {
          throw new ApiError(503, "SERVING_UNAVAILABLE", "User analytics are not configured");
        }
        return pseudonymizeUserId(viewer.userId, deps.userSalt);
      },
    };
    const result = await route.handler(ctx);
    status = 200;
    return json(status, {
      data: result.data,
      meta: {
        generated_at: now.toISOString(),
        source: result.source,
        freshness: result.freshness,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      status = error.status;
      return errorResponse(error);
    }
    console.error("analytics: request failed", error);
    const mongo = error instanceof Error && error.name.startsWith("Mongo");
    const apiError = mongo
      ? new ApiError(503, "SERVING_UNAVAILABLE", "The analytics store is unavailable")
      : new ApiError(500, "INTERNAL", "Unexpected error");
    status = apiError.status;
    return errorResponse(apiError);
  } finally {
    observeAnalyticsRequest(path, status, performance.now() - startedAt);
  }
}
