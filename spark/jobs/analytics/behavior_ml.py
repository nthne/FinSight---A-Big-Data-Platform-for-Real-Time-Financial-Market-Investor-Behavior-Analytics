"""MLlib investor segments and non-diagnostic behavior classifications."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pyspark.ml import Pipeline
from pyspark.ml.clustering import KMeans
from pyspark.ml.evaluation import ClusteringEvaluator
from pyspark.ml.feature import StandardScaler, VectorAssembler
from pyspark.sql import DataFrame
from pyspark.sql import functions as F
from pyspark.sql.functions import udf
from pyspark.sql.types import StringType

FEATURE_COLUMNS = (
    "trade_frequency",
    "turnover",
    "concentration_hhi",
    "maximum_drawdown",
    "portfolio_volatility",
    "average_pnl",
    "action_count",
)


@dataclass(frozen=True)
class SegmentationResult:
    assignments: DataFrame
    cluster_profile: DataFrame
    metadata: dict[str, Any]
    model: Any


def classify_behavior(
    trade_frequency: int | None,
    concentration_hhi: float | None,
    maximum_drawdown: float | None,
    portfolio_volatility: float | None,
) -> str:
    """Map measurable activity features to a descriptive, non-diagnostic label."""
    if trade_frequency is None or concentration_hhi is None:
        return "insufficient_data"
    values = (concentration_hhi, maximum_drawdown or 0.0, portfolio_volatility or 0.0)
    if any(value != value or abs(value) == float("inf") for value in values):
        return "insufficient_data"
    if trade_frequency >= 10:
        return "high_activity"
    if concentration_hhi >= 0.5:
        return "concentrated_activity"
    if maximum_drawdown <= -0.2:
        return "large_historical_drawdown"
    if portfolio_volatility >= 0.1:
        return "higher_observed_volatility"
    return "moderate_observed_activity"


behavior_classification_udf = udf(classify_behavior, StringType())


def add_behavior_classification(features: DataFrame) -> DataFrame:
    return features.withColumn(
        "educational_signal",
        behavior_classification_udf(
            "trade_frequency",
            "concentration_hhi",
            "maximum_drawdown",
            "portfolio_volatility",
        ),
    )


def train_investor_segments(
    features: DataFrame,
    *,
    max_clusters: int = 4,
    seed: int = 42,
) -> SegmentationResult:
    """Fit a scaled, deterministic-seed KMeans model and report silhouette."""
    if max_clusters < 2:
        raise ValueError("max_clusters must be at least 2")
    missing = [name for name in FEATURE_COLUMNS if name not in features.columns]
    if missing:
        raise ValueError(f"Missing segmentation features: {', '.join(missing)}")

    cleaned = features.na.fill(0.0, subset=list(FEATURE_COLUMNS))
    assembler = VectorAssembler(
        inputCols=list(FEATURE_COLUMNS),
        outputCol="raw_features",
        handleInvalid="error",
    )
    row_count = cleaned.count()
    distinct_count = cleaned.select(*FEATURE_COLUMNS).distinct().count()
    if row_count < 2 or distinct_count < 2:
        raise ValueError("At least two rows with distinct feature vectors are required")
    clusters = min(max_clusters, distinct_count)
    scaler = StandardScaler(
        inputCol="raw_features",
        outputCol="features",
        withMean=True,
        withStd=True,
    )
    estimator = KMeans(k=clusters, seed=seed, featuresCol="features", predictionCol="cluster")
    pipeline = Pipeline(stages=[scaler, estimator])
    model = pipeline.fit(cleaned)
    assignments = model.transform(cleaned).withColumn(
        "segment_label", F.lit("educational_segment")
    )
    silhouette = ClusteringEvaluator(
        featuresCol="features",
        predictionCol="cluster",
        metricName="silhouette",
        distanceMeasure="squaredEuclidean",
    ).evaluate(assignments)
    profile = assignments.groupBy("cluster").agg(
        F.count(F.lit(1)).alias("member_count"),
        *[F.avg(name).alias(f"average_{name}") for name in FEATURE_COLUMNS],
    )
    metadata = {
        "algorithm": "pyspark.ml.clustering.KMeans",
        "feature_columns": list(FEATURE_COLUMNS),
        "scaling": "StandardScaler(withMean=True, withStd=True)",
        "requested_max_clusters": max_clusters,
        "effective_clusters": clusters,
        "seed": seed,
        "training_rows": row_count,
        "distinct_feature_vectors": distinct_count,
        "silhouette": float(silhouette),
        "interpretation": (
            "Cluster numbers are arbitrary educational groupings, not diagnoses or advice."
        ),
    }
    return SegmentationResult(assignments, profile, metadata, model)
