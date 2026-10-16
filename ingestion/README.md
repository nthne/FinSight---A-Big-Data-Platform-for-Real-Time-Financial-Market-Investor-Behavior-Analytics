# FinSight ingestion

This directory contains the Member A Week 1 ingestion baseline: the Kafka topic declaration and a deterministic market-record normalizer/producer fixture. The live broker adapter and application-event producer are Week 2 work; publishing remains server-side so Kafka credentials never reach the React client.

## Topic rules

`kafka/topics.yaml` is the source-controlled topic specification. Market data is keyed by canonical asset symbol. Trades, user actions and snapshots are keyed by pseudonymous user ID so records for one user retain partition order. The local single-broker profile uses replication factor 1; an assessed multi-broker profile must override it to 3 with `min.insync.replicas=2`.

All topics use delete retention rather than log compaction because the event log must remain replayable during the declared retention window. Bronze storage is the longer-lived immutable record.

## Producer fixture

`producers/market_producer.py` provides:

- normalization of symbol, source, timestamp, currency and quote values;
- UUIDv5 event IDs derived from a provider record ID, or from source/symbol/event time;
- JSON Schema and known-symbol validation;
- routing invalid records to the DLQ with a stable error code;
- a salted SHA-256 helper for analytical user IDs;
- an in-memory publisher used for deterministic tests before the shared Kafka service is available.

Run the test suite:

```powershell
python -m pip install -r ingestion/requirements-dev.txt
python -m pytest ingestion/tests/test_producers.py -v
```

To normalize an upstream-style JSON fixture locally:

```powershell
python -m ingestion.producers.market_producer ingestion/fixtures/market-quote-source.json --known-symbol AAPL
```

The shared Week 1 integration gate (a record on a real Kafka broker) depends on Member D's broker/runtime baseline. Once available, the Week 2 Kafka publisher must implement the small `Publisher.publish(topic, key, value)` boundary without changing normalization or event IDs.
