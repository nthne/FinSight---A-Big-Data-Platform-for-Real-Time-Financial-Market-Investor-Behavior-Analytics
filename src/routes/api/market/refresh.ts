import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildMarketQuoteEvent,
  publishAppEvent,
  type MarketQuoteRecord,
} from "../../../../ingestion/producers/app_event_producer";

type ProviderPrice = {
  symbol: string;
  close: number;
  source: string;
  volume?: number | null;
  timestamp?: string;
};

type MarketAsset = {
  asset_id: string;
  symbol: string;
  asset_type: string;
  currency: string | null;
  provider_symbol: string | null;
  data_source: string | null;
};

export const Route = createFileRoute("/api/market/refresh")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (!(await hasValidUser(request))) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: assets, error } = await supabaseAdmin
          .from("market_assets")
          .select("asset_id, symbol, asset_type, currency, provider_symbol, data_source")
          .eq("is_active", true);

        if (error) return new Response(error.message, { status: 500 });

        const activeAssets = (assets ?? []) as MarketAsset[];
        const prices = [
          ...(await fetchCoinGeckoPrices(activeAssets)),
          ...(await fetchAlphaVantagePrices(activeAssets)),
          ...buildSimulatedIndexPrices(activeAssets),
        ];

        const bySymbol = new Map(activeAssets.map((asset) => [asset.symbol, asset]));
        const ingestionTime = new Date().toISOString();
        const rows = prices
          .map((price) => {
            const asset = bySymbol.get(price.symbol);
            if (!asset) return null;
            return {
              asset_id: asset.asset_id,
              timestamp: price.timestamp ?? ingestionTime,
              close_price: price.close,
              volume: price.volume ?? null,
              source: price.source,
            };
          })
          .filter(Boolean);

        if (rows.length) {
          const { error: insertError } = await supabaseAdmin
            .from("market_prices")
            .upsert(rows, { onConflict: "asset_id,timestamp,source" });
          if (insertError) return new Response(insertError.message, { status: 500 });
        }

        const gatewayUrl = process.env.INGESTION_GATEWAY_URL;
        const gatewayToken = process.env.INGESTION_GATEWAY_TOKEN;
        let accepted = 0;
        let failed = 0;
        const disabled = !gatewayUrl || !gatewayToken;

        if (!disabled) {
          for (const price of prices) {
            const asset = bySymbol.get(price.symbol);
            if (!asset) continue;
            const eventRecord: MarketQuoteRecord = {
              symbol: price.symbol,
              close: price.close,
              source: price.source,
              timestamp: price.timestamp ?? ingestionTime,
              volume: price.volume,
              currency: asset.currency,
              providerSymbol: asset.provider_symbol,
            };
            try {
              await publishAppEvent(buildMarketQuoteEvent(eventRecord, ingestionTime), {
                gatewayUrl,
                token: gatewayToken,
                timeoutMs: 3_000,
              });
              accepted += 1;
            } catch (error) {
              failed += 1;
              console.warn("[Market refresh] Could not publish market event", {
                symbol: price.symbol,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        return Response.json({
          ok: true,
          count: rows.length,
          analytics: { accepted, failed, disabled },
          timestamp: ingestionTime,
        });
      },
    },
  },
});

async function hasValidUser(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!authorization?.startsWith("Bearer ") || !supabaseUrl || !publishableKey) return false;

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return false;

  const client = createClient<Database>(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getClaims(token);
  return !error && Boolean(data?.claims?.sub);
}

async function fetchCoinGeckoPrices(assets: MarketAsset[]): Promise<ProviderPrice[]> {
  const crypto = assets.filter((asset) => asset.data_source === "coingecko" && asset.provider_symbol);
  if (!crypto.length) return [];
  const ids = crypto.map((asset) => asset.provider_symbol).join(",");
  const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_vol=true`);
  if (!response.ok) return [];
  const json = await response.json();
  return crypto
    .map((asset) => {
      const data = json[asset.provider_symbol];
      if (!data?.usd) return null;
      return {
        symbol: asset.symbol,
        close: Number(data.usd),
        volume: data.usd_24h_vol != null ? Number(data.usd_24h_vol) : null,
        source: "coingecko",
        timestamp: new Date().toISOString(),
      };
    })
    .filter(Boolean) as ProviderPrice[];
}

async function fetchAlphaVantagePrices(assets: MarketAsset[]): Promise<ProviderPrice[]> {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return [];
  const candidates = assets.filter((asset) => asset.data_source === "alpha_vantage" && asset.provider_symbol);
  const prices: ProviderPrice[] = [];
  for (const [index, asset] of candidates.entries()) {
    if (index > 0) await delay(1250);
    const response = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${asset.provider_symbol}&apikey=${key}`);
    if (!response.ok) continue;
    const json = await response.json();
    const quote = json["Global Quote"];
    const rawPrice = quote?.["05. price"];
    if (!rawPrice) continue;
    prices.push({
      symbol: asset.symbol,
      close: Number(rawPrice),
      volume: quote?.["06. volume"] ? Number(quote["06. volume"]) : null,
      source: "alpha_vantage",
      timestamp: quote?.["07. latest trading day"]
        ? new Date(`${quote["07. latest trading day"]}T20:00:00Z`).toISOString()
        : new Date().toISOString(),
    });
  }
  return prices;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSimulatedIndexPrices(assets: MarketAsset[]): ProviderPrice[] {
  const now = Date.now();
  return assets
    .filter((asset) => asset.data_source === "simulated_index")
    .map((asset) => ({
      symbol: asset.symbol,
      close: +(100 + Math.sin(now / 8.64e7) * 1.5).toFixed(2),
      source: "simulated_index",
      volume: null,
      timestamp: new Date(now).toISOString(),
    }));
}
