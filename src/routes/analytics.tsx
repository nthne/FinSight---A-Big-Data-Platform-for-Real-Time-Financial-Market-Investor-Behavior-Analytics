import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  RefreshCw,
  ShieldAlert,
  Waves,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageBody, PageHeader } from "@/components/section-heading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import {
  AnalyticsApiError,
  fetchAnalytics,
  type AnalyticsFreshness,
  type AnalyticsResponse,
  type PipelineHealth,
} from "@/lib/analytics";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Live Analytics - FinSight" },
      {
        name: "description",
        content:
          "Fresh Lambda Architecture market and investor analytics from MongoDB serving views.",
      },
    ],
  }),
  component: AnalyticsDashboard,
});

const FALLBACK_SYMBOLS = ["AAPL", "MSFT", "TSLA", "BTC", "GOLD"];

function AnalyticsDashboard() {
  const { session, role } = useAuth();
  const token = session?.access_token ?? "";
  const [symbol, setSymbol] = useState("AAPL");

  const latest = useQuery({
    queryKey: ["analytics", "market-latest"],
    queryFn: () => fetchAnalytics("market/latest", token),
    enabled: Boolean(token),
    refetchInterval: 30_000,
  });
  const series = useQuery({
    queryKey: ["analytics", "market-series", symbol],
    queryFn: () =>
      fetchAnalytics("market/series", token, { symbol, granularity: "1m", limit: 120 }),
    enabled: Boolean(token && symbol),
    refetchInterval: 30_000,
  });
  const activity = useQuery({
    queryKey: ["analytics", "my-activity"],
    queryFn: () => fetchAnalytics("me/activity", token, { granularity: "5m", limit: 48 }),
    enabled: Boolean(token),
    refetchInterval: 30_000,
  });
  const risk = useQuery({
    queryKey: ["analytics", "my-risk"],
    queryFn: () => fetchAnalytics("me/risk", token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const segment = useQuery({
    queryKey: ["analytics", "my-segment"],
    queryFn: () => fetchAnalytics("me/segment", token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const pipeline = useQuery({
    queryKey: ["analytics", "pipeline-health"],
    queryFn: () => fetchAnalytics("pipeline/health", token),
    enabled: Boolean(token && role === "admin"),
    refetchInterval: 15_000,
  });

  const symbols = useMemo(() => {
    const available = latest.data?.data.map((quote) => quote.asset_symbol) ?? [];
    return available.length ? available : FALLBACK_SYMBOLS;
  }, [latest.data]);

  useEffect(() => {
    if (latest.data?.data.length && !symbols.includes(symbol)) setSymbol(symbols[0]);
  }, [latest.data, symbol, symbols]);

  const refreshAll = () => {
    void Promise.all([
      latest.refetch(),
      series.refetch(),
      activity.refetch(),
      risk.refetch(),
      segment.refetch(),
      role === "admin" ? pipeline.refetch() : Promise.resolve(),
    ]);
  };
  const primaryError = [latest.error, series.error, activity.error].find(Boolean);
  const waiting = latest.isLoading && series.isLoading && activity.isLoading;

  return (
    <>
      <PageHeader
        eyebrow="Lambda serving view"
        title="Live analytics"
        description="Processed market and behavior metrics from Spark and MongoDB, with source-layer and freshness metadata preserved end to end."
        actions={
          <Button variant="outline" className="gap-2" onClick={refreshAll} disabled={waiting}>
            <RefreshCw className={`h-4 w-4 ${waiting ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />
      <PageBody>
        <Alert className="border-blue-200 bg-blue-50/70 text-blue-950">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Educational analytics</AlertTitle>
          <AlertDescription>
            These signals describe simulated activity. They are neither investment advice nor a
            psychological diagnosis. Speed-layer values remain provisional until reconciled with the
            batch layer.
          </AlertDescription>
        </Alert>

        {primaryError && <AnalyticsError error={primaryError} onRetry={refreshAll} />}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {latest.isLoading ? (
            Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-36 rounded-xl" />
            ))
          ) : latest.data?.data.length ? (
            latest.data.data.slice(0, 4).map((quote) => (
              <Card key={quote.asset_symbol} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-sm font-semibold">{quote.asset_symbol}</div>
                    <div className="small-caps mt-1 text-[0.62rem] text-muted-foreground">
                      Latest quote
                    </div>
                  </div>
                  <FreshnessBadge stale={quote.stale} />
                </div>
                <div className="mt-4 font-serif text-2xl font-semibold num">
                  {formatMoney(quote.last_price, quote.currency)}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatPercent(quote.window_return_pct)}</span>
                  <span>{formatAge(quote.quote_age_seconds)}</span>
                </div>
                <div className="mt-2 truncate text-[0.68rem] text-muted-foreground">
                  Source: {quote.source ?? "unknown"}
                </div>
              </Card>
            ))
          ) : (
            <EmptyCard
              className="md:col-span-2 xl:col-span-4"
              title="No live quotes yet"
              description="Start the ingestion and speed-layer workloads to populate latest_market_metrics."
            />
          )}
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="p-5 xl:col-span-2">
            <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="small-caps text-[0.65rem] text-muted-foreground">
                  Reconciled time series
                </div>
                <h2 className="font-serif text-xl font-semibold">Market price and volatility</h2>
              </div>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="w-full sm:w-36" aria-label="Asset symbol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {symbols.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </header>
            {series.isLoading ? (
              <Skeleton className="h-72" />
            ) : series.data?.data.points.length ? (
              <>
                <div className="h-72" aria-label={`${symbol} market series chart`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={marketChartData(series.data)}>
                      <defs>
                        <linearGradient id="market-price" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.32} />
                          <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="var(--color-border)"
                        strokeDasharray="2 4"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="price"
                        tick={{ fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={58}
                        domain={["auto", "auto"]}
                      />
                      <YAxis
                        yAxisId="volatility"
                        orientation="right"
                        tick={{ fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={44}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Area
                        yAxisId="price"
                        type="monotone"
                        dataKey="close"
                        name="Close"
                        stroke="var(--color-chart-1)"
                        strokeWidth={2}
                        fill="url(#market-price)"
                        connectNulls
                      />
                      <Line
                        yAxisId="volatility"
                        type="monotone"
                        dataKey="volatility"
                        name="Volatility %"
                        stroke="var(--color-chart-4)"
                        strokeWidth={1.5}
                        dot={false}
                        connectNulls
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <SourceLegend response={series.data} />
              </>
            ) : (
              <EmptyState
                title={`No ${symbol} windows yet`}
                description="The chart fills after Spark closes the first one-minute event-time window."
              />
            )}
          </Card>

          <Card className="p-5">
            <div className="small-caps text-[0.65rem] text-muted-foreground">Portfolio model</div>
            <h2 className="font-serif text-xl font-semibold">Risk snapshot</h2>
            {risk.isLoading ? (
              <div className="mt-5 space-y-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : risk.error ? (
              <PanelError description="The authoritative portfolio-risk view could not be loaded." />
            ) : risk.data?.data ? (
              <div className="mt-5 space-y-3">
                <MetricRow
                  label="Drawdown"
                  value={recordPercent(risk.data.data, [
                    "max_drawdown_pct",
                    "drawdown_pct",
                    "drawdown",
                  ])}
                />
                <MetricRow
                  label="Concentration"
                  value={recordPercent(risk.data.data, ["concentration_pct", "concentration"])}
                />
                <MetricRow
                  label="Volatility"
                  value={recordPercent(risk.data.data, ["volatility_pct", "volatility"])}
                />
                <SourceLegend response={risk.data} compact />
              </div>
            ) : (
              <EmptyState
                title="Risk view not computed"
                description="A batch portfolio run is required before this card has an authoritative result."
              />
            )}
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="p-5 xl:col-span-2">
            <div className="small-caps text-[0.65rem] text-muted-foreground">Behavior stream</div>
            <h2 className="font-serif text-xl font-semibold">Trading activity</h2>
            {activity.isLoading ? (
              <Skeleton className="mt-5 h-60" />
            ) : activity.data?.data.points.length ? (
              <>
                <div className="mt-5 h-60" aria-label="User activity chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={activityChartData(activity.data)}>
                      <CartesianGrid
                        stroke="var(--color-border)"
                        strokeDasharray="2 4"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                        width={34}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar
                        dataKey="trades"
                        name="Trades"
                        stackId="events"
                        fill="var(--color-chart-1)"
                        radius={[3, 3, 0, 0]}
                      />
                      <Bar
                        dataKey="actions"
                        name="Actions"
                        stackId="events"
                        fill="var(--color-chart-3)"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <SourceLegend response={activity.data} />
              </>
            ) : (
              <EmptyState
                title="No activity windows yet"
                description="Execute a simulated trade or user action to create the first five-minute window."
              />
            )}
          </Card>

          <Card className="p-5">
            <div className="small-caps text-[0.65rem] text-muted-foreground">
              Educational segment
            </div>
            <h2 className="font-serif text-xl font-semibold">Behavior pattern</h2>
            {segment.isLoading ? (
              <Skeleton className="mt-5 h-40" />
            ) : segment.error ? (
              <PanelError description="The educational behavior segment could not be loaded." />
            ) : segment.data?.data ? (
              <div className="mt-5">
                <div className="rounded-lg border bg-muted/40 p-4">
                  <div className="text-xs text-muted-foreground">Current segment</div>
                  <div className="mt-1 font-serif text-2xl font-semibold">
                    {recordText(segment.data.data, ["segment_label", "segment", "label"]) ??
                      "Unlabelled"}
                  </div>
                </div>
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  Segment labels summarize model features and do not diagnose behavior or recommend
                  a trade.
                </p>
                <SourceLegend response={segment.data} compact />
              </div>
            ) : (
              <EmptyState
                title="Segment not available"
                description="The MLlib batch job has not published a segment for this user."
              />
            )}
          </Card>
        </section>

        {role === "admin" && (
          <PipelinePanel
            response={pipeline.data ?? null}
            loading={pipeline.isLoading}
            error={pipeline.error}
          />
        )}
      </PageBody>
    </>
  );
}

function PipelinePanel({
  response,
  loading,
  error,
}: {
  response: AnalyticsResponse<PipelineHealth> | null;
  loading: boolean;
  error: Error | null;
}) {
  return (
    <Card className="p-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="small-caps text-[0.65rem] text-muted-foreground">Admin only</div>
          <h2 className="font-serif text-xl font-semibold">Pipeline health</h2>
        </div>
        {response?.meta.freshness && <FreshnessBadge stale={response.meta.freshness.stale} />}
      </header>
      {loading ? (
        <Skeleton className="mt-5 h-32" />
      ) : error ? (
        <p className="mt-5 text-sm text-destructive">Pipeline health could not be loaded.</p>
      ) : response ? (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <MetricTile
              icon={Waves}
              label="Streaming queries"
              value={String(response.data.queries.length)}
            />
            <MetricTile
              icon={AlertTriangle}
              label="Too-late events (24h)"
              value={String(response.data.gate.too_late)}
            />
            <MetricTile
              icon={Database}
              label="Lambda cutoffs"
              value={String(response.data.lambda.length)}
            />
          </div>
          {response.data.queries.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Query</th>
                    <th className="px-3 py-2 font-medium">Input/s</th>
                    <th className="px-3 py-2 font-medium">Processed/s</th>
                    <th className="px-3 py-2 font-medium">State rows</th>
                    <th className="px-3 py-2 font-medium">Watermark</th>
                  </tr>
                </thead>
                <tbody>
                  {response.data.queries.map((query) => (
                    <tr key={query.query_name} className="border-t">
                      <td className="px-3 py-2 font-mono">{query.query_name}</td>
                      <td className="px-3 py-2 num">{formatRate(query.input_rows_per_second)}</td>
                      <td className="px-3 py-2 num">
                        {formatRate(query.processed_rows_per_second)}
                      </td>
                      <td className="px-3 py-2 num">{query.state_rows_total}</td>
                      <td className="px-3 py-2">{formatTimestamp(query.watermark)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          title="No progress metrics"
          description="Start the speed layer to publish StreamingQueryProgress documents."
        />
      )}
    </Card>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-mono text-xl font-semibold num">{value}</div>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-semibold num">{value}</span>
    </div>
  );
}

function FreshnessBadge({ stale }: { stale: boolean }) {
  return (
    <Badge variant={stale ? "destructive" : "secondary"} className="gap-1">
      {stale ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
      {stale ? "Stale" : "Fresh"}
    </Badge>
  );
}

function SourceLegend<T>({
  response,
  compact = false,
}: {
  response: AnalyticsResponse<T>;
  compact?: boolean;
}) {
  const layers = response.meta.source.layers ?? [];
  return (
    <div
      className={`${compact ? "mt-4" : "mt-3"} flex flex-wrap items-center gap-2 text-xs text-muted-foreground`}
    >
      <Clock3 className="h-3.5 w-3.5" />
      <span>{freshnessLabel(response.meta.freshness)}</span>
      {layers.map((layer) => (
        <Badge key={layer} variant="outline" className="font-mono text-[0.65rem]">
          {layer === "speed" ? "speed · provisional" : "batch · authoritative"}
        </Badge>
      ))}
    </div>
  );
}

function AnalyticsError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const message =
    error instanceof AnalyticsApiError && error.code === "SERVING_UNAVAILABLE"
      ? "The MongoDB serving view is unavailable. Existing simulation screens still work; analytics will recover when the service returns."
      : error.message || "Analytics could not be loaded.";
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Live analytics unavailable</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{message}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function EmptyCard({
  title,
  description,
  className = "",
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <Card className={`p-5 ${className}`}>
      <EmptyState title={title} description={description} />
    </Card>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-32 place-items-center py-6 text-center">
      <div>
        <Activity className="mx-auto h-6 w-6 text-muted-foreground" />
        <div className="mt-3 text-sm font-medium">{title}</div>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function PanelError({ description }: { description: string }) {
  return (
    <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{description}</span>
      </div>
    </div>
  );
}

function marketChartData(
  response: AnalyticsResponse<{
    points: Array<{
      window_start: string;
      close: number | null;
      volatility_pct: number | null;
      layer: string;
    }>;
  }>,
) {
  return response.data.points.map((point) => ({
    time: formatWindowTime(point.window_start),
    close: point.close,
    volatility: point.volatility_pct,
    layer: point.layer,
  }));
}

function activityChartData(
  response: AnalyticsResponse<{
    points: Array<{
      window_start: string;
      trade_count: number;
      action_count: number;
      layer: string;
    }>;
  }>,
) {
  return response.data.points.map((point) => ({
    time: formatWindowTime(point.window_start),
    trades: point.trade_count,
    actions: point.action_count,
    layer: point.layer,
  }));
}

function formatWindowTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatMoney(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: value >= 1_000 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString("en-US")} ${currency ?? ""}`.trim();
  }
}

function formatPercent(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "Return —"
    : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatAge(seconds: number | null) {
  if (seconds === null) return "Age unknown";
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s ago`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3_600)}h ago`;
}

function formatRate(value: number | null) {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function freshnessLabel(freshness: AnalyticsFreshness | null) {
  if (!freshness) return "Freshness unavailable";
  return freshness.stale
    ? `Stale · ${formatAge(freshness.age_seconds)}`
    : `Fresh · ${formatAge(freshness.age_seconds)}`;
}

function recordPercent(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return `${value.toFixed(2)}%`;
  }
  return "Not reported";
}

function recordText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
