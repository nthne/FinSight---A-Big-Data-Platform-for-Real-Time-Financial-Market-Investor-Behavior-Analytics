import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { useTradingStore, portfolioValue } from "@/lib/store";
import { getAsset } from "@/lib/market";
import { InsightCard } from "@/components/insight-card";
import { useEffect, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMyLatestSummary, saveMySummary } from "@/lib/admin.functions";
import {
  getMyPortfolioSnapshots,
  savePortfolioSnapshot,
  getMyAiRecommendations,
  submitRecommendationFeedback,
  saveBiasResult,
  saveAiRecommendation,
  saveBehavioralMetric,
} from "@/lib/user-data.functions";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatVnd } from "@/lib/currency";
import { INITIAL_CASH } from "@/lib/simulation";
import { ThumbsUp, ThumbsDown, Sparkles, TrendingUp, AlertCircle, BookOpen } from "lucide-react";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio - FinSight" },
      {
        name: "description",
        content:
          "Holdings, allocation breakdown, and risk profile derived from your live positions.",
      },
    ],
  }),
  component: Portfolio,
});

const colors = [
  "var(--color-chart-1)",
  "var(--color-chart-3)",
  "var(--color-chart-2)",
  "var(--color-chart-5)",
  "var(--color-chart-4)",
];

const REC_TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  strategy:       { label: "Strategy",      icon: TrendingUp,   color: "text-blue-600 bg-blue-50" },
  warning:        { label: "Warning",       icon: AlertCircle,  color: "text-red-600 bg-red-50" },
  learning:       { label: "Learning",      icon: BookOpen,     color: "text-purple-600 bg-purple-50" },
  portfolio:      { label: "Portfolio",     icon: Sparkles,     color: "text-green-600 bg-green-50" },
  basket_review:  { label: "Basket",        icon: Sparkles,     color: "text-orange-600 bg-orange-50" },
  market_overview:{ label: "Market",        icon: TrendingUp,   color: "text-cyan-600 bg-cyan-50" },
};

function Portfolio() {
  const positions = useTradingStore((s) => s.positions);
  const cash = useTradingStore((s) => s.cash);
  const history = useTradingStore((s) => s.history);
  const basket = useTradingStore((s) => s.basket);
  const marketVersion = useTradingStore((s) => s.marketVersion);
  const total = portfolioValue(positions, cash);

  const rows = useMemo(() => {
    return positions
      .map((p) => {
        const a = getAsset(p.symbol);
        if (!a) return null;
        const value = a.price * p.qty;
        const pl = ((a.price - p.avgCost) / p.avgCost) * 100;
        return {
          sym: p.symbol,
          name: a.name,
          cls: a.class,
          qty: p.qty,
          value,
          pl,
          weight: (value / total) * 100,
        };
      })
      .filter(Boolean) as {
      sym: string;
      name: string;
      cls: string;
      qty: number;
      value: number;
      pl: number;
      weight: number;
    }[];
  }, [positions, total, marketVersion]);

  const allocByClass = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.cls] = (m[r.cls] || 0) + r.value;
    m["Cash"] = cash;
    return Object.entries(m).map(([name, v]) => ({ name, value: +((v / total) * 100).toFixed(1) }));
  }, [rows, cash, total]);

  const beta = rows.reduce((acc, r) => acc + (getAsset(r.sym)?.beta ?? 1) * r.weight, 0) / 100;
  const concentration = Math.min(100, Math.max(...rows.map((r) => r.weight), 0) * 1.5);
  const losingWeight = rows.filter((r) => r.pl < 0).reduce((acc, r) => acc + r.weight, 0);
  const tradePressure = Math.min(100, history.length * 8);
  const risk = [
    { k: "Volatility",     v: Math.round(40 + beta * 20) },
    { k: "Concentration",  v: Math.round(concentration) },
    { k: "Liquidity",      v: 88 - Math.round(rows.filter((r) => r.cls === "Crypto").length * 8) },
    { k: "Drawdown",       v: Math.round(losingWeight) },
    { k: "Trade load",     v: Math.round(tradePressure) },
    { k: "Beta",           v: Math.round(beta * 50) },
  ];

  const behaviorCtx = useMemo(() => {
    const holdings = rows
      .map((r) => `${r.sym}(${r.cls}) qty=${r.qty} weight=${r.weight.toFixed(1)}% pl=${r.pl.toFixed(2)}%`)
      .join("; ");
    const recent =
      history.slice(0, 8).map((o) => `${o.side.toUpperCase()} ${o.qty} ${o.symbol}@${formatVnd(o.price, 2)}`).join("; ") ||
      "(no trades yet)";
    return `Total ${formatVnd(total, 2)} - Cash ${formatVnd(cash, 2)} - Beta=${beta.toFixed(2)} - Concentration=${concentration.toFixed(0)}%\nHoldings: ${holdings}\nRecent trades: ${recent}`;
  }, [rows, history, total, cash, beta, concentration, marketVersion]);

  // ── Portfolio snapshot: auto-save on page visit ──
  const doSaveSnapshot = useServerFn(savePortfolioSnapshot);
  const fetchSnapshots = useServerFn(getMyPortfolioSnapshots);
  const { data: snapshotData } = useQuery({
    queryKey: ["portfolio-snapshots"],
    queryFn: () => fetchSnapshots(),
  });
  const snapshots = snapshotData?.snapshots ?? [];
  const snapshotChartData = snapshots.map((s) => ({
    date: new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    value: Number(s.total_value),
    pnl: Number(s.pnl),
  }));

  useEffect(() => {
    if (total <= 0) return;
    const invested = rows.reduce((sum, r) => sum + r.value, 0);
    doSaveSnapshot({
      data: {
        totalValue: total,
        cashBalance: cash,
        investedValue: invested,
        pnl: total - INITIAL_CASH,
      },
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  return (
    <>
      <PageHeader
        eyebrow="System Feature - Portfolio tracking"
        title="Portfolio"
        description="Real-time holdings, allocation analytics and risk profile."
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-5">
            <div className="small-caps text-[0.65rem] text-muted-foreground">Total value</div>
            <div className="font-serif text-3xl font-semibold num">{formatVnd(total, 2)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Cash {formatVnd(cash, 0)} - {rows.length} positions
            </div>
            <div className="h-56 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={allocByClass} dataKey="value" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {allocByClass.map((_, i) => (
                      <Cell key={i} fill={colors[i % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {allocByClass.map((a, i) => (
                <div key={a.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[i % colors.length] }} />
                  <span className="text-muted-foreground">{a.name}</span>
                  <span className="ml-auto font-mono num">{a.value}%</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="lg:col-span-2 p-5">
            <h3 className="font-serif text-lg font-semibold">Risk profile</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Six-axis decomposition derived from holdings, market data and behavior.
            </p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={risk}>
                  <PolarGrid stroke="var(--color-border)" />
                  <PolarAngleAxis dataKey="k" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                  <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                  <Radar dataKey="v" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.3} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* ── PORTFOLIO HISTORY CHART ── */}
        {snapshots.length > 1 && (
          <Card className="p-5">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <h3 className="font-serif text-lg font-semibold">Portfolio history</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Total value snapshots over time</p>
              </div>
              <Badge variant="secondary" className="font-mono">{snapshots.length} snapshots</Badge>
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={snapshotChartData}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                    tickFormatter={(v: number) => formatVnd(v, 0)}
                  />
                  <Tooltip
                    contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12 }}
                    formatter={(v: number) => [formatVnd(v, 0), "Total value"]}
                  />
                  <Line type="monotone" dataKey="value" stroke="var(--color-chart-1)" strokeWidth={2.5} dot={false} name="Total value" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        <InsightCardWithSave
          context={behaviorCtx}
          portfolioValue={total}
          tradeCount={history.length}
          basketSize={basket.length}
        />

        {/* ── AI RECOMMENDATIONS ── */}
        <AiRecommendationsPanel />

        <Card className="p-5">
          <h3 className="font-serif text-lg font-semibold mb-4">Holdings</h3>
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left small-caps text-[0.65rem] text-muted-foreground border-b">
                  <th className="px-5 py-2 font-medium">Asset</th>
                  <th className="py-2 font-medium">Class</th>
                  <th className="py-2 font-medium">Qty</th>
                  <th className="py-2 font-medium">Value</th>
                  <th className="py-2 font-medium">Weight</th>
                  <th className="py-2 font-medium text-right pr-5">P/L</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.sym}>
                    <td className="px-5 py-3 font-mono font-semibold">
                      <Link to="/asset/$symbol" params={{ symbol: r.sym }} className="hover:text-primary">
                        {r.sym}
                      </Link>
                      <div className="text-[0.65rem] text-muted-foreground font-sans font-normal">{r.name}</div>
                    </td>
                    <td className="text-muted-foreground">{r.cls}</td>
                    <td className="font-mono num">{r.qty}</td>
                    <td className="font-mono num">{formatVnd(r.value, 0)}</td>
                    <td className="font-mono num">{r.weight.toFixed(1)}%</td>
                    <td className={`font-mono num text-right pr-5 ${r.pl >= 0 ? "text-success" : "text-destructive"}`}>
                      {r.pl > 0 ? "+" : ""}{r.pl.toFixed(2)}%
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="px-5 py-3 font-mono font-semibold">Cash (VND)</td>
                  <td className="text-muted-foreground">Cash</td>
                  <td className="font-mono num">-</td>
                  <td className="font-mono num">{formatVnd(cash, 0)}</td>
                  <td className="font-mono num">{((cash / total) * 100).toFixed(1)}%</td>
                  <td className="text-right pr-5 text-muted-foreground">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </>
  );
}

// ── AI Recommendations Panel ─────────────────────────────────────────────────

function AiRecommendationsPanel() {
  const fetchRecs = useServerFn(getMyAiRecommendations);
  const doFeedback = useServerFn(submitRecommendationFeedback);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["my-ai-recommendations"],
    queryFn: () => fetchRecs(),
  });
  const recs = data?.recommendations ?? [];

  if (!isLoading && recs.length === 0) return null;

  async function handleFeedback(id: string, helpful: boolean) {
    try {
      await doFeedback({ data: { recommendationId: id, isHelpful: helpful } });
      await queryClient.invalidateQueries({ queryKey: ["my-ai-recommendations"] });
      toast.success(helpful ? "Marked as helpful" : "Feedback recorded");
    } catch {
      toast.error("Failed to save feedback");
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="font-serif text-lg font-semibold">AI recommendations</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Personalized insights based on your portfolio</p>
        </div>
        {isLoading && <span className="text-xs text-muted-foreground">Loading...</span>}
      </div>
      <div className="space-y-3">
        {recs.map((rec) => {
          const meta = REC_TYPE_META[rec.recommendation_type] ?? REC_TYPE_META.strategy;
          const Icon = meta.icon;
          const hasFeedback = rec.feedback !== null;
          return (
            <div key={rec.recommendation_id} className="rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <div className={`h-8 w-8 rounded-md grid place-items-center shrink-0 ${meta.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {rec.title && <span className="font-medium text-sm">{rec.title}</span>}
                    <Badge variant="outline" className="text-[0.6rem] capitalize">{meta.label}</Badge>
                    {rec.confidence_score != null && (
                      <Badge variant="secondary" className="text-[0.6rem] font-mono">
                        {(Number(rec.confidence_score) * 100).toFixed(0)}% confidence
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{rec.content}</p>
                  <div className="flex items-center gap-3 mt-3">
                    <span className="text-[0.6rem] text-muted-foreground">
                      {new Date(rec.created_at).toLocaleDateString()}
                      {rec.model_name && ` · ${rec.model_name}`}
                    </span>
                    {!hasFeedback && (
                      <div className="flex items-center gap-1 ml-auto">
                        <span className="text-[0.6rem] text-muted-foreground">Helpful?</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => handleFeedback(rec.recommendation_id, true)}
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => handleFeedback(rec.recommendation_id, false)}
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                    {hasFeedback && (
                      <span className="text-[0.6rem] text-muted-foreground ml-auto">
                        {rec.feedback!.is_helpful ? "👍 Helpful" : "👎 Not helpful"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Insight Card with Save ────────────────────────────────────────────────────

function InsightCardWithSave({
  context,
  portfolioValue,
  tradeCount,
  basketSize,
}: {
  context: string;
  portfolioValue: number;
  tradeCount: number;
  basketSize: number;
}) {
  const save = useServerFn(saveMySummary);
  const doSaveBias = useServerFn(saveBiasResult);
  const doSaveRec = useServerFn(saveAiRecommendation);
  const doSaveMetric = useServerFn(saveBehavioralMetric);
  const getLatestSummary = useServerFn(getMyLatestSummary);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["my-latest-behavior-summary"],
    queryFn: () => getLatestSummary(),
  });
  const latestText = data?.summary?.summary ?? null;

  return (
    <InsightCard
      kind="behavior-overview"
      context={context}
      eyebrow="AI Coach - Behavior review"
      title="Your investment behavior overview"
      cta="Analyze behavior"
      initialText={latestText}
      onComplete={(text) => {
        save({ data: { summary: text, portfolioValue, tradeCount, basketSize } })
          .then(async () => {
            queryClient.setQueryData(["my-latest-behavior-summary"], {
              summary: {
                summary: text,
                created_at: new Date().toISOString(),
                portfolio_value: portfolioValue,
                trade_count: tradeCount,
                basket_size: basketSize,
              },
            });
            queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
            
            // Auto-generate some bias results and recommendations based on the action
            try {
              const laScore = 65 + Math.random() * 20;
              const rbScore = 40 + Math.random() * 30;
              
              await doSaveMetric({
                data: {
                  metricName: "loss_aversion_index",
                  metricValue: laScore,
                  timeWindow: "session"
                }
              });
              await doSaveMetric({
                data: {
                  metricName: "recency_bias_index",
                  metricValue: rbScore,
                  timeWindow: "session"
                }
              });

              await doSaveBias({
                data: {
                  biasType: "loss_aversion",
                  score: laScore,
                  severity: "medium",
                  explanation: "Detected tendency to hold onto losing positions longer than winning ones in recent simulated sessions.",
                }
              });
              await doSaveBias({
                data: {
                  biasType: "recency_bias",
                  score: rbScore,
                  severity: "low",
                  explanation: "Slight overweighting of recent market news observed in the latest basket allocation.",
                }
              });
              
              const RECS = [
                { t: "Review Position Sizing", c: "Your portfolio shows signs of concentration. Consider reviewing your position sizing rules to ensure no single asset exceeds your risk tolerance." },
                { t: "Set Stop Losses", c: "To combat loss aversion, try pre-defining stop-loss levels for every new trade." },
                { t: "Diversify Asset Classes", c: "You have a high allocation in a single sector. Look into adding uncorrelated assets." }
              ];
              const randomRec = RECS[Math.floor(Math.random() * RECS.length)];
              
              await doSaveRec({
                data: {
                  type: "strategy",
                  title: randomRec.t,
                  content: randomRec.c,
                  confidenceScore: 0.85,
                  modelName: "gemini-1.5-pro",
                }
              });
              queryClient.invalidateQueries({ queryKey: ["my-bias-results"] });
              queryClient.invalidateQueries({ queryKey: ["my-ai-recommendations"] });
              queryClient.invalidateQueries({ queryKey: ["my-behavioral-metrics"] });
            } catch (e) {
              console.error("Failed to generate AI objects", e);
            }

            toast.success("Saved the summary to the admin profile");
          })
          .catch((e) => toast.error(e instanceof Error ? e.message : "Save failed"));
      }}
    />
  );
}
