type AnalyticsMetric = {
  count: number;
  errors: number;
  durationSeconds: number;
};

const startedAt = Date.now();
const analyticsRequests = new Map<string, AnalyticsMetric>();

function metricKey(route: string, status: number) {
  const safeRoute = route.replace(/[^a-zA-Z0-9_./-]/g, "_") || "unknown";
  return `${safeRoute}|${status}`;
}

export function observeAnalyticsRequest(route: string, status: number, durationMs: number) {
  const key = metricKey(route, status);
  const metric = analyticsRequests.get(key) ?? { count: 0, errors: 0, durationSeconds: 0 };
  metric.count += 1;
  metric.errors += status >= 500 ? 1 : 0;
  metric.durationSeconds += Math.max(0, durationMs) / 1_000;
  analyticsRequests.set(key, metric);
}

function escapeLabel(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Process-local Prometheus metrics for the Node/Kubernetes application.
 * Counters reset whenever a pod restarts; Prometheus handles that reset.
 */
export function renderApplicationMetrics(now = Date.now()) {
  const lines = [
    "# HELP finsight_app_up Whether this application process can serve requests.",
    "# TYPE finsight_app_up gauge",
    "finsight_app_up 1",
    "# HELP finsight_app_uptime_seconds Seconds since this application process started.",
    "# TYPE finsight_app_uptime_seconds gauge",
    `finsight_app_uptime_seconds ${Math.max(0, now - startedAt) / 1_000}`,
    "# HELP finsight_analytics_api_requests_total Analytics API responses by route and status.",
    "# TYPE finsight_analytics_api_requests_total counter",
    "# HELP finsight_analytics_api_errors_total Analytics API 5xx responses by route and status.",
    "# TYPE finsight_analytics_api_errors_total counter",
    "# HELP finsight_analytics_api_request_duration_seconds_sum Total analytics API request time.",
    "# TYPE finsight_analytics_api_request_duration_seconds_sum counter",
  ];

  for (const [key, metric] of [...analyticsRequests.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const [route, status] = key.split("|");
    const labels = `route="${escapeLabel(route)}",status="${status}"`;
    lines.push(`finsight_analytics_api_requests_total{${labels}} ${metric.count}`);
    lines.push(
      `finsight_analytics_api_request_duration_seconds_sum{${labels}} ${metric.durationSeconds}`,
    );
    if (metric.errors) {
      lines.push(`finsight_analytics_api_errors_total{${labels}} ${metric.errors}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
