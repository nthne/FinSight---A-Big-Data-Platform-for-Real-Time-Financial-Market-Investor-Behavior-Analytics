"""Train and persist the MLlib and GraphFrames analytics for one batch run."""

from __future__ import annotations

import argparse
import json
import re
from urllib.parse import urlsplit

from pyspark.sql import SparkSession

from spark.jobs.analytics.behavior_ml import train_investor_segments
from spark.jobs.analytics.market_graph import build_interaction_graph

_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


def run_advanced_analytics(
    spark: SparkSession,
    *,
    feature_path: str,
    silver_path: str,
    output_root: str,
    run_id: str,
    max_clusters: int = 4,
    graph_iterations: int = 10,
) -> dict:
    if not _RUN_ID.fullmatch(run_id):
        raise ValueError("run_id must contain only letters, numbers, dot, underscore or dash")
    for name, path in (
        ("feature_path", feature_path),
        ("silver_path", silver_path),
        ("output_root", output_root),
    ):
        parsed_path = urlsplit(path)
        if parsed_path.username is not None or parsed_path.password is not None:
            raise ValueError(f"{name} must not embed credentials")
    features = spark.read.parquet(feature_path)
    events = spark.read.parquet(silver_path)
    segments = train_investor_segments(features, max_clusters=max_clusters)
    graph = build_interaction_graph(events, max_iterations=graph_iterations)

    base = output_root.rstrip("/")
    assignments_path = f"{base}/gold/investor_segments/run_id={run_id}"
    profile_path = f"{base}/gold/investor_segment_profiles/run_id={run_id}"
    model_path = f"{base}/models/investor_kmeans/run_id={run_id}"
    vertices_path = f"{base}/gold/asset_interaction_graph/vertices/run_id={run_id}"
    edges_path = f"{base}/gold/asset_interaction_graph/edges/run_id={run_id}"
    segments.assignments.write.mode("overwrite").option("compression", "snappy").partitionBy(
        "event_date"
    ).parquet(assignments_path)
    segments.cluster_profile.write.mode("overwrite").option("compression", "snappy").parquet(
        profile_path
    )
    segments.model.write().overwrite().save(model_path)
    graph["vertices"].write.mode("overwrite").option("compression", "snappy").parquet(vertices_path)
    graph["edges"].write.mode("overwrite").option("compression", "snappy").parquet(edges_path)
    metadata = {
        "run_id": run_id,
        "feature_path": feature_path,
        "silver_path": silver_path,
        "segment_metrics": segments.metadata,
        "graph_metrics": graph["metadata"],
        "outputs": {
            "assignments": assignments_path,
            "cluster_profile": profile_path,
            "model": model_path,
            "graph_vertices": vertices_path,
            "graph_edges": edges_path,
        },
    }
    spark.createDataFrame([(json.dumps(metadata, sort_keys=True),)], ["value"]).write.mode(
        "overwrite"
    ).text(f"{base}/_runs/advanced-{run_id}")
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--features", required=True, help="Gold portfolio_behavior_features Parquet")
    parser.add_argument("--silver", required=True, help="Normalized Silver Parquet path")
    parser.add_argument("--output", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--max-clusters", type=int, default=4)
    parser.add_argument("--graph-iterations", type=int, default=10)
    args = parser.parse_args()
    spark = (
        SparkSession.builder.appName(f"finsight-advanced-{args.run_id}")
        .config("spark.sql.session.timeZone", "UTC")
        .getOrCreate()
    )
    try:
        result = run_advanced_analytics(
            spark,
            feature_path=args.features,
            silver_path=args.silver,
            output_root=args.output,
            run_id=args.run_id,
            max_clusters=args.max_clusters,
            graph_iterations=args.graph_iterations,
        )
        print(json.dumps(result, sort_keys=True))
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
