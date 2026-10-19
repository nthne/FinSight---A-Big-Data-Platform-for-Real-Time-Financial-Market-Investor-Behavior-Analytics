# FinSight Analytics Serving Contract (v1 draft)

**Owner:** Person C (streaming and serving)
**Readers:** Person D (dashboard), Person B (batch writes into the same views), Person A (event producers)
**Status:** aligned with event contract `1.0.0` (`data-contracts/events.schema.json`, frozen by Person A on 2026-10-16). The MongoDB side is implemented and tested; the HTTP routes (`src/routes/api/analytics*`) are not implemented yet (Task 9).

## 1. Data flow

```text
gateway ──► Kafka ──► Spark Structured Streaming (speed, provisional) ──┐
                                                           ├──► MongoDB serving collections ──► /api/analytics/* ──► React
             bronze Parquet ──► Spark batch (authoritative) ────────────┘          (lambda_state cutoff decides which layer is served)
```

## 2. Serving collections

Created by `python -m serving.mongo_setup` (or `mongosh serving/mongo_schema.js`); definitions live in `serving/mongo_schema.json`.

| Collection | Written by | `_id` | Purpose |
| --- | --- | --- | --- |
| `asset_time_series_summary` | C (speed), B (batch) | `<layer>\|mkt\|<SYMBOL>\|<granularity>\|<window_start>` | OHLC of `close_price`, moving average, rolling volatility per window; `volume` is the last provider-reported volume in the window (cumulative session or 24-hour volume, never summed) |
| `latest_market_metrics` | C | `<SYMBOL>` | Latest quote per asset; never overwritten by an older quote |
| `user_activity_windows` | C (speed), B (batch) | `<layer>\|usr\|<user_id>\|<granularity>\|<window_start>` | Trading/behaviour activity per user and window (executed trades only) |
| `user_sessions` | C | `speed\|ses\|<user_id>\|<session_start>` | Activity sessions (15-minute inactivity gap) |
| `portfolio_risk_views` | B | defined by B | Drawdown, concentration, risk per user |
| `investor_behavior_segments` | B | defined by B | KMeans segment per user |
| `pipeline_quality_metrics` | C, A, B | `<kind>\|<query>\|<run_id>\|<batch_id>` | Stream progress, gate counters, sink counters |
| `lambda_state` | B publishes, C reads | `<dataset>` e.g. `market:1m` | Batch cutoff per dataset |
| `stream_state` | C | `lateness\|<query>\|<run_id>\|<group>` | Internal: late-event high-water marks |

Key rules (implemented in `serving/keys.py`, checked by `serving/tests/test_keys.py`):

- Timestamps in keys are UTC, second precision, `Z` suffix: `2026-10-05T10:00:00Z`.
- Symbols are the contract's canonical `asset_symbol` (`^[A-Z0-9][A-Z0-9._=-]{0,31}$`, so never `|`).
- `user_id` is the event's pseudonymous id `usr_<64 hex>`; the validators of `user_activity_windows` and `user_sessions` reject anything else, so a raw Supabase id cannot be stored.
- `granularity` labels: `1m`, `5m_rolling` (5-minute window sliding every minute) for markets; `5m` for user activity. The batch layer adds e.g. `1d` with the same format.
- Keys never contain batch ids, retry counters or wall-clock time, so retries and replays overwrite the same document.

Every window document contains at least `series_key`, `layer` (`batch` | `speed`), `provisional` (true for speed), `window_start`, `window_end`, `computed_at`, `run_id`, `batch_id`, `query_name`, `first_computed_at` and `data_freshness_seconds` (= `computed_at - last_event_time`). The validators in `mongo_schema.json` enforce the required subset.

## 3. Lambda reconciliation (batch replaces speed)

Implemented in `serving/lambda_reconciliation.py`, tested in `serving/tests/test_lambda_reconciliation.py`.

1. After a batch run has written **every** window with `window_end <= T` for a dataset, the batch job calls
   `publish_batch_cutoff(db.lambda_state, "market:1m", T, run_id)`. The cutoff only moves forward.
2. Readers serve `layer = "batch"` documents with `window_end <= cutoff` and `layer = "speed"` documents with `window_end > cutoff`:

   ```js
   { asset_symbol: "AAPL", granularity: "1m",
     $or: [ { layer: "batch", window_end: { $lte: cutoff } },
            { layer: "speed", window_end: { $gt:  cutoff } } ] }
   ```

3. Without a published cutoff only speed documents are served. Each window therefore comes from exactly one layer and is never double counted.
4. Speed documents older than `cutoff - grace` can be deleted with `prune_superseded_speed`.

Why batch wins: the speed layer drops events that arrive later than the watermark (see `docs/evidence/streaming-semantics.md`); the batch layer reads them from bronze, so its windows are complete.

## 4. HTTP API (Task 9, to implement)

All routes are TanStack Start server routes under `/api/analytics`. Responses are JSON and timestamps are ISO-8601 UTC.

### 4.1 Authentication and authorization

- Every route requires `Authorization: Bearer <Supabase access token>`, verified the same way as `src/integrations/supabase/auth-middleware.ts` (`supabase.auth.getClaims`).
- User-level routes (`/me/...`) take **no user id parameter**. The server derives
  `user_id = "usr_" + sha256(ANALYTICS_USER_SALT + ":" + sub).hex()`
  — the same function the producers use (`pseudonymizeUserId` in `ingestion/producers/app_event_producer.ts`, `serving.keys.pseudonymize_user_id` in Python) — and always filters by it, so a user can only read their own analytics.
- `ANALYTICS_USER_SALT` is the server-only secret already shared with the ingestion gateway (`.env.example`, Kubernetes Secret), never a `VITE_` variable.
- `/pipeline/health` returns per-query detail only to users with the `admin` role (`has_role`).

### 4.2 Response envelope

```json
{
  "data": {},
  "meta": {
    "generated_at": "2026-10-12T08:00:05Z",
    "source": {
      "collection": "asset_time_series_summary",
      "layers": ["batch", "speed"],
      "batch_cutoff": "2026-10-12T07:00:00Z"
    },
    "freshness": {
      "computed_at": "2026-10-12T08:00:01Z",
      "last_event_time": "2026-10-12T07:59:58Z",
      "age_seconds": 7.0,
      "stale": false,
      "stale_after_seconds": 120
    },
    "disclaimer": "Educational analytics on simulated trading. Not investment advice."
  }
}
```

Errors use `{ "error": { "code": "UNAUTHORIZED", "message": "..." } }` with status 400 (invalid parameters), 401 (missing or invalid token), 403 (not allowed) or 503 (serving store unavailable). No stack traces. An unknown symbol returns `200` with empty data.

`stale` is computed at request time: `now - last_event_time > stale_after_seconds`. Defaults: 120 s for latest quotes, 300 s for speed windows, 26 h for batch-only views. A stale value is returned with `stale: true` and must be shown as stale, never as current.

### 4.3 Routes

| Route | Query parameters | Source | `data` |
| --- | --- | --- | --- |
| `GET /api/analytics/market/latest` | `symbols` (comma list, max 50; default all) | `latest_market_metrics` | `[{ asset_symbol, last_price, currency, source, last_event_time, quote_age_seconds, stale, window_return_pct }]` |
| `GET /api/analytics/market/series` | `symbol` (required), `granularity` (`1m` \| `5m_rolling` \| `1d`), `from`, `to`, `limit` (≤ 1000) | `asset_time_series_summary` + `lambda_state` | `{ asset_symbol, granularity, points: [{ window_start, window_end, open, high, low, close, avg_price, price_stddev, volatility_pct, return_pct, volume, quote_count, layer, provisional }] }` |
| `GET /api/analytics/me/activity` | `granularity` (`5m`), `limit` (≤ 288) | `user_activity_windows` + `lambda_state` | `{ points: [{ window_start, window_end, trade_count, buy_count, sell_count, action_count, turnover, fees, distinct_assets, buy_ratio, overtrading_signal, layer, provisional }] }` |
| `GET /api/analytics/me/sessions` | `limit` (≤ 50) | `user_sessions` | `[{ session_start, session_end, session_seconds, event_count, trade_count, distinct_assets }]` |
| `GET /api/analytics/me/risk` | — | `portfolio_risk_views` (B) | B's risk document, plus `computed_at`, `run_id`, `source_window` |
| `GET /api/analytics/me/segment` | — | `investor_behavior_segments` (B) | `{ segment_id, segment_label, features, model_version, computed_at }` |
| `GET /api/analytics/pipeline/health` | — | `pipeline_quality_metrics`, `lambda_state` | `{ queries: [{ query_name, batch_id, timestamp, input_rows_per_second, processed_rows_per_second, watermark, rows_dropped_by_watermark, state_rows_total }], gate: { invalid, too_late, by_error_code }, lambda: [{ dataset, batch_cutoff, batch_run_id }] }` |

`overtrading_signal` and segments are educational heuristics; the UI must label them that way (spec section 6.4).

## 5. What other workstreams need to match

**Person A (producers):** the speed layer consumes event contract `1.0.0` unchanged. `spark/lib/envelope.py` re-checks the rules its windows and keys depend on, and `spark/tests/test_contract_alignment.py` proves that the contract's fixtures are classified like the gateway classifies them:

- `event_type` ∈ `market_quote`, `trade_executed`, `user_action`, `portfolio_snapshot`; `schema_version` must be exactly `1.0.0` (anything else → `UNSUPPORTED_SCHEMA_VERSION`, per the compatibility policy).
- `event_id` is a UUID; `event_time` / `ingestion_time` are RFC 3339 with an explicit zone. `event_time` may be at most 5 minutes after `ingestion_time` (`MAX_FUTURE_SKEW_SECONDS`, a speed-layer-only guard that protects the watermark).
- Market prices come from `payload.close_price`; trades use `quantity`, `price`, `fee`, signed `total`, and only `status = executed` (or absent) counts as a trade.
- `user_id` must match `^usr_[a-f0-9]{64}$`. `KNOWN_ASSET_SYMBOLS` (same list as the gateway ConfigMap) enables `UNKNOWN_SYMBOL`.
- Invalid events go to `<DIAGNOSTICS_ROOT>/dead_letter/` with one of the error codes in `spark/lib/envelope.py`. The gateway already rejects them before Kafka, so this path only catches producer bugs.

**Person B (batch):** write batch windows with `serving.mongo_sink.MongoUpsertWriter(layer="batch")` (or the same document shape), use the granularity labels above and the same `close_price` / last-volume semantics, then call `publish_batch_cutoff`.

**Person D (platform/UI):** the API needs a Node.js server runtime for the MongoDB driver. Whether the official driver works inside Cloudflare Workers (`wrangler.jsonc`) has not been verified; on Kubernetes the app container runs Node, which is the assumed target.

## 6. Open decisions

1. Runtime for the API: Node on Kubernetes (assumed) or Cloudflare Workers (needs a different MongoDB access path).
2. Version matrix (Person D): the streaming code was tested with Spark 4.0.4, Java 21 and MongoDB 8.0; the broker in `deploy/` is Kafka 4.3.1, not yet exercised by the Spark Kafka source.

Resolved on 2026-10-19: payload field names (contract `1.0.0`) and user pseudonymization (`ANALYTICS_USER_SALT`, `usr_` + SHA-256, as implemented by Person A).
