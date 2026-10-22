"""Shared fixtures for the speed-layer tests (Spark in local mode).

MongoDB fixtures come from ``serving/testing.py``; see that module for the
``FINSIGHT_TEST_MONGO_URI`` requirement.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from serving.testing import make_db, mongo_client, mongo_db, plain_db  # noqa: E402,F401
from spark.lib.streaming_config import StreamingConfig  # noqa: E402


@pytest.fixture(scope="session")
def spark():
    os.environ.setdefault("PYSPARK_PYTHON", sys.executable)
    from pyspark.sql import SparkSession

    session = (
        SparkSession.builder.master("local[2]")
        .appName("finsight-streaming-tests")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", "2")
        .config("spark.ui.enabled", "false")
        # Keep the local JVM small; dev laptops also run MongoDB and the app.
        .config("spark.driver.memory", os.environ.get("FINSIGHT_TEST_SPARK_MEMORY", "768m"))
        .getOrCreate()
    )
    session.sparkContext.setLogLevel("ERROR")
    yield session
    session.stop()


@pytest.fixture
def make_cfg(tmp_path):
    def factory(name: str = "run", **overrides) -> StreamingConfig:
        base = tmp_path / name
        values = dict(
            checkpoint_root=str(base / "checkpoints"),
            curated_root=str(base / "curated"),
            diagnostics_root=str(base / "diagnostics"),
            run_id="test",
            sink_mode="driver",
            shuffle_partitions=2,
        )
        values.update(overrides)
        return StreamingConfig(**values)

    return factory


@pytest.fixture
def cfg(make_cfg):
    return make_cfg()
