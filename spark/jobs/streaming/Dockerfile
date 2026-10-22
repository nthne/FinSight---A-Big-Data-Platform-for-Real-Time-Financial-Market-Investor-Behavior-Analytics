# Speed-layer image (Person C): Spark Structured Streaming jobs + MongoDB serving tools.
#
#   docker build -f spark/jobs/streaming/Dockerfile -t finsight-streaming:dev .
#
# Build context is the repository root; spark/jobs/streaming/Dockerfile.dockerignore
# limits it to the files below. Versions follow serving/requirements-dev.txt and
# spark/lib/streaming_config.py (Spark 4.0.4 / Scala 2.13 / Java 21 / hadoop-aws 3.4.1).
# Major-version tag; the resolved digest is recorded in docs/evidence/streaming-integration.md.
FROM eclipse-temurin:21-jre-noble

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYSPARK_PYTHON=/opt/venv/bin/python \
    SPARK_CONF_DIR=/app/conf

RUN apt-get update \
    && apt-get install --no-install-recommends --yes python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv \
    && pip install --no-cache-dir "pyspark==4.0.4" "pymongo>=4.10,<5" \
    && groupadd --gid 1001 finsight \
    && useradd --uid 1001 --gid finsight --home-dir /app --create-home finsight

WORKDIR /app
USER finsight

# Resolve the Kafka and S3A connector jars once at build time so pods start
# without Maven access. Only the version module is copied first, so code
# changes do not invalidate this (large) layer.
COPY --chown=finsight:finsight spark/__init__.py spark/__init__.py
COPY --chown=finsight:finsight spark/lib/__init__.py spark/lib/streaming_config.py spark/lib/
RUN python -c "from pyspark.sql import SparkSession; \
from spark.lib.streaming_config import HADOOP_AWS_PACKAGE, KAFKA_PACKAGE; \
SparkSession.builder.master('local[1]').config('spark.ui.enabled', 'false') \
.config('spark.jars.packages', KAFKA_PACKAGE + ',' + HADOOP_AWS_PACKAGE).getOrCreate().stop()"

# S3A endpoint/credential settings owned by Person A (storage boundary).
COPY --chown=finsight:finsight storage/minio/spark-defaults.conf conf/spark-defaults.conf
COPY --chown=finsight:finsight spark spark
COPY --chown=finsight:finsight serving serving

CMD ["python", "-m", "spark.jobs.streaming.speed_layer"]
