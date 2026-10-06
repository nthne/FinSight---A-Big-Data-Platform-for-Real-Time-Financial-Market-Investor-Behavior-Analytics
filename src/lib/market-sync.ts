import { supabase } from "@/integrations/supabase/client";
import { applyMarketSnapshots, type MarketHistoryPoint, type MarketSnapshot } from "@/lib/market";

type PriceRow = {
  asset_id: string;
  updated_at: string;
  latest_price: number | string;
  previous_price: number | string | null;
  change_percent?: number | string | null;
  change_percent_1w?: number | string | null;
  change_percent_1m?: number | string | null;
  change_percent_1y?: number | string | null;
  volume: number | string | null;
  source: string | null;
  symbol: string;
  asset_type: string;
  high_52w?: number | string | null;
  low_52w?: number | string | null;
  beta?: number | string | null;
};

type AssetRow = {
  asset_id: string;
  symbol: string;
  asset_type: string | null;
  name: string | null;
  currency: string | null;
  exchange: string | null;
};

type MarketPriceRow = {
  timestamp: string;
  close_price: number | string;
  volume: number | string | null;
};

export async function loadLatestMarketData() {
  const [{ data: assets, error: assetsError }, latestResult] = await Promise.all([
    supabase
      .from("market_assets")
      .select("asset_id, symbol, asset_type, name, currency, exchange")
      .eq("is_active", true),
    fetchLatestPrices(),
  ]);

  if (assetsError) throw new Error(assetsError.message);
  if (latestResult.error) throw new Error(latestResult.error.message);

  const assetsById = new Map(
    ((assets as AssetRow[] | null) ?? []).map((asset) => [asset.asset_id, asset]),
  );
  const snapshots = ((latestResult.data as PriceRow[] | null) ?? [])
    .map((latest) => buildSnapshot(latest, assetsById.get(latest.asset_id)))
    .filter(Boolean) as MarketSnapshot[];

  applyMarketSnapshots(snapshots);
  return snapshots;
}

async function fetchLatestPrices() {
  const fullSelect =
    "asset_id, symbol, asset_type, updated_at, latest_price, previous_price, change_percent, change_percent_1w, change_percent_1m, change_percent_1y, volume, source, high_52w, low_52w, beta";
  const baseSelect =
    "asset_id, symbol, asset_type, updated_at, latest_price, previous_price, change_percent, volume, source";

  const fullResult = await supabase
    .from("latest_prices")
    .select(fullSelect)
    .order("updated_at", { ascending: false });

  if (!isMissingColumnError(fullResult.error)) return fullResult;

  console.warn("[Market sync] latest_prices is missing newer market columns; using base schema.");
  return supabase
    .from("latest_prices")
    .select(baseSelect)
    .order("updated_at", { ascending: false });
}

function isMissingColumnError(error: { message?: string; code?: string } | null) {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "42703" ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("could not find")
  );
}

export async function subscribeToMarketData(onUpdate: (snapshots: MarketSnapshot[]) => void) {
  const { data: assets, error } = await supabase
    .from("market_assets")
    .select("asset_id, symbol, asset_type, name, currency, exchange")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  const assetsById = new Map(
    ((assets as AssetRow[] | null) ?? []).map((asset) => [asset.asset_id, asset]),
  );
  const channel = supabase
    .channel("market-price-updates")
    .on("postgres_changes", { event: "*", schema: "public", table: "latest_prices" }, (payload) => {
      const latest = payload.new as PriceRow | null;
      if (!latest?.asset_id) return;
      const snapshot = buildSnapshot(latest, assetsById.get(latest.asset_id));
      if (!snapshot) return;
      applyMarketSnapshots([snapshot]);
      onUpdate([snapshot]);
    })
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function loadMarketPriceHistory(
  symbol: string,
  points = 120,
): Promise<MarketHistoryPoint[]> {
  const { data: asset, error: assetError } = await supabase
    .from("market_assets")
    .select("asset_id")
    .ilike("symbol", symbol)
    .maybeSingle();

  if (assetError) throw new Error(assetError.message);
  if (!asset?.asset_id) return [];

  const { data, error } = await supabase
    .from("market_prices")
    .select("timestamp, close_price, volume")
    .eq("asset_id", asset.asset_id)
    .order("timestamp", { ascending: false })
    .limit(points);

  if (error) throw new Error(error.message);

  return ((data as MarketPriceRow[] | null) ?? [])
    .reverse()
    .map((row, index) => ({
      t: formatHistoryTick(row.timestamp, index),
      p: Number(row.close_price),
      v: row.volume == null ? null : Number(row.volume),
    }))
    .filter((point) => Number.isFinite(point.p));
}

function buildSnapshot(latest: PriceRow, asset?: AssetRow): MarketSnapshot | null {
  const symbol = asset?.symbol ?? latest.symbol;
  if (!symbol) return null;
  return {
    symbol,
    name: asset?.name ?? symbol,
    assetType: asset?.asset_type ?? latest.asset_type,
    currency: asset?.currency ?? null,
    exchange: asset?.exchange ?? null,
    close: Number(latest.latest_price),
    previousClose: latest.previous_price == null ? null : Number(latest.previous_price),
    changePercent: latest.change_percent == null ? null : Number(latest.change_percent),
    changePercent1w: latest.change_percent_1w == null ? null : Number(latest.change_percent_1w),
    changePercent1m: latest.change_percent_1m == null ? null : Number(latest.change_percent_1m),
    changePercent1y: latest.change_percent_1y == null ? null : Number(latest.change_percent_1y),
    volume: latest.volume == null ? null : Number(latest.volume),
    high52w: latest.high_52w == null ? null : Number(latest.high_52w),
    low52w: latest.low_52w == null ? null : Number(latest.low_52w),
    beta: latest.beta == null ? null : Number(latest.beta),
    source: latest.source,
    timestamp: latest.updated_at,
  };
}

function formatHistoryTick(timestamp: string, fallback: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
