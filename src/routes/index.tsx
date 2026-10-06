import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDownRight, ArrowUpRight, Sparkles, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ASSETS, getAsset } from "@/lib/market";
import { portfolioValue, useTradingStore, type ExecutedOrder, type Position } from "@/lib/store";
import { InsightCard } from "@/components/insight-card";
import { useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { formatVnd } from "@/lib/currency";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview - FinSight" },
      {
        name: "description",
        content: "Portfolio overview, market pulse, and behavioral signals at a glance.",
      },
    ],
  }),
  component: Overview,
});

const allocationColors = [
  "var(--color-chart-1)",
  "var(--color-chart-3)",
  "var(--color-chart-2)",
  "var(--color-chart-5)",
  "var(--color-chart-4)",
];

function Overview() {
  const { user } = useAuth();
  const positions = useTradingStore((s) => s.positions);
  const cash = useTradingStore((s) => s.cash);
  const history = useTradingStore((s) => s.history);
  const marketVersion = useTradingStore((s) => s.marketVersion);
  const total = portfolioValue(positions, cash);
  const displayName =
    (user?.user_metadata as any)?.display_name ?? user?.email?.split("@")[0] ?? "Investor";

  const watch = useMemo(
    () =>
      ASSETS.slice(0, 5).map((a) => ({ sym: a.symbol, name: a.name, px: a.price, ch: a.change })),
    [marketVersion],
  );
  const analytics = useMemo(
    () => deriveAnalytics(positions, cash, history),
    [positions, cash, history, marketVersion],
  );
  const marketCtx = useMemo(() => {
    const top = ASSETS.slice(0, 8)
      .map((a) => `${a.symbol} ${a.class} px=${formatVnd(a.price, 2)} chg=${a.change}%`)
      .join("; ");
    const pos = positions
      .map((p) => {
        const a = getAsset(p.symbol);
        return `${p.symbol} qty=${p.qty} avg=${formatVnd(p.avgCost, 2)}${a ? ` last=${formatVnd(a.price, 2)}` : ""}`;
      })
      .join("; ");
    return `Cash ${formatVnd(cash, 2)}. Portfolio ${formatVnd(total, 2)}. Trades ${history.length}.\nHoldings: ${pos || "(none)"}.\nMarket snapshot: ${top}.`;
  }, [positions, cash, total, history.length, marketVersion]);

  return (
    <>
      <PageHeader
        eyebrow="Investment Simulation - Behavioral Analytics"
        title={`Good morning, ${displayName}.`}
        description="Your current simulation state, market pulse, and behavioral signals are summarized from your live portfolio and trade history."
        actions={
          <>
            <Button variant="outline" className="gap-2">
              <Sparkles className="h-4 w-4" /> AI insight
            </Button>
            <Button asChild className="gap-2">
              <Link to="/trading">
                <TrendingUp className="h-4 w-4" /> New trade
              </Link>
            </Button>
          </>
        }
      />
      <PageBody>
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat
            label="Portfolio value"
            value={formatVnd(total, 2)}
            delta={`${positions.length} positions`}
            up
            note="Live mark-to-market"
          />
          <Stat
            label="Cash available"
            value={formatVnd(cash, 2)}
            delta="Buying power"
            note="VND settlement"
          />
          <Stat
            label="Risk-adjusted return"
            value={analytics.sharpe}
            delta="Sharpe"
            note={history.length ? "From executed trades" : "No trades yet"}
          />
          <Stat
            label="Behavioral score"
            value={`${analytics.behaviorScore} / 100`}
            delta={analytics.behaviorLabel}
            note={`${analytics.activeSignals.length} signals`}
            warn={analytics.activeSignals.length > 0}
          />
        </section>

        <InsightCard
          kind="market-today"
          context={marketCtx}
          eyebrow="AI Coach - Today"
          title="Market overview and investment ideas"
          cta="Analyze today's setup"
        />

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-5">
            <header className="flex items-baseline justify-between mb-4">
              <div>
                <div className="small-caps text-[0.65rem] text-muted-foreground">Equity curve</div>
                <h2 className="font-serif text-xl font-semibold">Portfolio - current session</h2>
              </div>
              <Badge variant="secondary" className="font-mono">
                {analytics.returnLabel}
              </Badge>
            </header>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.equityCurve}>
                  <defs>
                    <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="2 4"
                    stroke="var(--color-border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="d"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={70}
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(value) => compactVnd(Number(value))}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    fill="url(#eq)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-5">
            <div className="small-caps text-[0.65rem] text-muted-foreground">Allocation</div>
            <h2 className="font-serif text-xl font-semibold mb-4">Asset mix</h2>
            <div className="space-y-3">
              {analytics.allocation.map((a, i) => (
                <div key={a.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{a.name}</span>
                    <span className="font-mono num">{a.v.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full"
                      style={{
                        width: `${a.v}%`,
                        background: allocationColors[i % allocationColors.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="rule-top mt-5 pt-4 text-xs text-muted-foreground leading-relaxed">
              Diversification index{" "}
              <span className="font-mono text-foreground">
                {analytics.diversification.toFixed(2)}
              </span>{" "}
              from current holdings.
            </div>
          </Card>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-5">
            <header className="flex items-baseline justify-between mb-4">
              <div>
                <div className="small-caps text-[0.65rem] text-muted-foreground">Watchlist</div>
                <h2 className="font-serif text-xl font-semibold">Market pulse</h2>
              </div>
              <span className="text-xs text-muted-foreground">Simulation universe</span>
            </header>
            <div className="divide-y">
              {watch.map((w) => (
                <Link
                  key={w.sym}
                  to="/asset/$symbol"
                  params={{ symbol: w.sym }}
                  className="flex items-center justify-between py-3 hover:bg-muted/30 -mx-2 px-2 rounded transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-md border bg-muted/40 grid place-items-center font-mono text-xs font-semibold">
                      {w.sym.slice(0, 2)}
                    </div>
                    <div>
                      <div className="font-mono text-sm font-semibold">{w.sym}</div>
                      <div className="text-xs text-muted-foreground">{w.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono num text-sm">
                      {formatVnd(w.px, w.px >= 1000 ? 0 : 2)}
                    </div>
                    <div
                      className={`text-xs font-mono num inline-flex items-center gap-0.5 ${w.ch >= 0 ? "text-success" : "text-destructive"}`}
                    >
                      {w.ch >= 0 ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" />
                      )}
                      {w.ch >= 0 ? "+" : ""}
                      {w.ch}%
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="small-caps text-[0.65rem] text-muted-foreground">Behavioral signal</div>
            <h2 className="font-serif text-xl font-semibold">Current cognition</h2>
            {analytics.activeSignals.length ? (
              <ul className="mt-4 space-y-3 text-sm">
                {analytics.activeSignals.map((signal) => (
                  <li key={signal.title} className="flex gap-3">
                    <signal.icon className="h-4 w-4 mt-0.5 text-warning shrink-0" />
                    <div>
                      <div className="font-medium">{signal.title}</div>
                      <div className="text-muted-foreground text-xs leading-relaxed">
                        {signal.desc}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground mt-4">
                No behavioral signal yet. Execute trades to build a decision history.
              </p>
            )}
          </Card>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-5">
            <div className="small-caps text-[0.65rem] text-muted-foreground">Trade frequency</div>
            <h2 className="font-serif text-xl font-semibold mb-4">Activity - last 14 days</h2>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.activity}>
                  <CartesianGrid
                    strokeDasharray="2 4"
                    stroke="var(--color-border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="d"
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="t" fill="var(--color-chart-2)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-5">
            <div className="small-caps text-[0.65rem] text-muted-foreground">Recent executions</div>
            <h2 className="font-serif text-xl font-semibold mb-4">Decision trail</h2>
            {history.length ? (
              <div className="divide-y text-sm">
                {history.slice(0, 5).map((o) => (
                  <div key={o.id} className="py-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-mono font-semibold">
                        {o.side.toUpperCase()} {o.qty} {o.symbol}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(o.ts).toLocaleString("en-US")}
                      </div>
                    </div>
                    <div className="font-mono text-xs text-right">{o.price.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No executions yet.</p>
            )}
          </Card>
        </section>
      </PageBody>
    </>
  );
}

function deriveAnalytics(positions: Position[], cash: number, history: ExecutedOrder[]) {
  const total = portfolioValue(positions, cash);
  const invested = positions.reduce((sum, p) => {
    const asset = getAsset(p.symbol);
    return sum + (asset ? asset.price * p.qty : 0);
  }, 0);
  const allocationMap = new Map<string, number>();
  for (const position of positions) {
    const asset = getAsset(position.symbol);
    if (!asset) continue;
    allocationMap.set(
      asset.class,
      (allocationMap.get(asset.class) ?? 0) + asset.price * position.qty,
    );
  }
  allocationMap.set("Cash", cash);
  const allocation = Array.from(allocationMap.entries()).map(([name, value]) => ({
    name,
    v: total > 0 ? (value / total) * 100 : 0,
  }));
  const diversification =
    allocation.length > 1 ? 1 - allocation.reduce((sum, a) => sum + Math.pow(a.v / 100, 2), 0) : 0;

  const activity = Array.from({ length: 14 }, (_, i) => {
    const day = new Date();
    day.setDate(day.getDate() - (13 - i));
    const key = day.toISOString().slice(0, 10);
    return {
      d: `${day.getMonth() + 1}/${day.getDate()}`,
      t: history.filter((o) => new Date(o.ts).toISOString().slice(0, 10) === key).length,
    };
  });

  const equityCurve = buildEquityCurve(positions, cash, history);

  const returns = positions.map((p) => {
    const asset = getAsset(p.symbol);
    return asset ? (asset.price - p.avgCost) / p.avgCost : 0;
  });
  const avgReturn = returns.length ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
  const variance = returns.length
    ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    : 0;
  const sharpe =
    returns.length && variance > 0 ? (avgReturn / Math.sqrt(variance)).toFixed(2) : "0.00";
  const startingValue = equityCurve[0]?.v ?? total;
  const totalReturn = startingValue > 0 ? ((total - startingValue) / startingValue) * 100 : 0;

  const losingPositions = positions.filter((p) => {
    const asset = getAsset(p.symbol);
    return asset ? asset.price < p.avgCost : false;
  }).length;
  const todayTrades = activity.at(-1)?.t ?? 0;
  const concentrated = allocation.some((a) => a.name !== "Cash" && a.v > 50);
  const activeSignals = [
    ...(losingPositions
      ? [
          {
            title: "Loss aversion watch",
            desc: `${losingPositions} open position(s) are currently below average cost.`,
            icon: Sparkles,
          },
        ]
      : []),
    ...(todayTrades > 5
      ? [
          {
            title: "Overtrading risk",
            desc: `${todayTrades} trades executed today. Consider a pause before the next order.`,
            icon: Sparkles,
          },
        ]
      : []),
    ...(concentrated
      ? [
          {
            title: "Concentration risk",
            desc: "One asset class is above 50% of current portfolio value.",
            icon: Sparkles,
          },
        ]
      : []),
  ];
  const behaviorScore = Math.max(
    0,
    100 - losingPositions * 10 - Math.max(0, todayTrades - 5) * 5 - (concentrated ? 12 : 0),
  );

  return {
    allocation,
    activity,
    behaviorLabel: behaviorScore >= 80 ? "Stable" : behaviorScore >= 60 ? "Watch" : "High risk",
    behaviorScore,
    diversification,
    equityCurve,
    invested,
    returnLabel: `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%`,
    sharpe,
    activeSignals,
  };
}

function buildEquityCurve(positions: Position[], cash: number, history: ExecutedOrder[]) {
  const executedOldestFirst = [...history].reverse();
  if (!executedOldestFirst.length) {
    const currentValue = portfolioValue(positions, cash);
    return [
      { d: "Start", v: +cash.toFixed(2) },
      { d: "Now", v: +currentValue.toFixed(2) },
    ];
  }

  let runningCash = cash - history.reduce((sum, order) => sum + order.total, 0);
  const replayPositions = new Map<string, { qty: number; avgCost: number }>();
  const curve = [{ d: "Start", v: Math.max(0, +runningCash.toFixed(2)) }];

  for (const order of executedOldestFirst) {
    runningCash += order.total;
    const existing = replayPositions.get(order.symbol);

    if (order.side === "buy") {
      const nextQty = (existing?.qty ?? 0) + order.qty;
      const nextAvg =
        existing && nextQty > 0
          ? (existing.avgCost * existing.qty + order.price * order.qty) / nextQty
          : order.price;
      replayPositions.set(order.symbol, { qty: nextQty, avgCost: nextAvg });
    } else if (existing) {
      const nextQty = existing.qty - order.qty;
      if (nextQty > 0) replayPositions.set(order.symbol, { ...existing, qty: nextQty });
      else replayPositions.delete(order.symbol);
    }

    curve.push({
      d: new Date(order.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      v: Math.max(0, +markToMarket(runningCash, replayPositions).toFixed(2)),
    });
  }

  const currentValue = portfolioValue(positions, cash);
  curve.push({ d: "Now", v: +currentValue.toFixed(2) });
  return curve;
}

function markToMarket(cash: number, positions: Map<string, { qty: number; avgCost: number }>) {
  let value = cash;
  for (const [symbol, position] of positions) {
    const asset = getAsset(symbol);
    value += (asset?.price ?? position.avgCost) * position.qty;
  }
  return value;
}

function compactVnd(value: number) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toFixed(0);
}

function Stat({
  label,
  value,
  delta,
  note,
  up,
  warn,
}: {
  label: string;
  value: string;
  delta: string;
  note?: string;
  up?: boolean;
  warn?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="small-caps text-[0.65rem] text-muted-foreground">{label}</div>
      <div className="font-serif text-2xl font-semibold mt-1 num">{value}</div>
      <div className="flex items-center gap-2 mt-2 text-xs">
        <Badge
          variant="secondary"
          className={`font-mono ${up ? "text-success" : warn ? "text-warning" : ""}`}
        >
          {delta}
        </Badge>
        {note && <span className="text-muted-foreground">{note}</span>}
      </div>
    </Card>
  );
}
