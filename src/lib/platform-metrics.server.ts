import type { Db, Document } from "mongodb";

function label(value: unknown) {
  return String(value ?? "unknown")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function dateSeconds(value: unknown) {
  return value instanceof Date ? value.getTime() / 1_000 : 0;
}

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Export the latest persisted Spark progress and serving health without user data. */
export async function renderPlatformMetrics(db: Db) {
  const pingStarted = performance.now();
  await db.command({ ping: 1 });
  const pingSeconds = (performance.now() - pingStarted) / 1_000;
  const metrics = db.collection<Document>("pipeline_quality_metrics");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const [progress, gates, latestMarket] = await Promise.all([
    metrics
      .aggregate([
        { $match: { kind: "progress" } },
        { $sort: { timestamp: -1 } },
        { $group: { _id: "$query_name", doc: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$doc" } },
      ])
      .toArray(),
    metrics.find({ kind: "gate", computed_at: { $gte: since } }).toArray(),
    db
      .collection<Document>("latest_market_metrics")
      .find({}, { projection: { last_event_time: 1 } })
      .sort({ last_event_time: -1 })
      .limit(1)
      .next(),
  ]);

  const lines = [
    "# HELP finsight_mongodb_up Whether the serving database answered a ping.",
    "# TYPE finsight_mongodb_up gauge",
    "finsight_mongodb_up 1",
    "# HELP finsight_mongodb_ping_duration_seconds MongoDB ping latency observed by the app.",
    "# TYPE finsight_mongodb_ping_duration_seconds gauge",
    `finsight_mongodb_ping_duration_seconds ${pingSeconds}`,
    "# HELP finsight_stream_input_rows_per_second Latest Spark input rate.",
    "# TYPE finsight_stream_input_rows_per_second gauge",
    "# HELP finsight_stream_processed_rows_per_second Latest Spark processing rate.",
    "# TYPE finsight_stream_processed_rows_per_second gauge",
    "# HELP finsight_stream_batch_duration_seconds Latest Spark trigger duration.",
    "# TYPE finsight_stream_batch_duration_seconds gauge",
    "# HELP finsight_stream_state_rows Latest Spark state rows.",
    "# TYPE finsight_stream_state_rows gauge",
    "# HELP finsight_stream_rows_dropped_by_watermark Latest rows dropped by the watermark.",
    "# TYPE finsight_stream_rows_dropped_by_watermark gauge",
    "# HELP finsight_stream_watermark_timestamp_seconds Latest event-time watermark.",
    "# TYPE finsight_stream_watermark_timestamp_seconds gauge",
    "# HELP finsight_market_event_timestamp_seconds Most recent served market event time.",
    "# TYPE finsight_market_event_timestamp_seconds gauge",
  ];

  if (latestMarket?.last_event_time instanceof Date) {
    lines.push(
      `finsight_market_event_timestamp_seconds ${dateSeconds(latestMarket.last_event_time)}`,
    );
  }

  for (const item of progress) {
    const query = `query="${label(item.query_name)}"`;
    const duration = item.duration_ms as Record<string, unknown> | undefined;
    lines.push(
      `finsight_stream_input_rows_per_second{${query}} ${numeric(item.input_rows_per_second)}`,
    );
    lines.push(
      `finsight_stream_processed_rows_per_second{${query}} ${numeric(item.processed_rows_per_second)}`,
    );
    lines.push(
      `finsight_stream_batch_duration_seconds{${query}} ${numeric(duration?.triggerExecution) / 1_000}`,
    );
    lines.push(`finsight_stream_state_rows{${query}} ${numeric(item.state_rows_total)}`);
    lines.push(
      `finsight_stream_rows_dropped_by_watermark{${query}} ${numeric(item.rows_dropped_by_watermark)}`,
    );
    lines.push(
      `finsight_stream_watermark_timestamp_seconds{${query}} ${dateSeconds(item.watermark)}`,
    );
  }

  const invalid = gates.reduce((total, item) => total + numeric(item.invalid), 0);
  const tooLate = gates.reduce(
    (total, item) =>
      total + numeric((item.by_lateness as Record<string, unknown> | undefined)?.too_late),
    0,
  );
  lines.push(
    "# HELP finsight_gate_invalid_events_24h Invalid events recorded by the stream gate in 24 hours.",
  );
  lines.push("# TYPE finsight_gate_invalid_events_24h gauge");
  lines.push(`finsight_gate_invalid_events_24h ${invalid}`);
  lines.push(
    "# HELP finsight_gate_too_late_events_24h Too-late events recorded by the stream gate in 24 hours.",
  );
  lines.push("# TYPE finsight_gate_too_late_events_24h gauge");
  lines.push(`finsight_gate_too_late_events_24h ${tooLate}`);
  return `${lines.join("\n")}\n`;
}

export function renderPlatformUnavailable() {
  return [
    "# HELP finsight_mongodb_up Whether the serving database answered a ping.",
    "# TYPE finsight_mongodb_up gauge",
    "finsight_mongodb_up 0",
    "",
  ].join("\n");
}
