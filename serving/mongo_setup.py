"""Create or update the serving collections, validators and indexes.

The definitions live in ``serving/mongo_schema.json`` (shared with
``serving/mongo_schema.js`` for mongosh). Re-running is safe: existing
collections get their validator replaced and ``create_index`` is a no-op for
an identical index.

Usage: python -m serving.mongo_setup [--uri mongodb://...] [--database finsight]
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("mongo_schema.json")


def load_schema(path: Path = SCHEMA_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["collections"]


def apply_schema(db, collections: dict | None = None) -> list[str]:
    collections = collections or load_schema()
    existing = set(db.list_collection_names())
    applied = []
    for name, spec in collections.items():
        validator = spec.get("validator")
        options = {"validator": validator, "validationLevel": "moderate", "validationAction": "error"} if validator else {}
        if name not in existing:
            db.create_collection(name, **options)
        elif validator:
            db.command({"collMod": name, **options})
        for index in spec.get("indexes", []):
            db[name].create_index(list(index["keys"].items()), name=index["name"], unique=index.get("unique", False))
        applied.append(name)
    return applied


def main(argv: list[str] | None = None) -> None:
    from pymongo import MongoClient

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--uri", default=os.environ.get("MONGO_URI", "mongodb://localhost:27017"))
    parser.add_argument("--database", default=os.environ.get("MONGO_DATABASE", "finsight"))
    args = parser.parse_args(argv)
    with MongoClient(args.uri) as client:
        for name in apply_schema(client[args.database]):
            print(f"ok {args.database}.{name}")


if __name__ == "__main__":
    main()
