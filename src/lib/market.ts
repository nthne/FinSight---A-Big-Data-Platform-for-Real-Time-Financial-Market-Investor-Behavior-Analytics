// Mock market catalog used across pages. Pure data - no side effects.
export type AssetClass = "Equity" | "Crypto" | "Commodity" | "ETF";

export interface Asset {
  symbol: string;
  name: string;
  class: AssetClass;
  exchange: string;
  price: number;
  change: number; // % since prev close
  change1w?: number;
  change1m?: number;
  change1y?: number;
  currency: string;
  sector?: string;
  marketCap?: string;
  peRatio?: number;
  dividendYield?: number;
  beta?: number;
  high52w?: number;
  low52w?: number;
  volume?: string;
  logoUrl?: string;
  description: string;
  fundamentals?: { label: string; value: string }[];
  news?: { date: string; title: string; source: string }[];
  dataSource?: string;
  lastUpdated?: string;
}

export interface MarketSnapshot {
  symbol: string;
  name?: string | null;
  assetType?: string | null;
  currency?: string | null;
  exchange?: string | null;
  close: number;
  previousClose?: number | null;
  changePercent?: number | null;
  changePercent1w?: number | null;
  changePercent1m?: number | null;
  changePercent1y?: number | null;
  volume?: number | null;
  high52w?: number | null;
  low52w?: number | null;
  beta?: number | null;
  source?: string | null;
  timestamp?: string | null;
}

export interface MarketHistoryPoint {
  t: string | number;
  p: number;
  v: number | null;
}

export type Timeframe = "1D" | "1W" | "1M" | "1Y";

export const ASSETS: Asset[] = [
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    class: "Equity",
    exchange: "NASDAQ",
    price: 214.32,
    change: 0.67,
    currency: "VND",
    sector: "Technology - Consumer Electronics",
    marketCap: "VND 3.28T",
    peRatio: 32.4,
    dividendYield: 0.45,
    beta: 1.21,
    high52w: 237.23,
    low52w: 164.08,
    volume: "48.2M",
    description:
      "Apple designs, manufactures, and markets smartphones, personal computers, tablets, wearables and accessories. Services revenue (App Store, iCloud) continues to grow as a share of total revenue.",
    fundamentals: [
      { label: "Revenue (TTM)", value: "VND 385.1B" },
      { label: "Net income", value: "VND 96.9B" },
      { label: "EPS (TTM)", value: "VND 6.61" },
      { label: "Gross margin", value: "46.2%" },
      { label: "Free cash flow", value: "VND 104.4B" },
      { label: "Cash & equivalents", value: "VND 61.8B" },
    ],
    news: [
      {
        date: "May 09",
        title: "Apple unveils new M5 chip lineup at WWDC preview",
        source: "Reuters",
      },
      { date: "May 06", title: "Services revenue beats estimates in Q2", source: "Bloomberg" },
      { date: "May 02", title: "Buyback program expanded by VND 110B", source: "WSJ" },
    ],
  },
  {
    symbol: "TSLA",
    name: "Tesla, Inc.",
    class: "Equity",
    exchange: "NASDAQ",
    price: 248.91,
    change: -2.18,
    currency: "VND",
    sector: "Consumer Cyclical - Auto Manufacturers",
    marketCap: "VND 792B",
    peRatio: 64.8,
    dividendYield: 0,
    beta: 2.04,
    high52w: 299.29,
    low52w: 138.8,
    volume: "92.1M",
    description:
      "Tesla designs, develops, manufactures and sells electric vehicles, energy generation and storage systems. High beta makes it a frequent vehicle for behavioral biases such as overconfidence and herding.",
    fundamentals: [
      { label: "Revenue (TTM)", value: "VND 96.8B" },
      { label: "Net income", value: "VND 7.1B" },
      { label: "EPS (TTM)", value: "VND 2.04" },
      { label: "Gross margin", value: "17.9%" },
      { label: "Free cash flow", value: "VND 1.4B" },
      { label: "Vehicles delivered (Q1)", value: "386,810" },
    ],
    news: [
      { date: "May 10", title: "Robotaxi unveil pushed to August", source: "Reuters" },
      { date: "May 04", title: "Cybertruck production hits 1k/week", source: "Electrek" },
    ],
  },
  {
    symbol: "GOLD",
    name: "Spot Gold (XAU/VND)",
    class: "Commodity",
    exchange: "OTC",
    price: 2418.5,
    change: 0.62,
    currency: "VND",
    sector: "Precious Metals",
    marketCap: "N/A",
    high52w: 2483.6,
    low52w: 1810.1,
    volume: "N/A",
    description:
      "Spot gold price in Vietnamese dong per troy ounce. Often used as a hedge against inflation and a flight-to-quality asset during equity drawdowns.",
    fundamentals: [
      { label: "30-day vol", value: "12.4%" },
      { label: "Correlation w/ S&P 500", value: "-0.18" },
      { label: "Real yields (10y TIPS)", value: "1.92%" },
    ],
    news: [{ date: "May 08", title: "Central banks add 290t in Q1 - WGC", source: "FT" }],
  },
  {
    symbol: "VIC",
    name: "Vingroup JSC",
    class: "Equity",
    exchange: "HOSE",
    price: 41.2,
    change: 0.34,
    currency: "VND",
    sector: "Vietnam - Diversified Holdings",
    marketCap: "VND 158T",
    peRatio: 28.1,
    dividendYield: 0,
    beta: 1.08,
    high52w: 48.5,
    low52w: 36.1,
    volume: "3.2M",
    description:
      "Vietnam's largest private conglomerate with interests in real estate (Vinhomes), retail, hospitality and electric vehicles (VinFast).",
    fundamentals: [
      { label: "Revenue (TTM)", value: "VND 170.9T" },
      { label: "EPS (TTM)", value: "VND 1,092" },
      { label: "Debt/Equity", value: "1.83" },
    ],
    news: [{ date: "May 07", title: "VinFast expands to Indonesia", source: "VnExpress" }],
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    class: "Crypto",
    exchange: "Binance",
    price: 67120.4,
    change: -1.05,
    currency: "VND",
    sector: "Crypto - Layer 1",
    marketCap: "VND 1.32T",
    high52w: 73835.0,
    low52w: 24890.0,
    volume: "VND 28.4B",
    description:
      "Bitcoin is a decentralized peer-to-peer payment network. Extreme volatility makes it a strong test case for prospect-theory value functions and loss aversion behavior.",
    fundamentals: [
      { label: "Circulating supply", value: "19.71M BTC" },
      { label: "Hash rate", value: "612 EH/s" },
      { label: "30-day vol", value: "48.1%" },
    ],
    news: [
      {
        date: "May 11",
        title: "ETF inflows resume after 3-day outflow streak",
        source: "CoinDesk",
      },
    ],
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corp.",
    class: "Equity",
    exchange: "NASDAQ",
    price: 421.18,
    change: 1.04,
    currency: "VND",
    sector: "Technology - Software",
    marketCap: "VND 3.13T",
    peRatio: 36.2,
    dividendYield: 0.71,
    beta: 0.93,
    high52w: 433.6,
    low52w: 309.45,
    volume: "21.3M",
    description:
      "Microsoft develops cloud (Azure), productivity (Office 365) and AI infrastructure. A core long-duration growth name with relatively low realised volatility.",
    fundamentals: [
      { label: "Revenue (TTM)", value: "VND 236.6B" },
      { label: "Net income", value: "VND 86.2B" },
      { label: "Azure growth", value: "+31% YoY" },
    ],
    news: [{ date: "May 09", title: "Copilot enterprise seats top 50M", source: "CNBC" }],
  },
  {
    symbol: "VNM",
    name: "Vinamilk",
    class: "Equity",
    exchange: "HOSE",
    price: 68.4,
    change: -0.42,
    currency: "VND",
    sector: "Vietnam - Consumer Staples",
    marketCap: "VND 143T",
    peRatio: 17.4,
    dividendYield: 5.6,
    beta: 0.62,
    high52w: 75.2,
    low52w: 60.1,
    volume: "1.8M",
    description:
      "Vietnam Dairy Products JSC is the largest dairy producer in Vietnam. Defensive consumer staple with steady cashflows and high dividend yield.",
    fundamentals: [
      { label: "Revenue (TTM)", value: "VND 61.8T" },
      { label: "Payout ratio", value: "82%" },
      { label: "ROE", value: "26.4%" },
    ],
  },
  ...(
    [
      [
        "VCB",
        "Vietcombank",
        "HOSE",
        58.7,
        1.42,
        "Banking",
        "https://logo.clearbit.com/vietcombank.com.vn",
        "Large-cap Vietnamese commercial bank with strong deposit franchise.",
      ],
      [
        "BID",
        "BIDV",
        "HOSE",
        41.0,
        -2.38,
        "Banking",
        "https://logo.clearbit.com/bidv.com.vn",
        "Major Vietnamese bank with broad corporate lending exposure.",
      ],
      [
        "CTG",
        "VietinBank",
        "HOSE",
        33.25,
        -1.92,
        "Banking",
        "https://logo.clearbit.com/vietinbank.vn",
        "Systemically important Vietnamese bank with large retail and enterprise base.",
      ],
      [
        "ACB",
        "Asia Commercial Bank",
        "HOSE",
        25.25,
        -3.44,
        "Banking",
        "https://logo.clearbit.com/acb.com.vn",
        "Private-sector Vietnamese bank with active retail trading liquidity.",
      ],
      [
        "HDB",
        "HDBank",
        "HOSE",
        25.1,
        -1.57,
        "Banking",
        "https://logo.clearbit.com/hdbank.com.vn",
        "Retail and SME-focused Vietnamese bank.",
      ],
      [
        "MBB",
        "MB Bank",
        "HOSE",
        23.6,
        0.86,
        "Banking",
        "https://logo.clearbit.com/mbbank.com.vn",
        "Military Commercial Joint Stock Bank with strong digital banking footprint.",
      ],
      [
        "TCB",
        "Techcombank",
        "HOSE",
        30.4,
        1.21,
        "Banking",
        "https://logo.clearbit.com/techcombank.com",
        "Private Vietnamese bank with affluent retail and corporate ecosystem exposure.",
      ],
      [
        "VPB",
        "VPBank",
        "HOSE",
        18.3,
        2.52,
        "Banking",
        "https://logo.clearbit.com/vpbank.com.vn",
        "Commercial bank with consumer finance and SME exposure.",
      ],
      [
        "HPG",
        "Hoa Phat Group",
        "HOSE",
        27.8,
        2.19,
        "Materials",
        "https://logo.clearbit.com/hoaphat.com.vn",
        "Vietnam steel and industrial materials leader.",
      ],
      [
        "GVR",
        "Vietnam Rubber Group",
        "HOSE",
        31.6,
        1.67,
        "Materials",
        "https://logo.clearbit.com/vrg.vn",
        "Rubber and industrial land group with commodity sensitivity.",
      ],
      [
        "FPT",
        "FPT Corporation",
        "HOSE",
        118.4,
        1.86,
        "Technology",
        "https://logo.clearbit.com/fpt.com",
        "Vietnam technology group spanning software export, telecom and education.",
      ],
      [
        "CMG",
        "CMC Corporation",
        "HOSE",
        54.9,
        3.08,
        "Technology",
        "https://logo.clearbit.com/cmc.com.vn",
        "Vietnam IT services, telecom infrastructure and cloud group.",
      ],
      [
        "MWG",
        "Mobile World",
        "HOSE",
        62.1,
        3.36,
        "Consumer Discretionary",
        "https://logo.clearbit.com/mwg.vn",
        "Retail group operating electronics, groceries and pharmacy chains.",
      ],
      [
        "PNJ",
        "Phu Nhuan Jewelry",
        "HOSE",
        94.7,
        0.95,
        "Consumer Discretionary",
        "https://logo.clearbit.com/pnj.com.vn",
        "Jewelry retailer with consumer discretionary demand exposure.",
      ],
      [
        "SAB",
        "Sabeco",
        "HOSE",
        56.8,
        -0.64,
        "Consumer Staples",
        "https://logo.clearbit.com/sabeco.com.vn",
        "Vietnam brewer with defensive consumer staple characteristics.",
      ],
      [
        "MSN",
        "Masan Group",
        "HOSE",
        72.2,
        1.54,
        "Consumer Staples",
        "https://logo.clearbit.com/masangroup.com",
        "Consumer, retail and food platform with broad household demand exposure.",
      ],
      [
        "VHM",
        "Vinhomes",
        "HOSE",
        42.6,
        -0.91,
        "Real Estate",
        "https://logo.clearbit.com/vinhomes.vn",
        "Residential real estate developer with large township projects.",
      ],
      [
        "VRE",
        "Vincom Retail",
        "HOSE",
        18.9,
        0.74,
        "Real Estate",
        "https://logo.clearbit.com/vincom.com.vn",
        "Shopping mall operator with recurring retail property income.",
      ],
      [
        "KDH",
        "Khang Dien House",
        "HOSE",
        34.2,
        1.12,
        "Real Estate",
        "https://logo.clearbit.com/khangdien.com.vn",
        "Residential developer focused on urban housing projects.",
      ],
      [
        "GAS",
        "PV GAS",
        "HOSE",
        72.3,
        0.68,
        "Energy",
        "https://logo.clearbit.com/pvgas.com.vn",
        "Gas infrastructure and energy company tied to domestic gas demand.",
      ],
      [
        "PLX",
        "Petrolimex",
        "HOSE",
        39.2,
        -0.51,
        "Energy",
        "https://logo.clearbit.com/petrolimex.com.vn",
        "Fuel distribution group with nationwide retail network.",
      ],
      [
        "PVD",
        "PV Drilling",
        "HOSE",
        26.4,
        4.02,
        "Energy",
        "https://logo.clearbit.com/pvdrilling.com.vn",
        "Oilfield drilling services company with energy-cycle sensitivity.",
      ],
      [
        "GOOGL",
        "Alphabet Inc.",
        "NASDAQ",
        174.9,
        0.92,
        "Technology",
        "https://logo.clearbit.com/abc.xyz",
        "Search, advertising, cloud and AI platform company.",
      ],
      [
        "NVDA",
        "NVIDIA Corp.",
        "NASDAQ",
        128.3,
        4.18,
        "Technology",
        "https://logo.clearbit.com/nvidia.com",
        "AI accelerator and GPU leader with high momentum behavior risk.",
      ],
      [
        "AMZN",
        "Amazon.com Inc.",
        "NASDAQ",
        186.2,
        1.33,
        "Consumer Discretionary",
        "https://logo.clearbit.com/amazon.com",
        "Global ecommerce and cloud infrastructure company.",
      ],
      [
        "ETH",
        "Ethereum",
        "CoinGecko",
        1672.49,
        -0.64,
        "Crypto",
        "https://cryptologos.cc/logos/ethereum-eth-logo.png",
        "Smart-contract blockchain asset used as a high-volatility benchmark.",
      ],
      [
        "GLD",
        "SPDR Gold Shares",
        "NYSE Arca",
        396.24,
        -3.65,
        "ETF",
        "https://logo.clearbit.com/spdrgoldshares.com",
        "Gold-backed ETF for commodity exposure without futures trading.",
      ],
    ] satisfies Array<[string, string, string, number, number, string, string, string]>
  ).map(
    ([symbol, name, exchange, price, change, sector, logoUrl, description]) =>
      ({
        symbol,
        name,
        class: sector === "Crypto" ? "Crypto" : sector === "ETF" ? "ETF" : "Equity",
        exchange,
        price,
        change,
        currency: "VND",
        sector,
        marketCap: exchange === "HOSE" ? "Vietnam large/mid cap" : "US large cap",
        peRatio: 12 + Math.abs(change) * 3,
        dividendYield: exchange === "HOSE" ? 1.4 : 0.3,
        beta: +(0.75 + Math.abs(change) / 10).toFixed(2),
        high52w: +(price * 1.22).toFixed(2),
        low52w: +(price * 0.78).toFixed(2),
        volume: `${(2 + Math.abs(change) * 4).toFixed(1)}M`,
        logoUrl,
        description,
      }) as Asset,
  ),
];

export function getAsset(symbol: string): Asset | undefined {
  return ASSETS.find((a) => a.symbol.toLowerCase() === symbol.toLowerCase());
}

export function getTimeframeChange(asset: Asset | undefined, timeframe: Timeframe) {
  if (!asset) return 0;
  switch (timeframe) {
    case "1W":
      return asset.change1w ?? asset.change;
    case "1M":
      return asset.change1m ?? asset.change;
    case "1Y":
      return asset.change1y ?? asset.change;
    case "1D":
    default:
      return asset.change;
  }
}

export const REALTIME_SYMBOLS = new Set([
  "AAPL",
  "MSFT",
  "TSLA",
  "NVDA",
  "GOOGL",
  "AMZN",
  "VCB",
  "BID",
  "CTG",
  "ACB",
  "HPG",
  "FPT",
  "MWG",
  "VHM",
  "GAS",
  "VIC",
  "VNM",
  "GLD",
  "GOLD",
  "BTC",
  "ETH",
  "VN30",
  "VNINDEX",
  "NASDAQ",
]);

export function getRealtimeAssets() {
  return ASSETS.filter((asset) => REALTIME_SYMBOLS.has(asset.symbol));
}

export function applyMarketSnapshots(snapshots: MarketSnapshot[]) {
  for (const snapshot of snapshots) {
    const symbol = snapshot.symbol.toUpperCase();
    const existing = getAsset(symbol);
    const previous = snapshot.previousClose ?? existing?.price ?? snapshot.close;
    const change =
      snapshot.changePercent != null
        ? +snapshot.changePercent.toFixed(2)
        : previous
          ? +(((snapshot.close - previous) / previous) * 100).toFixed(2)
          : 0;
    const volume = snapshot.volume != null ? formatVolume(snapshot.volume) : existing?.volume;

    if (existing) {
      existing.price = snapshot.close;
      existing.change = change;
      if (snapshot.changePercent1w != null)
        existing.change1w = +snapshot.changePercent1w.toFixed(2);
      if (snapshot.changePercent1m != null)
        existing.change1m = +snapshot.changePercent1m.toFixed(2);
      if (snapshot.changePercent1y != null)
        existing.change1y = +snapshot.changePercent1y.toFixed(2);
      existing.currency = "VND";
      if (snapshot.exchange) existing.exchange = snapshot.exchange;
      if (volume) existing.volume = volume;
      if (snapshot.high52w != null) existing.high52w = snapshot.high52w;
      if (snapshot.low52w != null) existing.low52w = snapshot.low52w;
      if (snapshot.beta != null) existing.beta = +snapshot.beta.toFixed(2);
      existing.dataSource = snapshot.source ?? existing.dataSource;
      existing.lastUpdated = snapshot.timestamp ?? existing.lastUpdated;
      continue;
    }

    ASSETS.push({
      symbol,
      name: snapshot.name ?? symbol,
      class: mapAssetType(snapshot.assetType),
      exchange: snapshot.exchange ?? "Market",
      price: snapshot.close,
      change,
      change1w: snapshot.changePercent1w != null ? +snapshot.changePercent1w.toFixed(2) : undefined,
      change1m: snapshot.changePercent1m != null ? +snapshot.changePercent1m.toFixed(2) : undefined,
      change1y: snapshot.changePercent1y != null ? +snapshot.changePercent1y.toFixed(2) : undefined,
      currency: "VND",
      volume,
      high52w: snapshot.high52w ?? undefined,
      low52w: snapshot.low52w ?? undefined,
      beta: snapshot.beta ?? undefined,
      description: `${snapshot.name ?? symbol} market data loaded from ${snapshot.source ?? "Supabase"}.`,
      dataSource: snapshot.source ?? undefined,
      lastUpdated: snapshot.timestamp ?? undefined,
    });
  }
}

function mapAssetType(assetType?: string | null): AssetClass {
  switch (assetType) {
    case "crypto":
      return "Crypto";
    case "commodity":
    case "real_estate":
      return "Commodity";
    case "etf":
      return "ETF";
    default:
      return "Equity";
  }
}

function formatVolume(volume: number) {
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(1)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(1)}K`;
  return volume.toFixed(0);
}

// Deterministic price history generator (per-symbol seed) so charts stay stable across renders.
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function priceHistory(symbol: string, points = 60) {
  const a = getAsset(symbol);
  if (!a) return [];
  const seed = symbol.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = seededRandom(seed);
  const base = a.price;
  return Array.from({ length: points }, (_, i) => {
    const drift = Math.sin(i / 5 + seed) * (base * 0.04);
    const noise = (rand() - 0.5) * (base * 0.012);
    const p = base - drift * (1 - i / points) + noise;
    return {
      t: i,
      p: +p.toFixed(2),
      v: +(5 + rand() * 10).toFixed(1),
    };
  });
}
