import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertTriangle,
  Brain,
  Repeat,
  TrendingDown,
  Users,
  Activity,
  ClipboardList,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getAsset } from "@/lib/market";
import { useTradingStore, type ExecutedOrder, type Position } from "@/lib/store";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  getMyBiasResults,
  getMyActionLogs,
  getMyBehavioralMetrics,
  getMyAiRecommendations,
} from "@/lib/user-data.functions";
import { useEffect } from "react";
import { logUserAction } from "@/lib/user-data.functions";

export const Route = createFileRoute("/behavioral")({
  head: () => ({
    meta: [
      { title: "Behavioral Analytics - FinSight" },
      { name: "description", content: "Prospect theory, bias detection, and sequential decision modeling." },
    ],
  }),
  component: Behavioral,
});

// Removed static loss curve

const SEVERITY_COLOR: Record<string, string> = {
  low: "text-yellow-600 bg-yellow-50 border-yellow-200",
  medium: "text-orange-600 bg-orange-50 border-orange-200",
  high: "text-red-600 bg-red-50 border-red-200",
};

const ACTION_ICON: Record<string, string> = {
  trade_executed: "🔄",
  view_behavioral: "👁",
  view_portfolio: "💼",
  view_asset: "📈",
  save_summary: "💾",
};

function Behavioral() {
  const positions = useTradingStore((s) => s.positions);
  const history = useTradingStore((s) => s.history);
  const marketVersion = useTradingStore((s) => s.marketVersion);
  const analytics = deriveBehavioralSignals(positions, history);
  void marketVersion;

  const fetchBiasResults = useServerFn(getMyBiasResults);
  const fetchActionLogs = useServerFn(getMyActionLogs);
  const fetchMetrics = useServerFn(getMyBehavioralMetrics);
  const fetchAiRecs = useServerFn(getMyAiRecommendations);
  const doLogAction = useServerFn(logUserAction);

  // Log page visit
  useEffect(() => {
    doLogAction({ data: { actionType: "view_behavioral" } }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: biasData } = useQuery({
    queryKey: ["my-bias-results"],
    queryFn: () => fetchBiasResults(),
  });
  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ["my-action-logs"],
    queryFn: () => fetchActionLogs({ data: { limit: 30 } }),
  });
  const { data: metricsData } = useQuery({
    queryKey: ["my-behavioral-metrics"],
    queryFn: () => fetchMetrics({ data: {} }),
  });
  const { data: recsData } = useQuery({
    queryKey: ["my-ai-recommendations"],
    queryFn: () => fetchAiRecs(),
  });

  const dbBiasResults = biasData?.results ?? [];
  const actionLogs = logsData?.logs ?? [];
  const dbMetrics = metricsData?.metrics ?? [];
  const dbRecs = recsData?.recommendations ?? [];
  
  // Format metrics for charting (reverse so oldest is first, if order is desc from DB)
  const chartData = [...dbMetrics].reverse().map((m, i) => ({
    name: m.metric_name.replace(/_/g, " "),
    value: Number(m.metric_value),
    index: i + 1,
  }));

  return (
    <>
      <PageHeader
        eyebrow="System Feature 4.2 - Behavioral Engine"
        title="Behavioral analytics"
        description="Signals are derived from your executed orders, holdings, and activity logs."
        actions={<Badge variant="secondary" className="font-mono">{history.length} trades</Badge>}
      />
      <PageBody>
        <Tabs defaultValue="overview">
          <TabsList className="mb-6">
            <TabsTrigger value="overview" className="gap-2">
              <Brain className="h-4 w-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="bias" className="gap-2">
              <Activity className="h-4 w-4" /> Bias Detection
            </TabsTrigger>
            <TabsTrigger value="log" className="gap-2">
              <ClipboardList className="h-4 w-4" /> Action Log
            </TabsTrigger>
          </TabsList>

          {/* ── TAB 1: OVERVIEW ── */}
          <TabsContent value="overview" className="space-y-6">
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {analytics.biases.map((b) => (
                <Card key={b.code} className="p-5">
                  <div className="flex items-center justify-between">
                    <b.icon className="h-5 w-5 text-primary" />
                    <span className="small-caps text-[0.6rem] text-muted-foreground">{b.code}</span>
                  </div>
                  <div className="font-serif text-xl font-semibold mt-3">{b.name}</div>
                  <div className="font-mono num text-3xl mt-1">
                    {b.value}<span className="text-base text-muted-foreground">/100</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${b.value}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{b.desc}</p>
                </Card>
              ))}
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 p-5">
                <div className="small-caps text-[0.65rem] text-muted-foreground">Real Data Tracking</div>
                <h2 className="font-serif text-xl font-semibold">Behavioral metrics trend</h2>
                <p className="text-xs text-muted-foreground mt-1 mb-4">
                  Visualizing your actual tracked behavioral metrics over time from the database.
                </p>
                <div className="h-72">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" />
                        <XAxis dataKey="index" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12 }} />
                        <Line type="monotone" dataKey="value" stroke="var(--color-chart-1)" strokeWidth={2.5} dot={{ r: 4 }} name="Metric Score" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                      No metrics saved yet.
                    </div>
                  )}
                </div>
              </Card>

              <Card className="p-5 flex flex-col">
                <div className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />
                  <h3 className="font-serif text-xl font-semibold">AI recommendation</h3>
                </div>
                <div className="mt-4 flex-1">
                  {dbRecs.length > 0 ? (
                    <ul className="text-sm space-y-4 leading-relaxed">
                      {dbRecs.slice(0, 3).map((item) => (
                        <li key={item.recommendation_id} className="border-l-2 border-primary pl-3">
                          <span className="font-medium block mb-1">{item.title ?? "Insight"}</span>
                          <span className="text-muted-foreground text-xs">{item.content}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No personalized AI recommendations generated yet. Save a behavior summary first.</p>
                  )}
                </div>
                {dbMetrics.length > 0 && (
                  <div className="mt-4 pt-4 border-t space-y-2">
                    <div className="small-caps text-[0.6rem] text-muted-foreground">Latest metrics</div>
                    {dbMetrics.slice(0, 4).map((m) => (
                      <div key={m.metric_id} className="flex justify-between text-xs">
                        <span className="text-muted-foreground capitalize">{m.metric_name.replace(/_/g, " ")}</span>
                        <span className="font-mono num">{Number(m.metric_value).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </section>

            <Card className="p-5">
              <h3 className="font-serif text-lg font-semibold mb-4">Sequential decision log</h3>
              {history.length ? (
                <div className="overflow-x-auto -mx-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left small-caps text-[0.65rem] text-muted-foreground border-b">
                        <th className="px-5 py-2 font-medium">Time</th>
                        <th className="py-2 font-medium">Action</th>
                        <th className="py-2 font-medium">State context</th>
                        <th className="py-2 font-medium">Bias signal</th>
                        <th className="py-2 font-medium text-right pr-5">Confidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {history.slice(0, 8).map((order) => {
                        const signal = classifyOrder(order);
                        return (
                          <tr key={order.id}>
                            <td className="px-5 py-3 font-mono">{new Date(order.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</td>
                            <td className="font-mono">{order.side.toUpperCase()} {order.qty} <Link to="/asset/$symbol" params={{ symbol: order.symbol }} className="hover:text-primary hover:underline">{order.symbol}</Link></td>
                            <td className="text-muted-foreground">{order.qty} @ {order.price.toFixed(2)}</td>
                            <td><Badge variant="secondary">{signal.label}</Badge></td>
                            <td className="font-mono num text-right pr-5">{signal.confidence.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No decisions have been logged yet. Execute trades to generate behavioral evidence.</p>
              )}
            </Card>
          </TabsContent>

          {/* ── TAB 2: BIAS DETECTION (from DB) ── */}
          <TabsContent value="bias" className="space-y-4">
            {dbBiasResults.length === 0 ? (
              <Card className="p-8 text-center">
                <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-serif text-lg font-semibold">No bias analyses yet</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                  Bias detection results will appear here after your portfolio behavior is analyzed by the AI engine.
                  Save a behavior summary from the Portfolio page to trigger analysis.
                </p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {dbBiasResults.map((r) => (
                  <Card key={r.result_id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold capitalize">{r.bias_type.replace(/_/g, " ")}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {new Date(r.detected_at).toLocaleDateString("en-US", {
                            month: "short", day: "numeric", year: "numeric",
                          })}
                        </div>
                      </div>
                      <Badge
                        className={`shrink-0 border capitalize ${SEVERITY_COLOR[r.severity] ?? ""}`}
                        variant="outline"
                      >
                        {r.severity}
                      </Badge>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-muted-foreground">Score</span>
                        <span className="font-mono num text-sm font-semibold">{Number(r.score).toFixed(1)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full ${r.severity === "high" ? "bg-red-500" : r.severity === "medium" ? "bg-orange-400" : "bg-yellow-400"}`}
                          style={{ width: `${Math.min(100, Number(r.score))}%` }}
                        />
                      </div>
                    </div>
                    {r.explanation && (
                      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{r.explanation}</p>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── TAB 3: ACTION LOG (from DB) ── */}
          <TabsContent value="log">
            <Card className="p-5">
              <h3 className="font-serif text-lg font-semibold mb-4">User action log</h3>
              {logsLoading ? (
                <p className="text-sm text-muted-foreground py-4">Loading...</p>
              ) : actionLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No actions recorded yet.</p>
              ) : (
                <div className="overflow-x-auto -mx-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left small-caps text-[0.65rem] text-muted-foreground border-b">
                        <th className="px-5 py-2 font-medium">Time</th>
                        <th className="py-2 font-medium">Action</th>
                        <th className="py-2 font-medium">Symbol</th>
                        <th className="py-2 font-medium pr-5">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {actionLogs.map((log) => (
                        <tr key={log.log_id} className="hover:bg-muted/30">
                          <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString("en-US", {
                              month: "short", day: "numeric",
                              hour: "2-digit", minute: "2-digit",
                            })}
                          </td>
                          <td className="py-2.5">
                            <div className="flex items-center gap-2">
                              <span>{ACTION_ICON[log.action_type] ?? "•"}</span>
                              <span className="capitalize text-sm">{log.action_type.replace(/_/g, " ")}</span>
                            </div>
                          </td>
                          <td className="py-2.5 font-mono text-primary text-sm">
                            {log.symbol ? (
                              <Link to="/asset/$symbol" params={{ symbol: log.symbol }} className="hover:underline">{log.symbol}</Link>
                            ) : "—"}
                          </td>
                          <td className="py-2.5 text-xs text-muted-foreground pr-5 max-w-xs truncate">
                            {log.metadata && Object.keys(log.metadata as object).length > 0
                              ? JSON.stringify(log.metadata).slice(0, 60) + (JSON.stringify(log.metadata).length > 60 ? "…" : "")
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

function deriveBehavioralSignals(positions: Position[], history: ExecutedOrder[]) {
  const losingPositions = positions.filter((p) => {
    const asset = getAsset(p.symbol);
    return asset ? asset.price < p.avgCost : false;
  }).length;
  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = history.filter((order) => new Date(order.ts).toISOString().slice(0, 10) === today).length;
  const buyTrades = history.filter((order) => order.side === "buy").length;
  const sellTrades = history.filter((order) => order.side === "sell").length;
  const concentration = Math.max(
    0,
    ...positions.map((p) => {
      const asset = getAsset(p.symbol);
      return asset ? asset.price * p.qty : 0;
    }),
  );
  const totalHeld = positions.reduce((sum, p) => {
    const asset = getAsset(p.symbol);
    return sum + (asset ? asset.price * p.qty : 0);
  }, 0);
  const concentrationPct = totalHeld ? (concentration / totalHeld) * 100 : 0;

  const biases = [
    {
      name: "Loss aversion",
      code: "BM-1",
      value: Math.min(100, losingPositions * 25),
      icon: TrendingDown,
      desc: losingPositions ? `${losingPositions} losing open position(s) remain in the portfolio.` : "No losing open positions detected.",
    },
    {
      name: "Overtrading",
      code: "BM-2",
      value: Math.min(100, todayTrades * 12),
      icon: Repeat,
      desc: todayTrades ? `${todayTrades} trade(s) executed today.` : "No trades executed today.",
    },
    {
      name: "Volatility sensitivity",
      code: "BM-3",
      value: Math.min(100, history.filter((o) => Math.abs(getAsset(o.symbol)?.change ?? 0) > 2).length * 18),
      icon: AlertTriangle,
      desc: "Score rises when trades occur in assets with larger current price moves.",
    },
    {
      name: "Herding",
      code: "BM-4",
      value: Math.min(100, Math.max(0, buyTrades - sellTrades) * 10 + (concentrationPct > 60 ? 20 : 0)),
      icon: Users,
      desc: concentrationPct ? `Largest holding concentration is ${concentrationPct.toFixed(1)}%.` : "No holdings yet.",
    },
  ];

  const recommendations = history.length
    ? [
        todayTrades > 5 ? "Cadence: pause before placing another order today." : "Cadence: current trade frequency is within the session limit.",
        losingPositions ? "Loss discipline: review stop-loss rules for losing positions." : "Loss discipline: no losing open positions need attention.",
        concentrationPct > 60 ? "Diversification: reduce single-position concentration." : "Diversification: current concentration is acceptable.",
      ]
    : ["Start trading: execute at least one order to produce a behavioral profile.", "Review discipline: define position size and stop-loss rules before the first trade."];

  return { biases, recommendations };
}

function classifyOrder(order: ExecutedOrder) {
  const asset = getAsset(order.symbol);
  const change = asset?.change ?? 0;
  if (order.side === "buy" && change > 2) return { label: "Momentum/FOMO", confidence: 0.7 };
  if (order.side === "buy" && change < -2) return { label: "Dip buying", confidence: 0.64 };
  if (order.side === "sell" && change > 0) return { label: "Disposition", confidence: 0.58 };
  return { label: "Neutral", confidence: 0.5 };
}
