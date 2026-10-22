"""pytest fixtures shared by serving/tests and spark/tests.

Sink tests need a real MongoDB because they rely on its upsert and
duplicate-key behaviour: set ``FINSIGHT_TEST_MONGO_URI`` (for example
``mongodb://127.0.0.1:27017`` from docker compose). Every test gets its own
database, dropped afterwards; without the variable those tests are skipped.
"""

from __future__ import annotations

import os
import uuid

import pytest


@pytest.fixture(scope="session")
def mongo_client():
    uri = os.environ.get("FINSIGHT_TEST_MONGO_URI")
    if not uri:
        pytest.skip("FINSIGHT_TEST_MONGO_URI is not set")
    from pymongo import MongoClient

    client = MongoClient(uri, tz_aware=True, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")
    yield client
    client.close()


@pytest.fixture
def make_db(mongo_client):
    """Factory for independent databases (some tests compare two runs).

    By default the serving schema (validators and indexes) is applied, so
    tests fail if the pipeline writes documents the validators reject.
    """
    from serving.mongo_setup import apply_schema

    names = []

    def factory(with_schema: bool = True):
        name = f"finsight_test_{uuid.uuid4().hex[:8]}"
        names.append(name)
        db = mongo_client[name]
        if with_schema:
            apply_schema(db)
        return db

    yield factory
    for name in names:
        mongo_client.drop_database(name)


@pytest.fixture
def mongo_db(make_db):
    return make_db()


@pytest.fixture
def plain_db(make_db):
    """Database without validators, for tests that insert hand-made documents."""
    return make_db(with_schema=False)
