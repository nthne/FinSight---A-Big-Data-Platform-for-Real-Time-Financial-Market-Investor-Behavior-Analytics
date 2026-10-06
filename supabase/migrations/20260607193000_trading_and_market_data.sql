CREATE TYPE public.order_side AS ENUM ('buy', 'sell');
CREATE TYPE public.asset_type AS ENUM ('equity', 'crypto', 'commodity', 'etf', 'real_estate');
CREATE TABLE public.trading_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cash NUMERIC NOT NULL DEFAULT 100000,
  fee_rate NUMERIC NOT NULL DEFAULT 0.0005,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  avg_cost NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, symbol)
);
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side public.order_side NOT NULL,
  qty NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  fee NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL,
  source TEXT NOT NULL DEFAULT 'simulation',
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.market_assets (
  asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL UNIQUE,
  asset_type public.asset_type NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange TEXT,
  data_source TEXT,
  provider_symbol TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.market_prices (
  price_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.market_assets(asset_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  open_price NUMERIC,
  high_price NUMERIC,
  low_price NUMERIC,
  close_price NUMERIC NOT NULL,
  volume NUMERIC,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_id, timestamp, source)
);
CREATE INDEX positions_user_idx ON public.positions(user_id);
CREATE INDEX orders_user_executed_idx ON public.orders(user_id, executed_at DESC);
CREATE INDEX market_prices_asset_time_idx ON public.market_prices(asset_id, timestamp DESC);
GRANT SELECT, INSERT, UPDATE ON public.trading_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.positions TO authenticated;
GRANT SELECT, INSERT ON public.orders TO authenticated;
GRANT SELECT ON public.market_assets TO authenticated;
GRANT SELECT ON public.market_prices TO authenticated;
GRANT ALL ON public.trading_accounts TO service_role;
GRANT ALL ON public.positions TO service_role;
GRANT ALL ON public.orders TO service_role;
GRANT ALL ON public.market_assets TO service_role;
GRANT ALL ON public.market_prices TO service_role;
ALTER TABLE public.trading_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own trading account read" ON public.trading_accounts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "own trading account insert" ON public.trading_accounts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own trading account update" ON public.trading_accounts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own positions read" ON public.positions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "own positions insert" ON public.positions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own positions update" ON public.positions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own positions delete" ON public.positions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "own orders read" ON public.orders FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "own orders insert" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "market assets read" ON public.market_assets FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "market prices read" ON public.market_prices FOR SELECT TO authenticated
  USING (true);
INSERT INTO public.market_assets (symbol, asset_type, name, currency, exchange, data_source, provider_symbol)
VALUES
  ('AAPL', 'equity', 'Apple Inc.', 'USD', 'NASDAQ', 'alpha_vantage', 'AAPL'),
  ('TSLA', 'equity', 'Tesla, Inc.', 'USD', 'NASDAQ', 'alpha_vantage', 'TSLA'),
  ('MSFT', 'equity', 'Microsoft Corp.', 'USD', 'NASDAQ', 'alpha_vantage', 'MSFT'),
  ('BTC', 'crypto', 'Bitcoin', 'USD', 'CoinGecko', 'coingecko', 'bitcoin'),
  ('ETH', 'crypto', 'Ethereum', 'USD', 'CoinGecko', 'coingecko', 'ethereum'),
  ('GLD', 'commodity', 'SPDR Gold Shares', 'USD', 'NYSE Arca', 'alpha_vantage', 'GLD'),
  ('GOLD', 'commodity', 'Gold reference index', 'USD', 'Simulation', 'simulation', 'GOLD'),
  ('VNRE', 'real_estate', 'Vietnam Real Estate Index', 'VND', 'Simulation', 'simulated_index', 'VNRE')
ON CONFLICT (symbol) DO UPDATE SET
  asset_type = EXCLUDED.asset_type,
  name = EXCLUDED.name,
  currency = EXCLUDED.currency,
  exchange = EXCLUDED.exchange,
  data_source = EXCLUDED.data_source,
  provider_symbol = EXCLUDED.provider_symbol,
  updated_at = now();
