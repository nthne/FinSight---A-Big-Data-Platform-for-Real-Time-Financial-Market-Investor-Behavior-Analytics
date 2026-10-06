ALTER TABLE public.latest_prices
  ADD COLUMN IF NOT EXISTS high_52w NUMERIC,
  ADD COLUMN IF NOT EXISTS low_52w NUMERIC,
  ADD COLUMN IF NOT EXISTS beta NUMERIC;

UPDATE public.market_assets
SET data_source = 'yahoo',
    provider_symbol = symbol,
    updated_at = now()
WHERE symbol IN ('AAPL', 'TSLA', 'MSFT', 'GLD');

UPDATE public.market_assets
SET data_source = 'yahoo',
    provider_symbol = 'GC=F',
    exchange = 'COMEX',
    name = 'Gold Futures',
    updated_at = now()
WHERE symbol = 'GOLD';

INSERT INTO public.market_assets (symbol, asset_type, name, currency, exchange, data_source, provider_symbol)
VALUES
  ('VIC', 'equity', 'Vingroup JSC', 'VND', 'HOSE', 'yahoo', 'VIC.VN'),
  ('VNM', 'equity', 'Vinamilk', 'VND', 'HOSE', 'yahoo', 'VNM.VN')
ON CONFLICT (symbol) DO UPDATE SET
  asset_type = EXCLUDED.asset_type,
  name = EXCLUDED.name,
  currency = EXCLUDED.currency,
  exchange = EXCLUDED.exchange,
  data_source = EXCLUDED.data_source,
  provider_symbol = EXCLUDED.provider_symbol,
  updated_at = now();;
