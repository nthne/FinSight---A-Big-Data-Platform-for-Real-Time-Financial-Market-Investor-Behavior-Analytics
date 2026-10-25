import assert from "node:assert/strict";
import test from "node:test";

import {
  observeAnalyticsRequest,
  renderApplicationMetrics,
} from "../../src/lib/app-metrics.server.ts";

test("application metrics expose unique route/status series and aggregate no secrets", () => {
  observeAnalyticsRequest("market/latest", 200, 125);
  observeAnalyticsRequest("market/latest", 500, 250);
  observeAnalyticsRequest('market/series\n{token="hidden"}', 503, 500);

  const metrics = renderApplicationMetrics();

  assert.match(metrics, /finsight_app_up 1/);
  assert.match(
    metrics,
    /finsight_analytics_api_requests_total\{route="market\/latest",status="200"\} 1/,
  );
  assert.match(
    metrics,
    /finsight_analytics_api_errors_total\{route="market\/latest",status="500"\} 1/,
  );
  assert.doesNotMatch(metrics, /token="hidden"/);

  const samples = metrics
    .split("\n")
    .filter((line) => line.startsWith("finsight_analytics_api_errors_total{"));
  assert.equal(samples.length, new Set(samples.map((sample) => sample.split(" ")[0])).size);
});
