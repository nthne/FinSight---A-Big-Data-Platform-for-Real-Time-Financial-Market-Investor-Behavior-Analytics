# Shared Spark runtime. Component owners may extend this image but must keep the
# version coordinates aligned with docs/architecture/version-matrix.md.
FROM eclipse-temurin:21-jre-noble

ARG SPARK_VERSION=4.0.4
ARG HADOOP_AWS_VERSION=3.4.1
ARG GRAPHFRAMES_VERSION=0.12.3
ARG MONGO_SPARK_VERSION=11.1.0

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    PYSPARK_PYTHON=/opt/venv/bin/python \
    SPARK_CONF_DIR=/app/conf

RUN apt-get update \
    && apt-get install --no-install-recommends --yes python3 python3-venv tini \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv \
    && groupadd --gid 1001 finsight \
    && useradd --uid 1001 --gid finsight --home-dir /app --create-home finsight

WORKDIR /app
COPY requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --requirement /tmp/requirements.lock \
    && rm /tmp/requirements.lock

COPY --chown=finsight:finsight spark spark
COPY --chown=finsight:finsight serving serving
COPY --chown=finsight:finsight storage storage
COPY --chown=finsight:finsight ingestion ingestion
COPY --chown=finsight:finsight storage/minio/spark-defaults.conf conf/spark-defaults.conf

USER finsight

# Resolve JVM connectors at build time; production pods do not need Maven access.
RUN python -c "from pyspark.sql import SparkSession; packages=','.join(['org.apache.spark:spark-sql-kafka-0-10_2.13:${SPARK_VERSION}','org.apache.hadoop:hadoop-aws:${HADOOP_AWS_VERSION}','io.graphframes:graphframes-spark4_2.13:${GRAPHFRAMES_VERSION}','org.mongodb.spark:mongo-spark-connector_2.13:${MONGO_SPARK_VERSION}']); SparkSession.builder.master('local[1]').config('spark.ui.enabled','false').config('spark.jars.packages',packages).getOrCreate().stop()"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "spark.jobs.streaming.speed_layer"]

