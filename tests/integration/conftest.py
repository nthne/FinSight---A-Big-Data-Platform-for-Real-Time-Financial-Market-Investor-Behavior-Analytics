"""Fixtures for the analytics API integration tests (Person C, plan Task 9).

The app runs for real (``vite dev``, TanStack Start server routes) against a
real MongoDB. Only Supabase Auth is replaced: ``FakeSupabase`` implements the
two endpoints the API calls, ``GET /auth/v1/user`` (what ``getClaims`` uses
to verify an HS256 access token server-side) and ``POST /rest/v1/rpc/has_role``.
The API code under test is unchanged; there is no test-only auth bypass.

Requirements: ``FINSIGHT_TEST_MONGO_URI`` (tests are skipped without it),
Node.js on ``PATH`` or in ``FINSIGHT_NODE``, and ``npm install`` done.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from serving.testing import mongo_client  # noqa: E402,F401

USER_SALT = "api-integration-test-salt"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class FakeSupabase:
    """Issues opaque-signature HS256 tokens and verifies them like Supabase Auth would."""

    def __init__(self) -> None:
        self.tokens: dict[str, str] = {}
        self.admins: set[str] = set()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def issue(self, sub: str, *, expires_in: int = 3600, register: bool = True) -> str:
        now = int(time.time())
        header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        claims = {"sub": sub, "aud": "authenticated", "role": "authenticated", "iat": now, "exp": now + expires_in}
        token = f"{header}.{_b64url(json.dumps(claims).encode())}.{_b64url(secrets.token_bytes(32))}"
        if register:
            self.tokens[token] = sub
        return token

    def _handler(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):  # keep pytest output clean
                pass

            def _send(self, status: int, body) -> None:
                payload = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def _subject(self) -> str | None:
                auth = self.headers.get("authorization", "")
                return fake.tokens.get(auth.removeprefix("Bearer ").strip())

            def do_GET(self):
                sub = self._subject()
                if self.path.startswith("/auth/v1/user") and sub:
                    return self._send(200, {"id": sub, "aud": "authenticated", "role": "authenticated",
                                            "app_metadata": {}, "user_metadata": {}, "created_at": "2026-10-01T00:00:00Z"})
                return self._send(401, {"code": 401, "error_code": "bad_jwt", "msg": "invalid JWT"})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
                sub = self._subject()
                if self.path.startswith("/rest/v1/rpc/has_role") and sub:
                    is_admin = body.get("_role") == "admin" and body.get("_user_id") in fake.admins
                    return self._send(200, is_admin)
                return self._send(401, {"message": "JWT invalid"})

        return Handler


@pytest.fixture(scope="session")
def supabase():
    fake = FakeSupabase()
    yield fake
    fake.server.shutdown()


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _stop(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    else:
        os.killpg(process.pid, signal.SIGTERM)
    process.wait(timeout=30)


@pytest.fixture(scope="session")
def analytics_db(mongo_client):  # noqa: F811 - pytest fixture injection
    from serving.mongo_setup import apply_schema

    db = mongo_client[f"finsight_api_test_{uuid.uuid4().hex[:8]}"]
    apply_schema(db)
    yield db
    mongo_client.drop_database(db.name)


@pytest.fixture(scope="session")
def api(supabase, analytics_db, tmp_path_factory):
    """Base URL of a running app (vite dev) wired to the fake Supabase and the test database."""
    node = os.environ.get("FINSIGHT_NODE") or shutil.which("node")
    vite = ROOT / "node_modules" / "vite" / "bin" / "vite.js"
    if not node or not vite.exists():
        pytest.skip("Node.js and npm dependencies are required (run npm install)")
    port = _free_port()
    env = {
        **os.environ,
        "SUPABASE_URL": supabase.url,
        "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
        "MONGO_URI": os.environ["FINSIGHT_TEST_MONGO_URI"],
        "MONGO_DATABASE": analytics_db.name,
        "ANALYTICS_USER_SALT": USER_SALT,
    }
    log_path = tmp_path_factory.mktemp("vite") / "vite.log"
    log = log_path.open("w", encoding="utf-8")
    process = subprocess.Popen(
        [node, str(vite), "dev", "--port", str(port), "--strictPort"],
        cwd=ROOT,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=os.name != "nt",
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 180
    try:
        while True:
            if process.poll() is not None:
                pytest.fail(f"vite dev exited early:\n{log_path.read_text(encoding='utf-8')[-3000:]}")
            try:
                urllib.request.urlopen(f"{base}/api/analytics/market/latest", timeout=30)
            except urllib.error.HTTPError as error:
                if error.code == 401:
                    break
            except OSError:
                pass
            if time.monotonic() > deadline:
                pytest.fail(f"vite dev did not serve the API:\n{log_path.read_text(encoding='utf-8')[-3000:]}")
            time.sleep(1)
        yield base
    finally:
        _stop(process)
        log.close()
