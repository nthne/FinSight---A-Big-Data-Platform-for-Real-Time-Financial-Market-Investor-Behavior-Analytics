FROM golang:1.24.9-bookworm AS builder

ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
RUN CGO_ENABLED=0 go install github.com/minio/minio@${MINIO_VERSION}

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 minio \
    && useradd --uid 1000 --gid minio --home-dir /data --no-create-home minio \
    && mkdir --parents /data \
    && chown minio:minio /data

COPY --from=builder /go/bin/minio /usr/local/bin/minio

USER minio
VOLUME ["/data"]
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
