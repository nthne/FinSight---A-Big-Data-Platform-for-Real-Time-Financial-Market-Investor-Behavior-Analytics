FROM python:3.12.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY ingestion/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    && addgroup --system finsight \
    && adduser --system --ingroup finsight --home /app finsight

COPY --chown=finsight:finsight data-contracts /app/data-contracts
COPY --chown=finsight:finsight ingestion /app/ingestion
COPY --chown=finsight:finsight storage /app/storage

USER finsight
EXPOSE 8080

CMD ["uvicorn", "ingestion.api:app", "--host", "0.0.0.0", "--port", "8080"]
