from __future__ import annotations

import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
K8S = ROOT / "deploy" / "k8s"


def documents() -> list[tuple[Path, dict]]:
    result: list[tuple[Path, dict]] = []
    for path in sorted(K8S.glob("*.yaml")):
        if path.name == "secrets.example.yaml":
            continue
        for document in yaml.safe_load_all(path.read_text(encoding="utf-8")):
            if document:
                result.append((path, document))
    return result


def keyed_documents() -> dict[tuple[str, str], dict]:
    return {
        (document["kind"], document["metadata"]["name"]): document
        for _, document in documents()
    }


def pod_specs():
    for path, document in documents():
        kind = document["kind"]
        spec = document.get("spec", {})
        if kind in {"Deployment", "StatefulSet", "DaemonSet"}:
            yield path, document, spec["template"]["spec"]
        elif kind == "Job":
            yield path, document, spec["template"]["spec"]
        elif kind == "CronJob":
            yield path, document, spec["jobTemplate"]["spec"]["template"]["spec"]


def env_secret_keys(container: dict) -> dict[str, tuple[str, str]]:
    found: dict[str, tuple[str, str]] = {}
    for env in container.get("env", []):
        ref = env.get("valueFrom", {}).get("secretKeyRef")
        if ref:
            found[env["name"]] = (ref["name"], ref["key"])
    return found


def test_every_namespaced_resource_targets_finsight():
    for path, document in documents():
        if document["kind"] == "Namespace":
            assert document["metadata"]["name"] == "finsight"
        else:
            assert document["metadata"].get("namespace") == "finsight", path


def test_every_container_has_bounded_resources():
    for path, document, pod_spec in pod_specs():
        for container in pod_spec.get("initContainers", []) + pod_spec.get("containers", []):
            resources = container.get("resources", {})
            assert resources.get("requests", {}).get("cpu"), (path, document["metadata"]["name"], container["name"])
            assert resources.get("requests", {}).get("memory"), (path, document["metadata"]["name"], container["name"])
            assert resources.get("limits", {}).get("cpu"), (path, document["metadata"]["name"], container["name"])
            assert resources.get("limits", {}).get("memory"), (path, document["metadata"]["name"], container["name"])


def test_long_running_workloads_have_readiness_and_liveness_probes():
    for path, document, pod_spec in pod_specs():
        if document["kind"] not in {"Deployment", "StatefulSet"}:
            continue
        for container in pod_spec["containers"]:
            assert "readinessProbe" in container, (path, document["metadata"]["name"], container["name"])
            assert "livenessProbe" in container, (path, document["metadata"]["name"], container["name"])


def test_required_services_and_persistent_boundaries_exist():
    keyed = keyed_documents()
    for service in ("kafka", "minio", "mongodb", "finsight-app", "prometheus", "grafana"):
        assert ("Service", service) in keyed
    assert keyed[("StatefulSet", "kafka")]["spec"]["volumeClaimTemplates"]
    assert keyed[("StatefulSet", "mongodb")]["spec"]["volumeClaimTemplates"]
    assert ("PersistentVolumeClaim", "minio-data") in keyed
    assert ("PersistentVolumeClaim", "prometheus-data") in keyed


def test_mongodb_least_privilege_uris_are_wired_to_the_right_workloads():
    keyed = keyed_documents()
    app = keyed[("Deployment", "finsight-app")]["spec"]["template"]["spec"]["containers"][0]
    stream = keyed[("Deployment", "finsight-speed-layer")]["spec"]["template"]["spec"]["containers"][0]
    assert env_secret_keys(app)["MONGO_URI"] == ("finsight-platform-secrets", "mongodb-reader-uri")
    assert env_secret_keys(stream)["MONGO_URI"] == ("finsight-platform-secrets", "mongodb-writer-uri")


def test_stream_uses_persistent_s3a_checkpoints_and_stable_lineage():
    keyed = keyed_documents()
    data = keyed[("ConfigMap", "finsight-platform-config")]["data"]
    assert data["CHECKPOINT_ROOT"].startswith("s3a://")
    assert data["RUN_ID"] == "k8s-speed-v1"
    assert data["WATERMARK_DELAY"] == "10 minutes"
    deployment = keyed[("Deployment", "finsight-speed-layer")]
    assert deployment["spec"]["replicas"] == 1
    assert deployment["spec"]["strategy"]["type"] == "Recreate"


def test_example_secret_contains_placeholders_not_live_values():
    secret = next(yaml.safe_load_all((K8S / "secrets.example.yaml").read_text(encoding="utf-8")))
    values = secret["stringData"]
    required = {
        "gateway-token",
        "analytics-user-salt",
        "minio-access-key",
        "minio-secret-key",
        "mongodb-admin-uri",
        "mongodb-writer-uri",
        "mongodb-reader-uri",
        "supabase-secret-key",
        "grafana-admin-password",
    }
    assert required <= values.keys()
    assert all("replace" in str(values[key]) or key == "minio-access-key" for key in required)


def test_dashboard_covers_each_shared_observability_boundary():
    dashboard = json.loads(
        (ROOT / "monitoring" / "dashboards" / "finsight-overview.json").read_text(
            encoding="utf-8"
        )
    )
    platform_exporter = (ROOT / "src" / "lib" / "platform-metrics.server.ts").read_text(
        encoding="utf-8"
    )
    expressions = "\n".join(
        target["expr"]
        for panel in dashboard["panels"]
        for target in panel.get("targets", [])
    )
    for metric in (
        "finsight_ingestion_accepted_total",
        "kafka_consumergroup_lag",
        "finsight_stream_batch_duration_seconds",
        "finsight_stream_state_rows",
        "finsight_stream_watermark_timestamp_seconds",
        "finsight_gate_too_late_events_24h",
        "finsight_market_event_timestamp_seconds",
        "finsight_mongodb_ping_duration_seconds",
        "finsight_analytics_api_errors_total",
        "kubelet_volume_stats_used_bytes",
        "container_cpu_usage_seconds_total",
    ):
        assert metric in expressions
    for app_metric in (
        "finsight_market_event_timestamp_seconds",
        "finsight_mongodb_ping_duration_seconds",
        "finsight_stream_batch_duration_seconds",
        "finsight_gate_too_late_events_24h",
    ):
        assert app_metric in platform_exporter


def test_version_coordinates_stay_aligned_with_streaming_code():
    dockerfile = (ROOT / "containers" / "spark" / "Dockerfile").read_text(encoding="utf-8")
    config = (ROOT / "spark" / "lib" / "streaming_config.py").read_text(encoding="utf-8")
    spark_defaults = (ROOT / "storage" / "minio" / "spark-defaults.conf").read_text(
        encoding="utf-8"
    )
    assert "ARG SPARK_VERSION=4.0.4" in dockerfile
    assert 'SPARK_VERSION = "4.0.4"' in config
    assert "ARG HADOOP_AWS_VERSION=3.4.1" in dockerfile
    assert 'HADOOP_AWS_PACKAGE = "org.apache.hadoop:hadoop-aws:3.4.1"' in config
    assert "ARG GRAPHFRAMES_VERSION=0.12.3" in dockerfile
    assert "io.graphframes:graphframes-spark4_2.13:${GRAPHFRAMES_VERSION}" in dockerfile
    assert "ARG MONGO_SPARK_VERSION=11.1.0" in dockerfile
    assert "mongo-spark-connector_2.13:${MONGO_SPARK_VERSION}" in dockerfile
    assert (
        "software.amazon.awssdk.auth.credentials.EnvironmentVariableCredentialsProvider"
        in spark_defaults
    )
    assert "com.amazonaws.auth.EnvironmentVariableCredentialsProvider" not in spark_defaults


def test_app_image_uses_node_server_and_never_builds_with_a_server_secret():
    dockerfile = (ROOT / "containers" / "app" / "Dockerfile").read_text(encoding="utf-8")
    assert 'CMD ["node", ".output/server/index.mjs"]' in dockerfile
    assert "VITE_SUPABASE_PUBLISHABLE_KEY" in dockerfile
    assert "SUPABASE_SECRET_KEY" not in dockerfile

