from __future__ import annotations

import os

from storage.jobs.bronze_writer import _filesystem_for_uri


def main() -> int:
    base_uri = os.environ.get("BRONZE_BASE_URI", "s3://fin-sight")
    filesystem, base_path = _filesystem_for_uri(base_uri)
    for zone in ("bronze", "silver", "gold"):
        filesystem.create_dir(f"{base_path}/{zone}", recursive=True)
        print(f"ready {base_uri.rstrip('/')}/{zone}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
