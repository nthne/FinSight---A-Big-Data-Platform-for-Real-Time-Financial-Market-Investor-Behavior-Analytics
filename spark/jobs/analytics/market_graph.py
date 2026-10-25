"""GraphFrames analysis of pseudonymous investor-to-asset interactions."""

from __future__ import annotations

from typing import Any

from pyspark.sql import DataFrame
from pyspark.sql import functions as F


def build_interaction_graph(events: DataFrame, *, max_iterations: int = 10) -> dict[str, Any]:
    """Compute degree, PageRank, and label-propagation summaries.

    User vertices retain only the contract's pseudonymous ``usr_`` identifiers;
    asset vertex IDs use an ``asset:`` namespace to avoid collisions.
    """
    if max_iterations < 1:
        raise ValueError("max_iterations must be positive")
    try:
        from graphframes import GraphFrame
    except ImportError as error:
        raise RuntimeError(
            "GraphFrames is required for graph analytics; install the Spark 4 / Scala 2.13 "
            "GraphFrames package documented in spark/README.md"
        ) from error

    interactions = (
        events.filter(
            F.col("event_type").isin("trade_executed", "user_action")
            & F.col("user_id").isNotNull()
            & F.col("user_id").rlike("^usr_[0-9a-f]{64}$")
            & F.col("asset_symbol").isNotNull()
            & (F.col("asset_symbol") != "")
        )
        .select(
            F.col("user_id").alias("user_id"),
            F.concat(F.lit("asset:"), F.col("asset_symbol")).alias("asset_id"),
        )
        .distinct()
    )
    edges = interactions.select(
        F.col("user_id").alias("src"),
        F.col("asset_id").alias("dst"),
    )
    users = interactions.select(F.col("user_id").alias("id")).distinct().withColumn(
        "vertex_type", F.lit("investor")
    )
    assets = interactions.select(F.col("asset_id").alias("id")).distinct().withColumn(
        "vertex_type", F.lit("asset")
    )
    vertices = users.unionByName(assets)
    vertex_count = vertices.count()
    edge_count = edges.count()
    if vertex_count == 0 or edge_count == 0:
        empty_metrics = vertices.withColumn("degree", F.lit(0)).withColumn(
            "pagerank", F.lit(0.0)
        ).withColumn("community", F.lit(None).cast("long"))
        return {
            "vertices": empty_metrics,
            "edges": edges,
            "metadata": {
                "vertices": vertex_count,
                "edges": edge_count,
                "iterations": 0,
                "algorithms": ["degree", "PageRank", "label propagation"],
                "user_identifier": "pseudonymous contract ID",
                "interpretation": (
                    "Graph metrics describe observed event connectivity only; they are not "
                    "investment recommendations or psychological labels."
                ),
            },
        }

    graph = GraphFrame(vertices, edges)
    degrees = graph.degrees
    ranks = graph.pageRank(resetProbability=0.15, maxIter=max_iterations).vertices.select(
        "id", "pagerank"
    )
    communities = graph.labelPropagation(maxIter=max_iterations).select("id", "label")
    metrics = (
        vertices.join(degrees, "id", "left")
        .join(ranks, "id", "left")
        .join(communities, "id", "left")
        .withColumnRenamed("label", "community")
    )
    return {
        "vertices": metrics,
        "edges": edges,
        "metadata": {
            "vertices": vertex_count,
            "edges": edge_count,
            "iterations": max_iterations,
            "algorithms": ["degree", "PageRank", "label propagation"],
            "user_identifier": "pseudonymous contract ID",
            "interpretation": (
                "Graph metrics describe observed event connectivity only; they are not "
                "investment recommendations or psychological labels."
            ),
        },
    }
