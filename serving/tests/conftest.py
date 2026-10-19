import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from serving.testing import make_db, mongo_client, mongo_db, plain_db  # noqa: E402,F401
