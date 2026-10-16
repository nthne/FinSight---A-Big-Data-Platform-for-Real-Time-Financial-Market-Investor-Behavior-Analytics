# FinSight event contract

Version `1.0.0` defines the immutable event envelope used between FinSight producers, Kafka consumers and the Bronze storage layer. Validate events against `events.schema.json` before publishing and preserve the full envelope in Bronze.

## Envelope rules

- `event_id` is a stable UUID. Retrying the same source record must produce the same ID.
- `event_time` is the source/business timestamp; `ingestion_time` is when FinSight accepted the event. Both are UTC RFC 3339 timestamps.
- `asset_symbol` is the canonical FinSight symbol, not necessarily the upstream provider symbol.
- `user_id` is `usr_` plus a salted SHA-256 digest. A Supabase Auth UUID, email or name must never enter Kafka or analytical storage.
- Numeric values are JSON numbers, not localized strings. Prices use the currency declared by the payload.
- Unknown symbols pass structural JSON Schema validation but fail reference-data validation and go to `dead-letter-events` with error code `UNKNOWN_SYMBOL`.
- Duplicate IDs are a stream/batch invariant rather than a single-document JSON Schema rule. Producers retain the ID on retry; consumers count and deduplicate by `event_id`.

## Source inventory and mapping

| Current source | Event | Field mapping |
| --- | --- | --- |
| `market_assets` + `market_prices` | `market_quote` | `symbol` → `asset_symbol`; `timestamp` → `event_time`; OHLC, `volume`, `currency` and `provider_symbol` → payload; `source` → envelope source |
| `orders` | `trade_executed` | `id` → `payload.order_id`; `executed_at` → `event_time`; `symbol`, `side`, `qty`, `price`, `fee`, `total`, `order_kind`, `status` → envelope/payload |
| `user_action_logs` | `user_action` | `log_id` → `payload.action_id`; `created_at` → `event_time`; `action_type` and `metadata` → payload |
| `portfolio_snapshots` | `portfolio_snapshot` | `snapshot_id` → payload ID; `created_at` → `event_time`; values and scores → payload |
| `behavioral_metrics` / `behavior_summaries` | downstream analytical input | No dedicated v1 event. Metrics are derived from trade/user-action/snapshot events; adding a source event requires a compatible schema revision. |

Fields without a reliable current source are intentionally absent: provider request ID, market quote bid/ask, session/device ID, order decision timestamp and portfolio position breakdown. They must not be synthesized and presented as observed data.

## Compatibility policy

- `schema_version` uses semantic versioning.
- Patch versions clarify validation or documentation without changing valid messages.
- Minor versions may add optional fields; existing consumers must ignore only fields declared by a schema version they support.
- Removing, renaming, changing meaning/type, or making a field required needs a new major version and a new schema ID.
- Producers publish only versions listed as supported by the target topic. Consumers route unknown versions to DLQ rather than guessing.
- The original event is immutable. Corrections are new events with new IDs and explicit correction metadata in a future compatible contract.

## Validation

Install `jsonschema` and run:

```powershell
python -m jsonschema -i data-contracts/fixtures/valid-market-quote.json data-contracts/events.schema.json
python -m pytest ingestion/tests/test_producers.py -v
```

The first command checks structural validity. The tests additionally enforce timestamp formats, known-symbol membership and duplicate IDs.
