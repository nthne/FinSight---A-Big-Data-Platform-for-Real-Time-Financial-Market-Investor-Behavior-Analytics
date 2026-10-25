"""Bronze validation, normalization and deterministic event de-duplication."""

from __future__ import annotations

from collections.abc import Sequence

from pyspark.sql import DataFrame, Window
from pyspark.sql import functions as F

from spark.lib.schemas import EVENT_TYPES, PAYLOAD_SCHEMA

_ENVELOPE_KEYS = (
    "event_id",
    "event_type",
    "schema_version",
    "source",
    "event_time",
    "ingestion_time",
    "asset_symbol",
    "user_id",
    "payload",
)
_PAYLOAD_KEYS = {
    "market_quote": (
        "quote_id",
        "open_price",
        "high_price",
        "low_price",
        "close_price",
        "volume",
        "currency",
        "provider_symbol",
    ),
    "trade_executed": (
        "order_id",
        "side",
        "quantity",
        "price",
        "fee",
        "total",
        "order_kind",
        "status",
    ),
    "user_action": ("action_id", "action_type", "metadata"),
    "portfolio_snapshot": (
        "snapshot_id",
        "total_value",
        "cash_balance",
        "invested_value",
        "pnl",
        "risk_score",
        "diversification_score",
    ),
}


def _finite_positive(column):
    return (
        column.isNotNull()
        & (~F.isnan(column))
        & (column > F.lit(0.0))
        & (F.abs(column) < F.lit(float("inf")))
    )


def _finite_non_negative(column):
    return (
        column.isNotNull()
        & (~F.isnan(column))
        & (column >= F.lit(0.0))
        & (F.abs(column) < F.lit(float("inf")))
    )


def _valid_user_id():
    return F.col("user_id").rlike("^usr_[0-9a-f]{64}$")


def validate_and_normalize(
    bronze: DataFrame,
    *,
    known_symbols: Sequence[str] | None = None,
) -> tuple[DataFrame, DataFrame]:
    """Return normalized, unique Silver rows and rejected Bronze rows.

    The earliest ingestion copy is retained for duplicate event IDs. Invalid
    rows are returned with one stable ``quality_error`` code for auditability.
    """
    parsed = bronze.withColumn("_payload", F.from_json("payload_json", PAYLOAD_SCHEMA))
    normalized = (
        parsed.withColumn("asset_symbol", F.upper(F.trim("asset_symbol")))
        .withColumn("event_time", F.to_timestamp("event_time"))
        .withColumn("ingestion_time", F.to_timestamp("ingestion_time"))
        .withColumn("metadata_json", F.get_json_object("payload_json", "$.metadata"))
        .withColumn("close_price", F.col("_payload.close_price").cast("double"))
        .withColumn("volume", F.col("_payload.volume").cast("double"))
        .withColumn("trade_side", F.lower(F.col("_payload.side")))
        .withColumn("quantity", F.col("_payload.quantity").cast("double"))
        .withColumn("trade_price", F.col("_payload.price").cast("double"))
        .withColumn("fee", F.col("_payload.fee").cast("double"))
        .withColumn("trade_total", F.col("_payload.total").cast("double"))
        .withColumn("trade_status", F.lower(F.col("_payload.status")))
        .withColumn("action_type", F.col("_payload.action_type"))
        .withColumn("total_value", F.col("_payload.total_value").cast("double"))
        .withColumn("cash_balance", F.col("_payload.cash_balance").cast("double"))
        .withColumn("invested_value", F.col("_payload.invested_value").cast("double"))
        .withColumn("pnl", F.col("_payload.pnl").cast("double"))
        .withColumn("risk_score", F.col("_payload.risk_score").cast("double"))
        .withColumn(
            "diversification_score",
            F.col("_payload.diversification_score").cast("double"),
        )
    )

    event_type = F.col("event_type")
    known_envelope = F.array(*[F.lit(key) for key in _ENVELOPE_KEYS])
    envelope_extra_keys = F.array_except(
        F.expr("json_object_keys(raw_event_json)"),
        known_envelope,
    )
    allowed_payload = F.lit(None).cast("array<string>")
    for event_name, keys in _PAYLOAD_KEYS.items():
        allowed_payload = F.when(
            event_type == event_name,
            F.array(*[F.lit(key) for key in keys]),
        ).otherwise(allowed_payload)
    payload_keys = F.expr("json_object_keys(payload_json)")
    extra_payload_keys = F.array_except(payload_keys, allowed_payload)
    if isinstance(known_symbols, str):
        raise ValueError("known_symbols must be a sequence of symbol strings")
    raw_symbols = known_symbols or ()
    if any(not isinstance(symbol, str) for symbol in raw_symbols):
        raise ValueError("known_symbols must contain only strings")
    normalized_symbols = tuple(
        symbol.strip().upper() for symbol in raw_symbols if symbol.strip()
    )
    unknown_symbol = (
        F.lit(False)
        if not normalized_symbols
        else (
            F.col("asset_symbol").isNotNull()
            & (~F.col("asset_symbol").isin(*normalized_symbols))
        )
    )
    required = (
        F.col("event_id").isNull()
        | (F.trim(F.col("event_id")) == "")
        | (~F.col("event_id").rlike(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        ))
        | F.col("source").isNull()
        | (~F.col("source").rlike("^[a-z0-9][a-z0-9._-]{1,63}$"))
        | F.col("event_time").isNull()
        | F.col("ingestion_time").isNull()
        | F.col("event_date").isNull()
        | (
            F.col("event_date")
            != F.date_format(F.col("event_time"), "yyyy-MM-dd")
        )
        | F.col("schema_version").isNull()
        | (F.col("schema_version") != "1.0.0")
        | event_type.isNull()
        | (~event_type.isin(*EVENT_TYPES))
        | F.col("_payload").isNull()
        | (F.coalesce(F.size(envelope_extra_keys), F.lit(0)) > 0)
    )
    quote_valid = (
        F.col("asset_symbol").isNotNull()
        & F.col("asset_symbol").rlike("^[A-Z0-9][A-Z0-9._=-]{0,31}$")
        & _finite_positive(F.col("close_price"))
        & F.col("_payload.currency").rlike("^[A-Z]{3}$")
        & (
            F.col("_payload.quote_id").isNull()
            | F.col("_payload.quote_id").rlike(
                "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
            )
        )
        & (
            F.col("_payload.provider_symbol").isNull()
            | (
                (F.length(F.col("_payload.provider_symbol")) >= 1)
                & (F.length(F.col("_payload.provider_symbol")) <= 64)
            )
        )
        & (
            F.col("_payload.open_price").isNull()
            | _finite_non_negative(F.col("_payload.open_price"))
        )
        & (
            F.col("_payload.high_price").isNull()
            | _finite_non_negative(F.col("_payload.high_price"))
        )
        & (
            F.col("_payload.low_price").isNull()
            | _finite_non_negative(F.col("_payload.low_price"))
        )
        & (
            F.col("_payload.high_price").isNull()
            | F.col("_payload.low_price").isNull()
            | (F.col("_payload.high_price") >= F.col("_payload.low_price"))
        )
        & (
            F.col("_payload.high_price").isNull()
            | (F.col("_payload.high_price") >= F.col("close_price"))
        )
        & (
            F.col("_payload.low_price").isNull()
            | (F.col("_payload.low_price") <= F.col("close_price"))
        )
        & (
            F.col("volume").isNull()
            | _finite_non_negative(F.col("volume"))
        )
    )
    trade_valid = (
        F.col("asset_symbol").rlike("^[A-Z0-9][A-Z0-9._=-]{0,31}$")
        & F.col("user_id").isNotNull()
        & _valid_user_id()
        & F.col("_payload.order_id").rlike(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        )
        & (
            F.col("_payload.order_kind").isNull()
            | F.col("_payload.order_kind").isin("market", "limit", "stop")
        )
        & F.col("trade_side").isin("buy", "sell")
        & _finite_positive(F.col("quantity"))
        & _finite_positive(F.col("trade_price"))
        & _finite_positive(F.col("quantity") * F.col("trade_price"))
        & _finite_non_negative(F.col("fee"))
        & F.col("trade_total").isNotNull()
        & (~F.isnan(F.col("trade_total")))
        & (F.abs(F.col("trade_total")) < F.lit(float("inf")))
        & (
            (F.col("trade_side") == "buy") & (F.col("trade_total") <= 0)
            | (F.col("trade_side") == "sell") & (F.col("trade_total") >= 0)
        )
        & (
            F.col("trade_status").isNull()
            | F.col("trade_status").isin("pending", "executed", "cancelled", "rejected")
        )
    )
    action_valid = (
        F.col("user_id").isNotNull()
        & _valid_user_id()
        & F.col("_payload.action_id").rlike(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        )
        & F.col("action_type").isNotNull()
        & (F.trim(F.col("action_type")) != "")
        & (F.length(F.col("action_type")) <= 80)
        & F.col("metadata_json").startswith("{")
    )
    portfolio_valid = (
        F.col("user_id").isNotNull()
        & _valid_user_id()
        & F.col("_payload.snapshot_id").rlike(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        )
        & _finite_non_negative(F.col("total_value"))
        & _finite_non_negative(F.col("cash_balance"))
        & _finite_non_negative(F.col("invested_value"))
        & F.col("pnl").isNotNull()
        & (~F.isnan(F.col("pnl")))
        & (F.abs(F.col("pnl")) < F.lit(float("inf")))
        & (
            F.col("risk_score").isNull()
            | _finite_non_negative(F.col("risk_score"))
        )
        & (
            F.col("diversification_score").isNull()
            | _finite_non_negative(F.col("diversification_score"))
        )
    )
    valid_payload = (
        F.when(event_type == "market_quote", quote_valid)
        .when(event_type == "trade_executed", trade_valid)
        .when(event_type == "user_action", action_valid)
        .when(event_type == "portfolio_snapshot", portfolio_valid)
        .otherwise(F.lit(False))
    )
    classified = normalized.withColumn(
        "quality_error",
        F.when(F.coalesce(required, F.lit(True)), F.lit("INVALID_ENVELOPE"))
        .when(unknown_symbol, F.lit("UNKNOWN_SYMBOL"))
        .when(F.coalesce(F.size(extra_payload_keys), F.lit(0)) > 0, F.lit("INVALID_PAYLOAD"))
        .when(~F.coalesce(valid_payload, F.lit(False)), F.lit("INVALID_PAYLOAD")),
    )

    valid_candidates = classified.filter(F.col("quality_error").isNull())
    ordering = Window.partitionBy("event_id").orderBy(
        F.col("ingestion_time").asc(),
        F.col("pipeline_run_id").asc_nulls_last(),
        F.col("source_topic").asc_nulls_last(),
        F.col("source_partition").asc_nulls_last(),
        F.col("source_offset").asc_nulls_last(),
        F.col("raw_event_json").asc_nulls_last(),
    )
    unique = (
        valid_candidates.withColumn("_copy_rank", F.row_number().over(ordering))
        .withColumn(
            "quality_error",
            F.when(F.col("_copy_rank") > 1, F.lit("DUPLICATE_EVENT_ID")),
        )
    )
    rejected_invalid = classified.filter(F.col("quality_error").isNotNull())
    rejected_duplicates = unique.filter(F.col("quality_error").isNotNull()).drop("_copy_rank")
    rejected = rejected_invalid.unionByName(rejected_duplicates)
    silver = (
        unique.filter(F.col("quality_error").isNull())
        .drop("_payload", "_copy_rank", "quality_error", "raw_event_json", "metadata_json")
    )
    return silver, rejected
