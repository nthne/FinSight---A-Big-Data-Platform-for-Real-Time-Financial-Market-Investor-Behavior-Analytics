import { createClient } from "https://esm.sh/@supabase/supabase-js@2.107.0";

type ProviderPrice = {
  symbol: string;
  close: number;
  source: string;
  volume?: number | null;
  timestamp?: string;
  previousClose?: number | null;
  changePercent?: number | null;
  high52w?: number | null;
  low52w?: number | null;
  beta?: number | null;
  history?: HistoricalPrice[];
};

type HistoricalPrice = {
  timestamp: string;
  close: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
};

type MarketAsset = {
  asset_id: string;
  symbol: string;
  asset_type: string;
  currency: string | null;
  exchange: string | null;
  provider_symbol: string | null;
  data_source: string | null;
};

const DEFAULT_USD_VND = 26_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    const bodyMode = await readModeFromBody(request);
    const mode = bodyMode ?? url.searchParams.get("mode") ?? "all";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase service environment");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: assets, error } = await supabase
      .from("market_assets")
      .select("asset_id, symbol, asset_type, currency, exchange, provider_symbol, data_source")
      .eq("is_active", true);

    if (error) throw new Error(error.message);

    const activeAssets = (assets ?? []) as MarketAsset[];
    const includeQuotes = mode === "all" || mode === "quotes";
    const includeBackfill = mode === "all";
    const providerPrices = [
      ...(includeQuotes ? await fetchYahooPrices(activeAssets) : []),
      ...(includeBackfill ? await fetchStooqPrices(activeAssets) : []),
      ...(await fetchCoinGeckoPrices(activeAssets)),
      ...buildSimulatedIndexPrices(activeAssets),
      ...(includeBackfill ? await fetchAlphaVantagePrices(activeAssets, true) : []),
    ];
    const bySymbol = new Map(activeAssets.map((asset) => [asset.symbol, asset]));
    const usdVnd = await fetchUsdVndRate();
    const prices = uniqueBySymbol(providerPrices).map((price) =>
      convertUsdQuoteToVnd(price, bySymbol.get(price.symbol), usdVnd),
    );
    const timestamp = new Date().toISOString();
    const rows = prices.flatMap((price) => {
      const asset = bySymbol.get(price.symbol);
      if (!asset) return [];
      const history = price.history?.length
        ? price.history
        : [{ timestamp: price.timestamp ?? timestamp, close: price.close, volume: price.volume }];
      return history.map((point) => ({
        asset_id: asset.asset_id,
        timestamp: point.timestamp,
        open_price: point.open ?? null,
        high_price: point.high ?? null,
        low_price: point.low ?? null,
        close_price: point.close,
        volume: point.volume ?? null,
        source: price.source,
      }));
    });

    if (rows.length) {
      const { error: insertError } = await supabase.from("market_prices").upsert(rows, {
        onConflict: "asset_id,timestamp,source",
      });
      if (insertError) throw new Error(insertError.message);
    }

    const latestRows = prices
      .map((price) => {
        const asset = bySymbol.get(price.symbol);
        if (!asset) return null;
        const previousClose = getPreviousClose(price);
        const changePercent =
          price.changePercent ?? calculatePointChange(price.close, previousClose) ?? 0;
        return {
          asset_id: asset.asset_id,
          symbol: asset.symbol,
          asset_type: asset.asset_type,
          latest_price: price.close,
          previous_price: previousClose,
          change_percent: changePercent,
          change_percent_1w: calculateHistoryChange(price.close, price.history, 7),
          change_percent_1m: calculateHistoryChange(price.close, price.history, 30),
          change_percent_1y: calculateHistoryChange(price.close, price.history, 365),
          volume: price.volume ?? null,
          source: price.source,
          updated_at: price.timestamp ?? timestamp,
          high_52w: price.high52w ?? null,
          low_52w: price.low52w ?? null,
          beta: price.beta ?? null,
        };
      })
      .filter(Boolean);

    if (latestRows.length) {
      const { error: upsertError } = await supabase.from("latest_prices").upsert(latestRows, {
        onConflict: "asset_id",
      });
      if (upsertError) throw new Error(upsertError.message);
    }

    return Response.json(
      { ok: true, mode, count: rows.length, timestamp },
      { headers: corsHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market refresh failed";
    return new Response(message, { status: 500, headers: corsHeaders });
  }
});

async function readModeFromBody(request: Request): Promise<string | null> {
  if (request.method === "GET") return null;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    const payload = await request.clone().json();
    return typeof payload?.mode === "string" ? payload.mode : null;
  } catch {
    return null;
  }
}

async function fetchYahooPrices(assets: MarketAsset[]): Promise<ProviderPrice[]> {
  const candidates = assets.filter(
    (asset) => asset.data_source === "yahoo" && asset.provider_symbol,
  );
  const prices: ProviderPrice[] = [];
  for (const asset of candidates) {
    const symbol = encodeURIComponent(asset.provider_symbol!);
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`;
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;

    const [quoteResponse, chartResponse] = await Promise.all([
      fetchWithMarketHeaders(quoteUrl),
      fetchWithMarketHeaders(chartUrl),
    ]);
    if (!quoteResponse.ok && !chartResponse.ok) continue;

    const quoteJson = quoteResponse.ok ? await quoteResponse.json() : null;
    const quote = quoteJson?.quoteResponse?.result?.[0];
    const chartJson = chartResponse.ok ? await chartResponse.json() : null;
    const result = chartJson?.chart?.result?.[0];
    const timestamps = result?.timestamp as number[] | undefined;
    const quoteData = result?.indicators?.quote?.[0];
    const closes = quoteData?.close as Array<number | null> | undefined;
    if (!quote && !closes?.length) continue;

    const history = buildYahooHistory(timestamps, quoteData);
    const close = Number(quote?.regularMarketPrice ?? history.at(-1)?.close);
    if (!Number.isFinite(close)) continue;

    prices.push({
      symbol: asset.symbol,
      close,
      volume: nullableNumber(quote?.regularMarketVolume ?? history.at(-1)?.volume),
      previousClose: nullableNumber(quote?.regularMarketPreviousClose),
      changePercent: nullableNumber(quote?.regularMarketChangePercent),
      high52w: nullableNumber(quote?.fiftyTwoWeekHigh ?? maxHistoryValue(history)),
      low52w: nullableNumber(quote?.fiftyTwoWeekLow ?? minHistoryValue(history)),
      beta: nullableNumber(quote?.beta),
      timestamp: quote?.regularMarketTime
        ? new Date(Number(quote.regularMarketTime) * 1000).toISOString()
        : history.at(-1)?.timestamp,
      source: "yahoo",
      history,
    });
  }
  return prices;
}

function buildYahooHistory(
  timestamps?: number[],
  quoteData?: {
    close?: Array<number | null>;
    open?: Array<number | null>;
    high?: Array<number | null>;
    low?: Array<number | null>;
    volume?: Array<number | null>;
  },
): HistoricalPrice[] {
  if (!timestamps?.length || !quoteData?.close?.length) return [];
  return timestamps
    .map((time, index) => {
      const close = nullableNumber(quoteData.close?.[index]);
      if (close == null || close <= 0) return null;
      return {
        timestamp: new Date(time * 1000).toISOString(),
        close,
        open: nullableNumber(quoteData.open?.[index]),
        high: nullableNumber(quoteData.high?.[index]),
        low: nullableNumber(quoteData.low?.[index]),
        volume: nullableNumber(quoteData.volume?.[index]),
      };
    })
    .filter(Boolean) as HistoricalPrice[];
}

async function fetchCoinGeckoPrices(assets: MarketAsset[]): Promise<ProviderPrice[]> {
  const crypto = assets.filter(
    (asset) => asset.data_source === "coingecko" && asset.provider_symbol,
  );
  if (!crypto.length) return [];
  const ids = crypto.map((asset) => asset.provider_symbol).join(",");
  const response = await fetchWithMarketHeaders(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`,
  );
  if (!response.ok) return [];
  const json = await response.json();
  const prices: ProviderPrice[] = [];
  for (const asset of crypto) {
    const data = json[asset.provider_symbol!];
    if (!data?.usd) continue;
    const changePercent = nullableNumber(data.usd_24h_change);
    const close = Number(data.usd);
    prices.push({
      symbol: asset.symbol,
      close,
      volume: data.usd_24h_vol != null ? Number(data.usd_24h_vol) : null,
      previousClose:
        changePercent != null && changePercent !== -100
          ? close / (1 + changePercent / 100)
          : null,
      changePercent,
      timestamp: new Date().toISOString(),
      source: "coingecko",
      history: await fetchCoinGeckoHistory(asset.provider_symbol!),
    });
  }
  return prices;
}

async function fetchUsdVndRate(): Promise<number> {
  const response = await fetchWithMarketHeaders(
    "https://query1.finance.yahoo.com/v7/finance/quote?symbols=USDVND%3DX",
  );
  if (!response.ok) return DEFAULT_USD_VND;
  const json = await response.json();
  const rate = nullableNumber(json?.quoteResponse?.result?.[0]?.regularMarketPrice);
  return rate && rate > 0 ? rate : DEFAULT_USD_VND;
}

function convertUsdQuoteToVnd(
  price: ProviderPrice,
  asset: MarketAsset | undefined,
  usdVnd: number,
): ProviderPrice {
  if (!asset || !shouldConvertUsdQuote(asset)) return price;
  const convert = (value?: number | null) =>
    value == null || !Number.isFinite(value) ? value : +(value * usdVnd).toFixed(4);

  return {
    ...price,
    close: convert(price.close) ?? price.close,
    previousClose: convert(price.previousClose),
    high52w: convert(price.high52w),
    low52w: convert(price.low52w),
    volume: price.source === "coingecko" ? convert(price.volume) : price.volume,
    history: price.history?.map((point) => ({
      ...point,
      close: convert(point.close) ?? point.close,
      open: convert(point.open),
      high: convert(point.high),
      low: convert(point.low),
      volume: price.source === "coingecko" ? convert(point.volume) : point.volume,
    })),
  };
}

function shouldConvertUsdQuote(asset: MarketAsset): boolean {
  if (asset.data_source === "simulated_index") return false;
  if (asset.provider_symbol?.startsWith("^")) return false;
  if (asset.provider_symbol?.endsWith(".VN")) return false;
  if (asset.exchange === "HOSE" || asset.exchange === "HNX" || asset.exchange === "UPCOM") {
    return false;
  }
  return ["crypto", "commodity", "etf", "equity"].includes(asset.asset_type);
}

async function fetchCoinGeckoHistory(id: string): Promise<HistoricalPrice[]> {
  const response = await fetchWithMarketHeaders(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=365&interval=daily`,
  );
  if (!response.ok) return [];
  const json = await response.json();
  const prices = (json?.prices ?? []) as Array<[number, number]>;
  const volumes = new Map<number, number>(
    ((json?.total_volumes ?? []) as Array<[number, number]>).map(([time, volume]) => [
      time,
      volume,
    ]),
  );
  return prices
    .map(([time, close]) => ({
      timestamp: new Date(time).toISOString(),
      close: Number(close),
      volume: nullableNumber(volumes.get(time)),
    }))
    .filter((point) => Number.isFinite(point.close));
}

async function fetchStooqPrices(assets: MarketAsset[]): Promise<ProviderPrice[]> {
  const candidates = assets
    .filter((asset) => asset.data_source === "yahoo" && asset.provider_symbol)
    .map((asset) => ({ asset, stooq: toStooqSymbol(asset.provider_symbol!) }))
    .filter((item) => item.stooq);

  const prices: ProviderPrice[] = [];
  for (const item of candidates) {
    const response = await fetchWithMarketHeaders(
      `https://stooq.com/q/d/l/?s=${encodeURIComponent(item.stooq!)}&i=d`,
    );
    if (!response.ok) continue;
    const csv = await response.text();
    const history = parseStooqCsv(csv).slice(-252);
    const latest = history.at(-1);
    if (!latest) continue;
    prices.push({
      symbol: item.asset.symbol,
      close: latest.close,
      previousClose: history.at(-2)?.close ?? null,
      changePercent: history.at(-2)?.close
        ? ((latest.close - history.at(-2)!.close) / history.at(-2)!.close) * 100
        : null,
      volume: latest.volume ?? null,
      high52w: maxHistoryValue(history),
      low52w: minHistoryValue(history),
      timestamp: latest.timestamp,
      source: "stooq",
      history,
    });
  }
  return prices;
}

function toStooqSymbol(providerSymbol: string): string | null {
  if (providerSymbol === "GC=F") return "gc.f";
  if (providerSymbol.includes(".VN")) return null;
  if (/^[A-Z]+$/.test(providerSymbol)) return `${providerSymbol.toLowerCase()}.us`;
  return null;
}

function parseStooqCsv(csv: string): HistoricalPrice[] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, open, high, low, close, volume] = line.split(",");
      const closeNumber = nullableNumber(close);
      if (!date || closeNumber == null || closeNumber <= 0) return null;
      return {
        timestamp: new Date(`${date}T20:00:00Z`).toISOString(),
        open: nullableNumber(open),
        high: nullableNumber(high),
        low: nullableNumber(low),
        close: closeNumber,
        volume: nullableNumber(volume),
      };
    })
    .filter(Boolean) as HistoricalPrice[];
}

async function fetchAlphaVantagePrices(
  assets: MarketAsset[],
  includeYahooFallback = false,
): Promise<ProviderPrice[]> {
  const key = Deno.env.get("ALPHA_VANTAGE_API_KEY");
  if (!key) return [];
  const candidates = assets.filter(
    (asset) =>
      asset.provider_symbol &&
      (asset.data_source === "alpha_vantage" ||
        (includeYahooFallback &&
          asset.data_source === "yahoo" &&
          /^[A-Z.]+$/.test(asset.provider_symbol) &&
          !asset.provider_symbol.includes(".VN"))),
  );
  const prices: ProviderPrice[] = [];
  for (const [index, asset] of candidates.entries()) {
    if (index > 0) await delay(1250);
    const [quoteResponse, overviewResponse, historyResponse] = await Promise.all([
      fetch(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${asset.provider_symbol}&apikey=${key}`,
      ),
      fetch(
        `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${asset.provider_symbol}&apikey=${key}`,
      ),
      fetch(
        `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${asset.provider_symbol}&outputsize=full&apikey=${key}`,
      ),
    ]);
    if (!quoteResponse.ok) continue;
    const json = await quoteResponse.json();
    const quote = json["Global Quote"];
    const rawPrice = quote?.["05. price"];
    if (!rawPrice) continue;
    const overview = overviewResponse.ok ? await overviewResponse.json() : null;
    const historyJson = historyResponse.ok ? await historyResponse.json() : null;
    const history = buildAlphaVantageHistory(historyJson).slice(-252);
    const previousClose = nullableNumber(quote?.["08. previous close"]);
    const close = Number(rawPrice);
    prices.push({
      symbol: asset.symbol,
      close,
      volume: quote?.["06. volume"] ? Number(quote["06. volume"]) : null,
      previousClose,
      changePercent: previousClose ? ((close - previousClose) / previousClose) * 100 : null,
      high52w: nullableNumber(overview?.["52WeekHigh"]) ?? maxHistoryValue(history),
      low52w: nullableNumber(overview?.["52WeekLow"]) ?? minHistoryValue(history),
      beta: nullableNumber(overview?.Beta),
      timestamp: quote?.["07. latest trading day"]
        ? new Date(`${quote["07. latest trading day"]}T20:00:00Z`).toISOString()
        : history.at(-1)?.timestamp,
      history,
      source: "alpha_vantage",
    });
  }
  return prices;
}

function buildAlphaVantageHistory(json: unknown): HistoricalPrice[] {
  const series = (json as { ["Time Series (Daily)"]?: Record<string, Record<string, string>> })?.[
    "Time Series (Daily)"
  ];
  if (!series) return [];
  return Object.entries(series)
    .map(([date, row]) => ({
      timestamp: new Date(`${date}T20:00:00Z`).toISOString(),
      open: nullableNumber(row["1. open"]),
      high: nullableNumber(row["2. high"]),
      low: nullableNumber(row["3. low"]),
      close: nullableNumber(row["4. close"]),
      volume: nullableNumber(row["5. volume"]),
    }))
    .filter((point): point is HistoricalPrice => point.close != null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
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
    }));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithMarketHeaders(url: string) {
  return fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
    },
  });
}

function uniqueBySymbol(prices: ProviderPrice[]) {
  const bySymbol = new Map<string, ProviderPrice>();
  for (const price of prices) {
    const existing = bySymbol.get(price.symbol);
    if (!existing) {
      bySymbol.set(price.symbol, price);
      continue;
    }
    bySymbol.set(price.symbol, {
      ...existing,
      close: existing.close ?? price.close,
      volume: existing.volume ?? price.volume,
      previousClose: existing.previousClose ?? price.previousClose,
      changePercent: existing.changePercent ?? price.changePercent,
      high52w: existing.high52w ?? price.high52w,
      low52w: existing.low52w ?? price.low52w,
      beta: existing.beta ?? price.beta,
      timestamp: existing.timestamp ?? price.timestamp,
      history: existing.history?.length ? existing.history : price.history,
      source: existing.history?.length ? existing.source : price.source,
    });
  }
  return [...bySymbol.values()];
}

function nullableNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getPreviousClose(price: ProviderPrice): number | null {
  if (price.previousClose != null && price.previousClose > 0) return price.previousClose;
  const history = price.history?.filter((point) => point.close > 0) ?? [];
  if (history.length < 2) return null;
  const latestHistory = history.at(-1);
  const previousHistory = history.at(-2);
  if (!latestHistory || !previousHistory) return null;
  const closeDelta = Math.abs(latestHistory.close - price.close);
  const samePrice = closeDelta / Math.max(Math.abs(price.close), 1) < 0.0001;
  return samePrice ? previousHistory.close : latestHistory.close;
}

function calculatePointChange(currentPrice: number, previousPrice: number | null): number | null {
  if (!previousPrice || previousPrice <= 0 || !Number.isFinite(currentPrice)) return null;
  return +(((currentPrice - previousPrice) / previousPrice) * 100).toFixed(4);
}

function calculateHistoryChange(
  currentPrice: number,
  history: HistoricalPrice[] | undefined,
  daysAgo: number,
): number {
  if (!history?.length || !Number.isFinite(currentPrice) || currentPrice <= 0) return 0;
  const cutoff = Date.now() - daysAgo * 86_400_000;
  // Find the closest point at or before the cutoff
  let closest: HistoricalPrice | undefined;
  for (const point of history) {
    const t = new Date(point.timestamp).getTime();
    if (t <= cutoff) {
      if (!closest || t > new Date(closest.timestamp).getTime()) closest = point;
    }
  }
  if (!closest || closest.close <= 0) return 0;
  return +(((currentPrice - closest.close) / closest.close) * 100).toFixed(4);
}

function maxHistoryValue(history: HistoricalPrice[]) {
  return history.reduce<number | null>((max, point) => {
    const value = point.high ?? point.close;
    if (value <= 0) return max;
    return max == null || value > max ? value : max;
  }, null);
}

function minHistoryValue(history: HistoricalPrice[]) {
  return history.reduce<number | null>((min, point) => {
    const value = point.low ?? point.close;
    if (value <= 0) return min;
    return min == null || value < min ? value : min;
  }, null);
}
