export type AnalyticsPrice = {
  symbol: string;
  close: number;
  source: string;
  volume?: number | null;
  timestamp?: string;
};

export type AnalyticsAsset = {
  symbol: string;
  currency: string | null;
  provider_symbol: string | null;
};

type FetchLike = typeof fetch;

function hexByte(value: number) {
  return value.toString(16).padStart(2, "0");
}

async function stableUuid(seed: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, hexByte).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function buildMarketQuoteEvent(
  price: AnalyticsPrice,
  asset: AnalyticsAsset,
  ingestionTime: string,
) {
  const source = price.source.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  const eventTime = price.timestamp ?? ingestionTime;
  const payload: Record<string, string | number> = {
    close_price: price.close,
    currency: asset.currency?.toUpperCase() ?? "VND",
  };
  if (Number.isFinite(price.volume) && Number(price.volume) >= 0) payload.volume = Number(price.volume);
  if (asset.provider_symbol) payload.provider_symbol = asset.provider_symbol;

  return {
    event_id: await stableUuid(`market_quote|${source}|${asset.symbol}|${eventTime}`),
    event_type: "market_quote",
    schema_version: "1.0.0",
    source,
    event_time: eventTime,
    ingestion_time: ingestionTime,
    asset_symbol: asset.symbol.toUpperCase(),
    payload,
  };
}

export async function publishMarketQuoteEvents(options: {
  prices: AnalyticsPrice[];
  assets: Map<string, AnalyticsAsset>;
  ingestionTime: string;
  gatewayUrl?: string;
  gatewayToken?: string;
  fetchImpl?: FetchLike;
}): Promise<{ accepted: number; failed: number; disabled: boolean }> {
  const { gatewayUrl, gatewayToken } = options;
  if (!gatewayUrl || !gatewayToken) return { accepted: 0, failed: 0, disabled: true };

  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${gatewayUrl.replace(/\/$/, "")}/v1/events`;
  const outcomes = await Promise.all(
    options.prices.map(async (price) => {
      const asset = options.assets.get(price.symbol);
      if (!asset) return false;
      try {
        const event = await buildMarketQuoteEvent(price, asset, options.ingestionTime);
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ingestion-token": gatewayToken,
          },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(2_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    }),
  );
  return {
    accepted: outcomes.filter(Boolean).length,
    failed: outcomes.filter((outcome) => !outcome).length,
    disabled: false,
  };
}
