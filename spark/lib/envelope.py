"""Event-envelope parsing and validation for the speed layer.

The source of truth is Person A's frozen contract,
``data-contracts/events.schema.json`` (version ``1.0.0``). The ingestion
gateway and the Bronze writer validate every event against it, so the speed
layer must accept the same events; otherwise speed windows would count events
that the batch layer never sees and the Lambda hand-over would jump.

The rules below re-check what the speed-layer computations and serving keys
depend on (identifiers, timestamps, symbols, pseudonymous user ids and the
numeric payload fields). The gateway remains responsible for the remaining
structural rules such as ``additionalProperties: false`` and UUID formats of
payload ids. ``FUTURE_EVENT_TIME`` is a speed-layer-only rule: a far-future
event would advance the watermark and drop every on-time event after it.

Validation is written as plain Spark expressions (no Python UDFs) so it is
cheap, deterministic and works unchanged for batch and streaming DataFrames.
"""

from __future__ import annotations

from pyspark.sql import Column, DataFrame
from pyspark.sql import functions as F
from pyspark.sql.types import DoubleType, StringType, StructField, StructType

EVENT_TYPES = ("market_quote", "trade_executed", "user_action", "portfolio_snapshot")
# Consumers route unknown versions to the dead-letter output rather than guessing
# (data-contracts/README.md, compatibility policy).
SUPPORTED_SCHEMA_VERSIONS = ("1.0.0",)

# Patterns copied from events.schema.json.
EVENT_ID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
ASSET_SYMBOL_PATTERN = r"^[A-Z0-9][A-Z0-9._=-]{0,31}$"
USER_ID_PATTERN = r"^usr_[a-f0-9]{64}$"
CURRENCY_PATTERN = r"^[A-Z]{3}$"
# RFC 3339 date-time: an explicit zone is required, as in the producers.
RFC3339_PATTERN = r"^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$"

ENVELOPE_SCHEMA = StructType(
    [
        StructField("event_id", StringType()),
        StructField("event_type", StringType()),
        StructField("schema_version", StringType()),
        StructField("source", StringType()),
        # Timestamps are read as strings and parsed explicitly so that an
        # unparseable value becomes INVALID_EVENT_TIME instead of a silent null.
        StructField("event_time", StringType()),
        StructField("ingestion_time", StringType()),
        StructField("asset_symbol", StringType()),
        StructField("user_id", StringType()),
        # Kept as raw JSON text and parsed with PAYLOAD_SCHEMA below.
        StructField("payload", StringType()),
    ]
)

# Union of the type-specific payloads in events.schema.json ($defs). Fields
# that do not apply to an event type stay null. Numbers must be JSON numbers.
PAYLOAD_SCHEMA = StructType(
    [
        # market_quote
        StructField("quote_id", StringType()),
        StructField("open_price", DoubleType()),
        StructField("high_price", DoubleType()),
        StructField("low_price", DoubleType()),
        StructField("close_price", DoubleType()),
        StructField("volume", DoubleType()),
        StructField("currency", StringType()),
        StructField("provider_symbol", StringType()),
        # trade_executed
        StructField("order_id", StringType()),
        StructField("side", StringType()),
        StructField("quantity", DoubleType()),
        StructField("price", DoubleType()),
        StructField("fee", DoubleType()),
        # Signed cash flow: negative for buys, positive for sells.
        StructField("total", DoubleType()),
        StructField("order_kind", StringType()),
        StructField("status", StringType()),
        # user_action (metadata is an object, kept as JSON text)
        StructField("action_id", StringType()),
        StructField("action_type", StringType()),
        StructField("metadata", StringType()),
        # portfolio_snapshot
        StructField("snapshot_id", StringType()),
        StructField("total_value", DoubleType()),
        StructField("cash_balance", DoubleType()),
        StructField("invested_value", DoubleType()),
        StructField("pnl", DoubleType()),
        StructField("risk_score", DoubleType()),
        StructField("diversification_score", DoubleType()),
    ]
)

ERROR_CODES = (
    "MALFORMED_JSON",
    "MISSING_EVENT_ID",
    "INVALID_EVENT_ID",
    "UNKNOWN_EVENT_TYPE",
    "UNSUPPORTED_SCHEMA_VERSION",
    "INVALID_EVENT_TIME",
    "INVALID_INGESTION_TIME",
    "FUTURE_EVENT_TIME",
    "MISSING_ASSET_SYMBOL",
    "INVALID_ASSET_SYMBOL",
    "UNKNOWN_SYMBOL",
    "MISSING_USER_ID",
    "INVALID_USER_ID",
    "INVALID_PRICE",
    "INVALID_VOLUME",
    "INVALID_CURRENCY",
    "INVALID_SIDE",
    "INVALID_QUANTITY",
    "INVALID_FEE",
    "INVALID_PORTFOLIO_VALUE",
    "MISSING_PAYLOAD_FIELD",
)

_INF = float("inf")


def _blank(col: Column) -> Column:
    return col.isNull() | (F.trim(col) == "")


def _not_finite(col: Column) -> Column:
    return F.isnan(col) | (F.abs(col) >= F.lit(_INF))


def _not_positive_finite(col: Column) -> Column:
    # Written so that a null value evaluates to True rather than null.
    return col.isNull() | _not_finite(col) | (col <= 0)


def _not_money(col: Column) -> Column:
    """Required non-negative finite number ($defs/money)."""
    return col.isNull() | _not_finite(col) | (col < 0)


def _bad_optional_money(col: Column) -> Column:
    return col.isNotNull() & (_not_finite(col) | (col < 0))


def _timestamp(raw: Column) -> Column:
    return F.when(raw.rlike(RFC3339_PATTERN), F.try_to_timestamp(raw))


def parse_events(
    raw: DataFrame,
    *,
    max_future_skew_seconds: int = 300,
    known_symbols: tuple[str, ...] | list[str] = (),
) -> DataFrame:
    """Parse raw JSON events and attach an ``error_code`` (null when valid).

    ``raw`` must have a string column ``value``. The original text is kept in
    ``raw_value`` for dead-letter diagnostics. ``known_symbols`` mirrors the
    gateway's ``KNOWN_ASSET_SYMBOLS`` reference check; empty disables it.
    """
    parsed = F.from_json(F.col("value"), ENVELOPE_SCHEMA)

    df = raw.select(
        "*",
        parsed.alias("_env"),
        # json_object_keys is null for malformed JSON and for non-object values.
        F.json_object_keys(F.col("value")).isNull().alias("_malformed"),
    )
    df = df.select(
        *[c for c in raw.columns if c != "value"],
        F.col("value").alias("raw_value"),
        "_malformed",
        F.col("_env.event_id").alias("event_id"),
        F.col("_env.event_type").alias("event_type"),
        F.col("_env.schema_version").alias("schema_version"),
        F.col("_env.source").alias("source"),
        _timestamp(F.col("_env.event_time")).alias("event_time"),
        _timestamp(F.col("_env.ingestion_time")).alias("ingestion_time"),
        F.col("_env.asset_symbol").alias("asset_symbol"),
        F.col("_env.user_id").alias("user_id"),
        F.from_json(F.col("_env.payload"), PAYLOAD_SCHEMA).alias("payload"),
    )

    event_type = F.col("event_type")
    symbol = F.col("asset_symbol")
    user = F.col("user_id")
    is_market = event_type == "market_quote"
    is_trade = event_type == "trade_executed"
    is_action = event_type == "user_action"
    is_portfolio = event_type == "portfolio_snapshot"
    p = F.col("payload")

    unknown_symbol = F.lit(False)
    if known_symbols:
        unknown_symbol = symbol.isNotNull() & ~symbol.isin(*sorted(set(known_symbols)))

    missing_payload_field = (
        (is_trade & (_blank(p["order_id"]) | p["total"].isNull() | _not_finite(p["total"])))
        | (is_action & (_blank(p["action_id"]) | _blank(p["action_type"]) | p["metadata"].isNull()))
        | (is_portfolio & (_blank(p["snapshot_id"]) | p["pnl"].isNull() | _not_finite(p["pnl"])))
    )

    error_code = (
        F.when(F.col("_malformed"), "MALFORMED_JSON")
        .when(_blank(F.col("event_id")), "MISSING_EVENT_ID")
        .when(~F.col("event_id").rlike(EVENT_ID_PATTERN), "INVALID_EVENT_ID")
        .when(event_type.isNull() | ~event_type.isin(*EVENT_TYPES), "UNKNOWN_EVENT_TYPE")
        .when(
            F.col("schema_version").isNull() | ~F.col("schema_version").isin(*SUPPORTED_SCHEMA_VERSIONS),
            "UNSUPPORTED_SCHEMA_VERSION",
        )
        .when(F.col("event_time").isNull(), "INVALID_EVENT_TIME")
        .when(F.col("ingestion_time").isNull(), "INVALID_INGESTION_TIME")
        .when(
            F.unix_micros(F.col("event_time"))
            > F.unix_micros(F.col("ingestion_time")) + F.lit(max_future_skew_seconds * 1_000_000),
            "FUTURE_EVENT_TIME",
        )
        .when((is_market | is_trade) & symbol.isNull(), "MISSING_ASSET_SYMBOL")
        # The pattern excludes "|", which keeps serving keys unambiguous.
        .when(symbol.isNotNull() & ~symbol.rlike(ASSET_SYMBOL_PATTERN), "INVALID_ASSET_SYMBOL")
        .when(unknown_symbol, "UNKNOWN_SYMBOL")
        .when(~is_market & user.isNull(), "MISSING_USER_ID")
        # A raw Supabase id or e-mail must never reach analytical storage.
        .when(user.isNotNull() & ~user.rlike(USER_ID_PATTERN), "INVALID_USER_ID")
        .when(
            is_market
            & (
                _not_positive_finite(p["close_price"])
                | _bad_optional_money(p["open_price"])
                | _bad_optional_money(p["high_price"])
                | _bad_optional_money(p["low_price"])
            ),
            "INVALID_PRICE",
        )
        .when(is_market & _bad_optional_money(p["volume"]), "INVALID_VOLUME")
        .when(is_market & (p["currency"].isNull() | ~p["currency"].rlike(CURRENCY_PATTERN)), "INVALID_CURRENCY")
        .when(is_trade & (p["side"].isNull() | ~p["side"].isin("buy", "sell")), "INVALID_SIDE")
        .when(is_trade & _not_positive_finite(p["quantity"]), "INVALID_QUANTITY")
        .when(is_trade & _not_positive_finite(p["price"]), "INVALID_PRICE")
        .when(is_trade & _not_money(p["fee"]), "INVALID_FEE")
        .when(
            is_portfolio
            & (
                _not_money(p["total_value"])
                | _not_money(p["cash_balance"])
                | _not_money(p["invested_value"])
                | _bad_optional_money(p["risk_score"])
                | _bad_optional_money(p["diversification_score"])
            ),
            "INVALID_PORTFOLIO_VALUE",
        )
        .when(missing_payload_field, "MISSING_PAYLOAD_FIELD")
    )
    return df.withColumn("error_code", error_code).withColumn(
        "event_date", F.to_date(F.col("event_time"))
    ).drop("_malformed")


def valid_events(parsed: DataFrame, *event_types: str) -> DataFrame:
    """Keep valid events, optionally restricted to some event types."""
    df = parsed.filter(F.col("error_code").isNull())
    if event_types:
        df = df.filter(F.col("event_type").isin(*event_types))
    return df
