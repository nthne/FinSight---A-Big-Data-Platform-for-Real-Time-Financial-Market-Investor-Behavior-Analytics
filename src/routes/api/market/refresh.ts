import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";

type ProviderPrice = {
  symbol: string;
  close: number;
  source: string;
  volume?: number | null;
};

export const Route = createFileRoute("/api/market/refresh")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: assets, error } = await supabaseAdmin
          .from("market_assets")
          .select("asset_id, symbol, asset_type, provider_symbol, data_source")
          .eq("is_active", true);

        if (error) return new Response(error.message, { status: 500 });

        const prices = [
          ...(await fetchCoinGeckoPrices(assets ?? [])),
          ...(await fetchAlphaVantagePrices(assets ?? [])),
          ...buildSimulatedIndexPrices(assets ?? []),
        ];

        const bySymbol = new Map((assets ?? []).map((asset) => [asset.symbol, asset]));
        const rows = prices
          .map((price) => {
            const asset = bySymbol.get(price.symbol);
            if (!asset) return null;
            return {
              asset_id: asset.asset_id,
              timestamp: new Date().toISOString(),
              close_price: price.close,
              volume: price.volume ?? null,
              source: price.source,
            };
          })
          .filter(Boolean);

        if (rows.length) {
          const { error: insertError } = await supabaseAdmin.from("market_prices").insert(rows as any[]);
          if (insertError) return new Response(insertError.message, { status: 500 });
        }

        return Response.json({ ok: true, count: rows.length });
      },
    },
  },
});

async function fetchCoinGeckoPrices(assets: any[]): Promise<ProviderPrice[]> {
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
      };
    })
    .filter(Boolean) as ProviderPrice[];
}

async function fetchAlphaVantagePrices(assets: any[]): Promise<ProviderPrice[]> {
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
    });
  }
  return prices;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSimulatedIndexPrices(assets: any[]): ProviderPrice[] {
  const now = Date.now();
  return assets
    .filter((asset) => asset.data_source === "simulated_index")
    .map((asset) => ({
      symbol: asset.symbol,
      close: +(100 + Math.sin(now / 8.64e7) * 1.5).toFixed(2),
      source: "simulated_index",
      volume: null,
    }));
}
