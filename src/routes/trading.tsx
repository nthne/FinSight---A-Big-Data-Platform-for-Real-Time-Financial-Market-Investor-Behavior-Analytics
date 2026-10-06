import { createFileRoute, Link } from "@tanstack/react-router";
import { PageBody, PageHeader } from "@/components/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import {
  getAsset,
  getRealtimeAssets,
  getTimeframeChange,
  priceHistory,
  type Asset,
  type Timeframe,
} from "@/lib/market";
import { saveTradingSnapshot } from "@/lib/trading-sync";
import { loadMarketPriceHistory } from "@/lib/market-sync";
import { useTradingStore, type OrderType, type Side } from "@/lib/store";
import { formatVnd } from "@/lib/currency";
import { logUserAction } from "@/lib/user-data.functions";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  LineChart,
  Plus,
  Search,
  ShoppingBasket,
  Trash2,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/trading")({
  head: () => ({
    meta: [
      { title: "Trading - FinSight" },
      {
        name: "description",
        content:
          "Sector-based market board with real-time simulation orders and behavioral feedback.",
      },
    ],
  }),
  component: Trading,
});

const SECTOR_ORDER = [
  "All",
  "Banking",
  "Technology",
  "Consumer Discretionary",
  "Consumer Staples",
  "Real Estate",
  "Materials",
  "Energy",
  "ETF",
  "Crypto",
];

const TIMEFRAME_OPTIONS: Array<{ value: Timeframe; label: string }> = [
  { value: "1D", label: "1D" },
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "1Y", label: "1Y" },
];

function Trading() {
  const { user } = useAuth();
  const doLogAction = useServerFn(logUserAction);
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("Banking");
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [side, setSide] = useState<Side>("buy");
  const [type, setType] = useState<OrderType>("Market");
  const [qty, setQty] = useState<number>(100);
  const [selected, setSelected] = useState("VCB");
  const {
    basket,
    positions,
    cash,
    feeRate,
    addToBasket,
    updateBasket,
    removeFromBasket,
    clearBasket,
    executeBasket,
    history,
  } = useTradingStore();
  const marketVersion = useTradingStore((s) => s.marketVersion);

  const realtimeAssets = useMemo(() => {
    void marketVersion;
    return getRealtimeAssets();
  }, [marketVersion]);

  const sectors = useMemo(() => {
    void marketVersion;
    const available = new Set(realtimeAssets.map((asset) => asset.sector ?? asset.class));
    return SECTOR_ORDER.filter((item) => item === "All" || available.has(item));
  }, [realtimeAssets, marketVersion]);

  const visibleAssets = useMemo(() => {
    void marketVersion;
    const needle = query.trim().toLowerCase();
    return realtimeAssets
      .filter((asset) => {
        const assetSector = asset.sector ?? asset.class;
        const inSector = sector === "All" || assetSector === sector;
        const matches =
          !needle ||
          asset.symbol.toLowerCase().includes(needle) ||
          asset.name.toLowerCase().includes(needle) ||
          assetSector.toLowerCase().includes(needle);
        return inSector && matches;
      })
      .sort(
        (a, b) =>
          Math.abs(getTimeframeChange(b, timeframe)) - Math.abs(getTimeframeChange(a, timeframe)),
      );
  }, [query, sector, timeframe, realtimeAssets, marketVersion]);

  const current = useMemo(() => {
    void marketVersion;
    return getAsset(selected) ?? visibleAssets[0] ?? realtimeAssets[0];
  }, [selected, visibleAssets, realtimeAssets, marketVersion]);
  const topGainers = useMemo(() => {
    void marketVersion;
    return [...realtimeAssets]
      .filter((a) => getTimeframeChange(a, timeframe) > 0)
      .sort((a, b) => getTimeframeChange(b, timeframe) - getTimeframeChange(a, timeframe))
      .slice(0, 7);
  }, [realtimeAssets, timeframe, marketVersion]);
  const topLosers = useMemo(() => {
    void marketVersion;
    return [...realtimeAssets]
      .filter((a) => getTimeframeChange(a, timeframe) < 0)
      .sort((a, b) => getTimeframeChange(a, timeframe) - getTimeframeChange(b, timeframe))
      .slice(0, 5);
  }, [realtimeAssets, timeframe, marketVersion]);

  const topPositions = useMemo(() => {
    void marketVersion;
    if (positions.length === 0) {
      return [
        { symbol: "VN30", label: "VN30" },
        { symbol: "VNINDEX", label: "VNINDEX" },
        { symbol: "NASDAQ", label: "NASDAQ" },
        { symbol: "BTC", label: "BTC" },
      ];
    }
    const withValue = positions.map((p) => {
      const asset = getAsset(p.symbol);
      const price = asset?.price ?? p.avgCost;
      return { symbol: p.symbol, label: p.symbol, value: p.qty * price };
    });
    withValue.sort((a, b) => b.value - a.value);
    const top4 = withValue.slice(0, 4);
    // Pad with defaults if less than 4
    const defaults = ["VN30", "VNINDEX", "NASDAQ", "BTC"].filter(
      (s) => !top4.find((p) => p.symbol === s)
    );
    while (top4.length < 4 && defaults.length > 0) {
      const sym = defaults.shift()!;
      top4.push({ symbol: sym, label: sym, value: 0 });
    }
    return top4.map((p) => ({ symbol: p.symbol, label: p.label }));
  }, [positions, marketVersion]);

  const totals = useMemo(() => {
    void marketVersion;
    let buy = 0;
    let sell = 0;
    let fee = 0;
    for (const line of basket) {
      const asset = getAsset(line.symbol);
      if (!asset) continue;
      const price = line.type === "Limit" && line.limitPrice ? line.limitPrice : asset.price;
      const notional = price * line.qty;
      fee += notional * feeRate;
      if (line.side === "buy") buy += notional;
      else sell += notional;
    }
    return { buy, sell, fee, net: buy - sell + fee };
  }, [basket, feeRate, marketVersion]);

  function handleAdd(asset = current) {
    if (!asset) return;
    if (qty <= 0) return toast.error("Quantity must be greater than zero");
    addToBasket({ symbol: asset.symbol, side, qty, type });
    setSelected(asset.symbol);
    toast.success(`Added ${side} ${qty} ${asset.symbol}`);
  }

  async function handleExecute() {
    const result = executeBasket();
    if (!result.ok) return toast.error(result.reason || "Could not execute basket");
    if (user?.id) {
      try {
        const state = useTradingStore.getState();
        await saveTradingSnapshot(
          user.id,
          {
            cash: state.cash,
            feeRate: state.feeRate,
            positions: state.positions,
            history: state.history,
          },
          result.orders ?? [],
        );
        // Log action
        const symbols = [...new Set((result.orders ?? []).map((o) => o.symbol))];
        doLogAction({
          data: {
            actionType: "trade_executed",
            metadata: {
              orderCount: result.orders?.length ?? 0,
              symbols,
            },
          },
        }).catch(() => { });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save trades");
      }
    }
    toast.success(`Executed ${result.orders?.length ?? 0} orders`);
  }

  return (
    <>
      <PageHeader
        eyebrow="Market board"
        title="Trading"
        description="Track stocks by sector, compare top gainers/losers, and place simulated orders all on one screen."
        actions={
          <Badge variant="secondary" className="font-mono">
            Cash {formatVnd(cash, 2)}
          </Badge>
        }
      />
      <PageBody>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            {topPositions.map(({ symbol, label }) => (
              <MarketTile
                key={symbol}
                asset={getAsset(symbol)}
                label={label}
                timeframe={timeframe}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
            <Card className="overflow-hidden border-blue-100">
              <div className="border-b bg-white px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-2 overflow-x-auto">
                    {sectors.map((item) => (
                      <button
                        key={item}
                        onClick={() => setSector(item)}
                        className={`h-9 whitespace-nowrap rounded-md px-3 text-sm font-medium transition ${sector === item
                            ? "bg-blue-600 text-white"
                            : "bg-blue-50 text-blue-800 hover:bg-blue-100"
                          }`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <div className="w-full lg:w-auto">
                    <div className="relative w-full lg:w-80">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400" />
                      <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search symbol, company, sector..."
                        className="h-10 border-blue-100 bg-blue-50/70 pl-9"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
                  <thead className="bg-blue-50 text-xs text-blue-900">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Symbol</th>
                      <th className="px-4 py-3 text-right font-semibold">Last Price</th>
                      <th className="px-4 py-2 text-right font-semibold">
                        <div className="flex justify-end">
                          <Select
                            value={timeframe}
                            onValueChange={(value) => setTimeframe(value as Timeframe)}
                          >
                            <SelectTrigger className="h-9 w-28 border-blue-200 bg-white text-xs font-semibold text-blue-900">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TIMEFRAME_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label} Change
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </th>
                      <th className="px-4 py-3 text-right font-semibold">Volume</th>
                      <th className="px-4 py-3 text-center font-semibold">Chart</th>
                      <th className="px-4 py-3 text-center font-semibold">Buy/Sell</th>
                      <th className="px-4 py-3 text-right font-semibold">Order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-50">
                    {visibleAssets.map((asset) => (
                      <AssetRow
                        key={asset.symbol}
                        asset={asset}
                        timeframe={timeframe}
                        active={current?.symbol === asset.symbol}
                        onSelect={() => setSelected(asset.symbol)}
                        onBuy={() => {
                          setSide("buy");
                          handleAdd(asset);
                        }}
                        onSell={() => {
                          setSide("sell");
                          handleAdd(asset);
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <aside className="space-y-4">
              <Card className="p-4 border-blue-100">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-blue-950">Quick Order</div>
                    <p className="text-xs text-muted-foreground">
                      {current?.symbol} - {current?.name}
                    </p>
                  </div>
                  <Logo asset={current} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Select value={side} onValueChange={(value) => setSide(value as Side)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="buy">Buy</SelectItem>
                      <SelectItem value="sell">Sell</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={type} onValueChange={(value) => setType(value as OrderType)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Market">Market</SelectItem>
                      <SelectItem value="Limit">Limit</SelectItem>
                      <SelectItem value="Stop">Stop</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(event) => setQty(Math.max(0, +event.target.value))}
                    className="h-9 font-mono"
                  />
                </div>
                <Button
                  onClick={() => handleAdd()}
                  className="mt-3 w-full gap-2 bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" /> Add to basket
                </Button>
              </Card>

              <WatchList
                title="Top Gainers"
                icon={<ArrowUpRight className="h-4 w-4 text-emerald-600" />}
                assets={topGainers}
                timeframe={timeframe}
              />
              <WatchList
                title="Top Losers"
                icon={<ArrowDownRight className="h-4 w-4 text-red-600" />}
                assets={topLosers}
                timeframe={timeframe}
              />
              <BasketCard
                basket={basket}
                totals={totals}
                updateBasket={updateBasket}
                removeFromBasket={removeFromBasket}
                clearBasket={clearBasket}
                execute={handleExecute}
              />
            </aside>
          </div>

          {history.length > 0 && (
            <Card className="p-4 border-blue-100">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-950">
                <LineChart className="h-4 w-4" /> Recent executions
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {history.slice(0, 6).map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between rounded-md bg-blue-50 px-3 py-2 text-sm"
                  >
                    <span className={order.side === "buy" ? "text-emerald-700" : "text-red-700"}>
                      {order.side.toUpperCase()}
                    </span>
                    <span className="font-mono font-semibold">{order.symbol}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {order.qty} @ {order.price.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </PageBody>
    </>
  );
}

function MarketTile({
  asset,
  label,
  timeframe,
}: {
  asset?: Asset;
  label: string;
  timeframe: Timeframe;
}) {
  const changeValue = getTimeframeChange(asset, timeframe);
  const positive = changeValue >= 0;
  const value = asset ? formatPrice(asset) : "N/A";
  const sub = asset ? `${asset.exchange} - ${asset.sector ?? asset.class}` : "Realtime quote";
  return (
    <Card className="overflow-hidden border-blue-100 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-blue-900">{label}</div>
          <div
            className={
              positive
                ? "mt-1 font-mono text-xl font-bold text-emerald-600"
                : "mt-1 font-mono text-xl font-bold text-red-600"
            }
          >
            {value}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
        </div>
        <div
          className={
            positive ? "font-mono text-sm text-emerald-600" : "font-mono text-sm text-red-600"
          }
        >
          {changeValue >= 0 ? "+" : ""}
          {changeValue.toFixed(2)}%
        </div>
      </div>
      <MiniChart symbol={asset?.symbol ?? label} positive={positive} />
    </Card>
  );
}

function AssetRow({
  asset,
  timeframe,
  active,
  onSelect,
  onBuy,
  onSell,
}: {
  asset: Asset;
  timeframe: Timeframe;
  active: boolean;
  onSelect: () => void;
  onBuy: () => void;
  onSell: () => void;
}) {
  const changeValue = getTimeframeChange(asset, timeframe);
  const positive = changeValue >= 0;
  const buyPct = Math.min(94, Math.max(8, 50 + changeValue * 7));
  const sellPct = 100 - buyPct;
  return (
    <tr className={active ? "bg-blue-50/80" : "bg-white hover:bg-blue-50/50"}>
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-3 text-left">
          <button onClick={onSelect} className="shrink-0 hover:opacity-80">
            <Logo asset={asset} />
          </button>
          <span className="min-w-0">
            <Link to="/asset/$symbol" params={{ symbol: asset.symbol }} className="group">
              <span className="block font-mono font-bold text-blue-950 group-hover:text-primary group-hover:underline">{asset.symbol}</span>
              <span className="block max-w-[240px] truncate text-xs text-muted-foreground group-hover:text-primary">
                {asset.name}
              </span>
            </Link>
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-right font-mono font-semibold">{formatPrice(asset)}</td>
      <td
        className={
          positive
            ? "px-4 py-3 text-right font-mono text-emerald-600"
            : "px-4 py-3 text-right font-mono text-red-600"
        }
      >
        {positive ? "+" : ""}
        {changeValue.toFixed(2)}%
      </td>
      <td className="px-4 py-3 text-right font-mono text-slate-600">{asset.volume ?? "--"}</td>
      <td className="px-4 py-3">
        <MiniChart symbol={asset.symbol} positive={positive} />
      </td>
      <td className="px-4 py-3">
        <div className="mx-auto w-32">
          <div className="flex justify-between text-[0.65rem]">
            <span className="text-emerald-600">{buyPct.toFixed(0)}%</span>
            <span className="text-red-600">{sellPct.toFixed(0)}%</span>
          </div>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded bg-red-100">
            <div className="bg-emerald-500" style={{ width: `${buyPct}%` }} />
            <div className="bg-red-500" style={{ width: `${sellPct}%` }} />
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={onBuy}
            className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          >
            Buy
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onSell}
            className="h-8 border-red-200 text-red-700 hover:bg-red-50"
          >
            Sell
          </Button>
          <Button size="icon" variant="ghost" asChild className="h-8 w-8">
            <Link to="/asset/$symbol" params={{ symbol: asset.symbol }}>
              <Bell className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </td>
    </tr>
  );
}

function Logo({ asset }: { asset?: Asset }) {
  const [failed, setFailed] = useState(false);
  const initials = asset?.symbol.slice(0, 3) ?? "?";
  if (!asset?.logoUrl || failed) {
    return (
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
        {initials}
      </span>
    );
  }
  return (
    <img
      src={asset.logoUrl}
      alt={`${asset.symbol} logo`}
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded-full border border-blue-100 bg-white object-contain p-1"
    />
  );
}

function MiniChart({ symbol, positive }: { symbol: string; positive: boolean }) {
  const [points, setPoints] = useState<{ p: number }[]>([]);

  useEffect(() => {
    let active = true;
    loadMarketPriceHistory(symbol, 30).then((data) => {
      if (active) setPoints(data);
    }).catch(() => {
      if (active) setPoints([]);
    });
    return () => { active = false; };
  }, [symbol]);

  if (!points.length) {
    return <svg viewBox="0 0 120 38" className="h-10 w-32" />;
  }
  const prices = points.map((point) => point.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * 120;
      const y = 34 - ((point.p - min) / Math.max(1, max - min)) * 28;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 120 38" className="h-10 w-32">
      <path d={path} fill="none" stroke={positive ? "#059669" : "#dc2626"} strokeWidth="2" />
    </svg>
  );
}

function WatchList({
  title,
  icon,
  assets,
  timeframe,
}: {
  title: string;
  icon: React.ReactNode;
  assets: Asset[];
  timeframe: Timeframe;
}) {
  return (
    <Card className="p-4 border-blue-100">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-950">
        {icon}
        {title}
      </div>
      <div className="space-y-2">
        {assets.map((asset) => {
          const changeValue = getTimeframeChange(asset, timeframe);
          return (
            <Link
              key={asset.symbol}
              to="/asset/$symbol"
              params={{ symbol: asset.symbol }}
              className="group flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-blue-50"
            >
              <Logo asset={asset} />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm font-semibold group-hover:text-primary group-hover:underline">{asset.symbol}</span>
                <span className="block truncate text-xs text-muted-foreground group-hover:text-primary">{asset.name}</span>
              </span>
              <span
                className={
                  changeValue >= 0
                    ? "font-mono text-sm text-emerald-600"
                    : "font-mono text-sm text-red-600"
                }
              >
                {changeValue >= 0 ? "+" : ""}
                {changeValue.toFixed(2)}%
              </span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function BasketCard({
  basket,
  totals,
  updateBasket,
  removeFromBasket,
  clearBasket,
  execute,
}: {
  basket: ReturnType<typeof useTradingStore.getState>["basket"];
  totals: { buy: number; sell: number; fee: number; net: number };
  updateBasket: ReturnType<typeof useTradingStore.getState>["updateBasket"];
  removeFromBasket: ReturnType<typeof useTradingStore.getState>["removeFromBasket"];
  clearBasket: ReturnType<typeof useTradingStore.getState>["clearBasket"];
  execute: () => void;
}) {
  return (
    <Card className="p-4 border-blue-100">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-950">
          <ShoppingBasket className="h-4 w-4" /> Order basket
        </div>
        <Badge variant="secondary">{basket.length}</Badge>
      </div>
      {basket.length === 0 ? (
        <p className="rounded-md bg-blue-50 px-3 py-6 text-center text-sm text-muted-foreground">
          No orders in the basket.
        </p>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {basket.map((line, index) => {
            const asset = getAsset(line.symbol);
            return (
              <div
                key={`${line.symbol}-${index}`}
                className="rounded-md border border-blue-100 p-3"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={
                      line.side === "buy"
                        ? "text-sm font-semibold text-emerald-700"
                        : "text-sm font-semibold text-red-700"
                    }
                  >
                    {line.side.toUpperCase()}{" "}
                    <Link to="/asset/$symbol" params={{ symbol: line.symbol }} className="hover:underline">
                      {line.symbol}
                    </Link>
                  </span>
                  <button
                    onClick={() => removeFromBasket(index)}
                    className="text-muted-foreground hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    value={line.qty}
                    onChange={(event) =>
                      updateBasket(index, { qty: Math.max(0, +event.target.value) })
                    }
                    className="h-8 font-mono text-xs"
                  />
                  <Select
                    value={line.type}
                    onValueChange={(value) => updateBasket(index, { type: value as OrderType })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Market">Market</SelectItem>
                      <SelectItem value="Limit">Limit</SelectItem>
                      <SelectItem value="Stop">Stop</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span>Estimated</span>
                  <span className="font-mono text-foreground">
                    {asset
                      ? (asset.price * line.qty).toLocaleString("en-US", {
                        maximumFractionDigits: 2,
                      })
                      : "--"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-4 space-y-1.5 border-t border-blue-100 pt-3 text-sm">
        <Row label="Total buy" value={formatVnd(totals.buy, 2)} />
        <Row label="Total sell" value={formatVnd(totals.sell, 2)} />
        <Row label="Fees" value={formatVnd(totals.fee, 2)} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={basket.length === 0} onClick={clearBasket}>
          Clear
        </Button>
        <Button
          disabled={basket.length === 0}
          onClick={execute}
          className="bg-blue-600 hover:bg-blue-700"
        >
          Execute
        </Button>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function formatPrice(asset: Asset) {
  return formatVnd(asset.price, asset.price >= 1000 ? 0 : 2);
}
