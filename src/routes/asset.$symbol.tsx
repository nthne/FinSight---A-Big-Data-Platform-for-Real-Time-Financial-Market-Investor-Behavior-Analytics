import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowUpRight, ArrowDownRight, ArrowLeft, Plus, Newspaper, BookOpen, BarChart2 } from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Bar,
  ComposedChart,
} from "recharts";
import { getAsset, priceHistory, ASSETS } from "@/lib/market";
import type { MarketHistoryPoint } from "@/lib/market";
import { loadMarketPriceHistory } from "@/lib/market-sync";
import { useTradingStore } from "@/lib/store";
import { DISPLAY_CURRENCY, formatVnd } from "@/lib/currency";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getTechnicalIndicators } from "@/lib/user-data.functions";

export const Route = createFileRoute("/asset/$symbol")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.symbol.toUpperCase()} - FinSight` },
      {
        name: "description",
        content: `Market data, fundamentals and behavioral insight for ${params.symbol.toUpperCase()}.`,
      },
    ],
  }),
  component: AssetDetail,
  notFoundComponent: () => (
    <PageBody>
      <Card className="p-8 text-center">
        <h2 className="font-serif text-2xl">Asset not found</h2>
        <Link to="/trading" className="text-primary text-sm mt-3 inline-block">
          Back to trading
        </Link>
      </Card>
    </PageBody>
  ),
});

function AssetDetail() {
  const { symbol } = Route.useParams();
  const asset = getAsset(symbol);
  const navigate = useNavigate();
  const addToBasket = useTradingStore((s) => s.addToBasket);
  const positions = useTradingStore((s) => s.positions);
  const marketVersion = useTradingStore((s) => s.marketVersion);
  const [qty, setQty] = useState(10);
  const [history, setHistory] = useState<MarketHistoryPoint[]>([]);
  const assetSymbol = asset?.symbol;
  const assetClass = asset?.class;

  const data = history;
  const peers = useMemo(() => {
    void marketVersion;
    return assetSymbol && assetClass
      ? ASSETS.filter((a) => a.symbol !== assetSymbol && a.class === assetClass).slice(0, 4)
      : [];
  }, [assetClass, assetSymbol, marketVersion]);

  useEffect(() => {
    let cancelled = false;
    if (!assetSymbol) {
      setHistory([]);
      return;
    }
    loadMarketPriceHistory(assetSymbol)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((error) => {
        console.error("[Market history] Could not load price history", error);
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [assetSymbol, marketVersion]);

  if (!asset) {
    return (
      <PageBody>
        <Card className="p-8 text-center">
          <h2 className="font-serif text-2xl">Symbol "{symbol}" not found</h2>
          <Link to="/trading" className="text-primary text-sm mt-3 inline-block">
            Back to trading
          </Link>
        </Card>
      </PageBody>
    );
  }

  const pos = positions.find((p) => p.symbol === asset.symbol);

  function add(side: "buy" | "sell") {
    if (qty <= 0) return toast.error("Quantity must be greater than zero");
    addToBasket({ symbol: asset!.symbol, side, qty, type: "Market" });
    toast.success(`Added ${side} ${qty} ${asset!.symbol} to basket`);
  }

  return (
    <>
      <PageHeader
        eyebrow={`${asset.class} - ${asset.exchange}`}
        title={`${asset.symbol} - ${asset.name}`}
        description={asset.sector}
        actions={
          <Button variant="outline" asChild className="gap-2">
            <Link to="/trading">
              <ArrowLeft className="h-4 w-4" /> Trading desk
            </Link>
          </Button>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-6 min-w-0">
            <Card className="p-5">
              <div className="flex flex-wrap items-baseline gap-3 mb-4">
                <span className="font-mono num text-4xl font-semibold">
                  {formatVnd(asset.price, asset.price >= 1000 ? 0 : 2)}
                </span>
                <span
                  className={`text-sm font-mono inline-flex items-center ${asset.change >= 0 ? "text-success" : "text-destructive"}`}
                >
                  {asset.change >= 0 ? (
                    <ArrowUpRight className="h-4 w-4" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4" />
                  )}
                  {asset.change >= 0 ? "+" : ""}
                  {asset.change}%
                </span>
                <span className="text-xs text-muted-foreground">{DISPLAY_CURRENCY}</span>
              </div>
              <div className="h-72 -ml-5">
                {data.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data}>
                      <defs>
                        <linearGradient id="ad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="2 4"
                        stroke="var(--color-border)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="t"
                        tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="p"
                        tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                        axisLine={false}
                        tickLine={false}
                        width={60}
                        domain={["auto", "auto"]}
                      />
                      <YAxis
                        yAxisId="v"
                        orientation="right"
                        tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                        axisLine={false}
                        tickLine={false}
                        width={30}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      />
                      <Bar yAxisId="v" dataKey="v" fill="var(--color-muted)" />
                      <Area
                        yAxisId="p"
                        type="monotone"
                        dataKey="p"
                        stroke="var(--color-chart-1)"
                        strokeWidth={2}
                        fill="url(#ad)"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full ml-5 text-sm text-muted-foreground bg-muted/20 border border-dashed rounded-md">
                    No historical price data available.
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t text-sm">
                <Stat k="52w high" v={asset.high52w?.toLocaleString("en-US") ?? "N/A"} />
                <Stat k="52w low" v={asset.low52w?.toLocaleString("en-US") ?? "N/A"} />
                <Stat k="Volume" v={asset.volume ?? "N/A"} />
                <Stat k="Beta" v={asset.beta?.toString() ?? "N/A"} />
              </div>
            </Card>

            <Card className="p-5">
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="fundamentals">Fundamentals</TabsTrigger>
                  <TabsTrigger value="news">News</TabsTrigger>
                  <TabsTrigger value="behavioral">Behavioral</TabsTrigger>
                  <TabsTrigger value="indicators" className="gap-1.5">
                    <BarChart2 className="h-3.5 w-3.5" /> Indicators
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="pt-4 space-y-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {asset.description}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <Stat k="Market cap" v={asset.marketCap ?? "N/A"} />
                    <Stat k="P/E (TTM)" v={asset.peRatio?.toFixed(1) ?? "N/A"} />
                    <Stat
                      k="Dividend"
                      v={asset.dividendYield != null ? `${asset.dividendYield}%` : "N/A"}
                    />
                    <Stat k="Class" v={asset.class} />
                  </div>
                </TabsContent>
                <TabsContent value="fundamentals" className="pt-4">
                  {asset.fundamentals?.length ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                      {asset.fundamentals.map((f) => (
                        <div key={f.label} className="flex justify-between border-b py-2 text-sm">
                          <span className="text-muted-foreground">{f.label}</span>
                          <span className="font-mono num">{f.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No fundamental data for this asset class.
                    </p>
                  )}
                </TabsContent>
                <TabsContent value="news" className="pt-4">
                  {asset.news?.length ? (
                    <ul className="divide-y">
                      {asset.news.map((n) => (
                        <li key={n.title} className="flex gap-4 py-3">
                          <Newspaper className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <div className="text-sm font-medium">{n.title}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {n.source} - {n.date}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No recent news.</p>
                  )}
                </TabsContent>
                <TabsContent value="behavioral" className="pt-4 space-y-4 text-sm">
                  <div className="rounded border bg-warning/5 p-4">
                    <div className="flex items-center gap-2 font-medium">
                      <BookOpen className="h-4 w-4 text-warning" />
                      Decision context
                    </div>
                    <p className="text-muted-foreground text-xs mt-1.5 leading-relaxed">
                      Before placing an order on {asset.symbol}, consider:
                    </p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-xs text-muted-foreground">
                      <li>Have you checked the position size against your risk budget?</li>
                      <li>Is this trade driven by news (recency bias) or your strategy?</li>
                      <li>
                        What is your exit plan if the price moves -
                        {asset.beta && asset.beta > 1.5 ? "5" : "2"}% against you?
                      </li>
                    </ul>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Stat
                      k="Realised vol (30d)"
                      v={`${(20 + (asset.beta ?? 1) * 8).toFixed(1)}%`}
                    />
                    <Stat
                      k="Avg holding (peers)"
                      v={asset.class === "Crypto" ? "5.4 days" : "23 days"}
                    />
                  </div>
                </TabsContent>

                {/* ── TECHNICAL INDICATORS TAB ── */}
                <TabsContent value="indicators" className="pt-4">
                  <TechnicalIndicatorsTab symbol={asset.symbol} />
                </TabsContent>
              </Tabs>
            </Card>

            <Card className="p-5">
              <h3 className="font-serif text-lg font-semibold mb-3">Peer comparison</h3>
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left small-caps text-[0.65rem] text-muted-foreground border-b">
                      <th className="px-5 py-2 font-medium">Symbol</th>
                      <th className="py-2 font-medium">Name</th>
                      <th className="py-2 font-medium">Price</th>
                      <th className="py-2 font-medium text-right pr-5">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {peers.map((p) => (
                      <tr
                        key={p.symbol}
                        className="hover:bg-muted/40 cursor-pointer"
                        onClick={() =>
                          navigate({ to: "/asset/$symbol", params: { symbol: p.symbol } })
                        }
                      >
                        <td className="px-5 py-3 font-mono font-semibold text-primary">
                          {p.symbol}
                        </td>
                        <td className="text-muted-foreground">{p.name}</td>
                        <td className="font-mono num">
                          {formatVnd(p.price, p.price >= 1000 ? 0 : 2)}
                        </td>
                        <td
                          className={`font-mono num text-right pr-5 ${p.change >= 0 ? "text-success" : "text-destructive"}`}
                        >
                          {p.change >= 0 ? "+" : ""}
                          {p.change}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-5">
              <h3 className="font-serif text-lg font-semibold mb-3">Quick add to basket</h3>
              <div className="space-y-3">
                <div>
                  <label className="small-caps text-[0.65rem] text-muted-foreground">
                    Quantity
                  </label>
                  <Input
                    type="number"
                    value={qty}
                    min={1}
                    onChange={(e) => setQty(Math.max(0, +e.target.value))}
                    className="font-mono"
                  />
                </div>
                <div className="text-sm space-y-1.5 pt-2 border-t">
                  <Row k="Estimated" v={formatVnd(asset.price * qty, 2)} />
                  <Row k="You hold" v={pos ? `${pos.qty} @ ${formatVnd(pos.avgCost, 2)}` : "N/A"} />
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button
                    onClick={() => add("buy")}
                    className="bg-success hover:bg-success/90 text-success-foreground gap-1"
                  >
                    <Plus className="h-4 w-4" /> Buy
                  </Button>
                  <Button onClick={() => add("sell")} variant="destructive" className="gap-1">
                    <Plus className="h-4 w-4" /> Sell
                  </Button>
                </div>
                <Button variant="outline" asChild className="w-full mt-2">
                  <Link to="/trading">Review basket</Link>
                </Button>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-serif text-base font-semibold mb-2">Quote</h3>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Bid</span>
                <span className="font-mono num">{formatVnd(asset.price - 0.04, 2)}</span>
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Ask</span>
                <span className="font-mono num">{formatVnd(asset.price + 0.04, 2)}</span>
              </div>
              <div className="flex items-baseline justify-between text-sm pt-2 border-t mt-2">
                <span className="text-muted-foreground">Spread</span>
                <Badge variant="secondary" className="font-mono">
                  {formatVnd(0.08, 2)}
                </Badge>
              </div>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="small-caps text-[0.6rem] text-muted-foreground">{k}</div>
      <div className="font-mono num">{v}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{k}</span>
      <span className="font-mono text-foreground">{v}</span>
    </div>
  );
}

// ── Technical Indicators Tab ─────────────────────────────────────────────────

const INDICATOR_COLORS: Record<string, string> = {
  RSI:  "text-purple-600 bg-purple-50",
  MACD: "text-blue-600 bg-blue-50",
  SMA:  "text-green-600 bg-green-50",
  EMA:  "text-teal-600 bg-teal-50",
  BB:   "text-orange-600 bg-orange-50",
};

function TechnicalIndicatorsTab({ symbol }: { symbol: string }) {
  const fetchIndicators = useServerFn(getTechnicalIndicators);
  const { data, isLoading } = useQuery({
    queryKey: ["technical-indicators", symbol],
    queryFn: () => fetchIndicators({ data: { symbol } }),
    staleTime: 5 * 60 * 1000,
  });
  const indicators = data?.indicators ?? [];

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-4">Loading indicators...</p>;
  }

  if (indicators.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <BarChart2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm font-medium">No indicators computed yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Technical indicators (RSI, MACD, SMA, etc.) will appear here once the analysis pipeline processes {symbol}.
        </p>
      </div>
    );
  }

  // Group by indicator name, take latest per name+period
  const grouped = new Map<string, typeof indicators[0][]>();
  for (const ind of indicators) {
    const key = ind.indicator_name;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ind);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[...grouped.entries()].map(([name, rows]) => {
          const latest = rows[0];
          const colorClass = INDICATOR_COLORS[name] ?? "text-gray-600 bg-gray-50";
          const value = Number(latest.indicator_value);
          return (
            <div key={name} className="rounded-lg border p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Badge className={`text-[0.6rem] border-0 ${colorClass}`}>{name}</Badge>
                  {latest.period && (
                    <span className="text-[0.6rem] text-muted-foreground">period {latest.period}</span>
                  )}
                </div>
                <span className="font-mono num text-sm font-semibold">
                  {value >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value.toFixed(4)}
                </span>
              </div>
              {name === "RSI" && (
                <div className="mt-1">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${value > 70 ? "bg-red-500" : value < 30 ? "bg-green-500" : "bg-blue-400"}`}
                      style={{ width: `${Math.min(100, value)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[0.6rem] text-muted-foreground mt-0.5">
                    <span>Oversold (30)</span>
                    <span className={value > 70 ? "text-red-500" : value < 30 ? "text-green-500" : ""}>
                      {value > 70 ? "Overbought" : value < 30 ? "Oversold" : "Neutral"}
                    </span>
                    <span>Overbought (70)</span>
                  </div>
                </div>
              )}
              <div className="text-[0.6rem] text-muted-foreground mt-2">
                {new Date(latest.timestamp).toLocaleDateString()} · {latest.source}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[0.65rem] text-muted-foreground">
        Showing {indicators.length} indicator data points for {symbol}.
      </p>
    </div>
  );
}
