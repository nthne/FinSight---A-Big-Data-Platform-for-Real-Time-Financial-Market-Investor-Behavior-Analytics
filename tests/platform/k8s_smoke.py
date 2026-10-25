#!/usr/bin/env python3
"""Readiness and controlled-restart smoke test for the FinSight namespace.

The default mode is read-only. Pass ``--restart`` only during an authorized
fault-injection run; it deletes the current ingestion and speed-layer pods and
waits for their Deployments to recover.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time


NAMESPACE = "finsight"
DEPLOYMENTS = (
    "finsight-ingestion",
    "finsight-speed-layer",
    "finsight-app",
    "prometheus",
    "grafana",
)
SERVICES = ("kafka", "minio", "mongodb", "finsight-ingestion", "finsight-app")


def kubectl(*args: str, context: str | None = None, capture: bool = True) -> str:
    command = ["kubectl"]
    if context:
        command.extend(["--context", context])
    command.extend(args)
    result = subprocess.run(command, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def current_context(context: str | None) -> str:
    return context or kubectl("config", "current-context").strip()


def verify(context: str) -> dict:
    for deployment in DEPLOYMENTS:
        kubectl(
            "-n",
            NAMESPACE,
            "rollout",
            "status",
            f"deployment/{deployment}",
            "--timeout=15s",
            context=context,
        )
    endpoints = json.loads(
        kubectl("-n", NAMESPACE, "get", "endpoints", "-o", "json", context=context)
    )
    ready = {
        item["metadata"]["name"]: sum(
            len(subset.get("addresses", [])) for subset in item.get("subsets", [])
        )
        for item in endpoints["items"]
    }
    missing = [service for service in SERVICES if ready.get(service, 0) < 1]
    if missing:
        raise RuntimeError(f"services without ready endpoints: {', '.join(missing)}")
    return {"context": context, "namespace": NAMESPACE, "ready_endpoints": ready}


def restart(context: str, deployment: str, label: str) -> float:
    pod_list = json.loads(
        kubectl(
            "-n",
            NAMESPACE,
            "get",
            "pods",
            "-l",
            label,
            "-o",
            "json",
            context=context,
        )
    )["items"]
    if len(pod_list) != 1:
        raise RuntimeError(f"expected one pod for {label}, found {len(pod_list)}")
    pod = pod_list[0]["metadata"]["name"]
    started = time.monotonic()
    kubectl("-n", NAMESPACE, "delete", "pod", pod, context=context)
    kubectl(
        "-n",
        NAMESPACE,
        "rollout",
        "status",
        f"deployment/{deployment}",
        "--timeout=300s",
        context=context,
    )
    return time.monotonic() - started


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", help="kubectl context; defaults to the explicit current context")
    parser.add_argument("--restart", action="store_true", help="run the bounded pod-deletion test")
    args = parser.parse_args()
    context = current_context(args.context)
    result = verify(context)
    if args.restart:
        result["recovery_seconds"] = {
            "ingestion": round(restart(context, "finsight-ingestion", "app=finsight-ingestion"), 3),
            "speed_layer": round(
                restart(context, "finsight-speed-layer", "app=finsight-speed-layer"), 3
            ),
        }
        result["post_restart"] = verify(context)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
