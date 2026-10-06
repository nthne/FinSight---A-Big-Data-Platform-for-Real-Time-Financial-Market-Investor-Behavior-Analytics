-- Add columns to latest_prices
ALTER TABLE public.latest_prices 
ADD COLUMN IF NOT EXISTS change_percent_1w NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS change_percent_1m NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS change_percent_1y NUMERIC NOT NULL DEFAULT 0;

-- Update the sync function / trigger
CREATE OR REPLACE FUNCTION public.sync_latest_price_from_market_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asset_row public.market_assets%ROWTYPE;
  current_latest public.latest_prices%ROWTYPE;
  prev_price NUMERIC;
  pct NUMERIC;
  prev_1w NUMERIC;
  prev_1m NUMERIC;
  prev_1y NUMERIC;
  pct_1w NUMERIC := 0;
  pct_1m NUMERIC := 0;
  pct_1y NUMERIC := 0;
BEGIN
  SELECT * INTO asset_row
  FROM public.market_assets
  WHERE asset_id = NEW.asset_id;

  IF asset_row.asset_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO current_latest
  FROM public.latest_prices
  WHERE asset_id = NEW.asset_id;

  -- Ignore older historical inserts so the cache always represents the newest quote.
  IF current_latest.asset_id IS NOT NULL AND current_latest.updated_at > NEW.timestamp THEN
    RETURN NEW;
  END IF;

  prev_price := COALESCE(current_latest.latest_price, NEW.close_price);
  pct := CASE
    WHEN prev_price IS NULL OR prev_price = 0 THEN 0
    ELSE ROUND(((NEW.close_price - prev_price) / prev_price) * 100, 4)
  END;

  -- Calculate 1W price change (7 days ago)
  SELECT close_price INTO prev_1w
  FROM public.market_prices
  WHERE asset_id = NEW.asset_id AND timestamp <= NEW.timestamp - INTERVAL '7 days'
  ORDER BY timestamp DESC
  LIMIT 1;
  
  IF prev_1w IS NOT NULL AND prev_1w > 0 THEN
    pct_1w := ROUND(((NEW.close_price - prev_1w) / prev_1w) * 100, 4);
  END IF;

  -- Calculate 1M price change (30 days ago)
  SELECT close_price INTO prev_1m
  FROM public.market_prices
  WHERE asset_id = NEW.asset_id AND timestamp <= NEW.timestamp - INTERVAL '30 days'
  ORDER BY timestamp DESC
  LIMIT 1;
  
  IF prev_1m IS NOT NULL AND prev_1m > 0 THEN
    pct_1m := ROUND(((NEW.close_price - prev_1m) / prev_1m) * 100, 4);
  END IF;

  -- Calculate 1Y price change (365 days ago)
  SELECT close_price INTO prev_1y
  FROM public.market_prices
  WHERE asset_id = NEW.asset_id AND timestamp <= NEW.timestamp - INTERVAL '365 days'
  ORDER BY timestamp DESC
  LIMIT 1;
  
  IF prev_1y IS NOT NULL AND prev_1y > 0 THEN
    pct_1y := ROUND(((NEW.close_price - prev_1y) / prev_1y) * 100, 4);
  END IF;

  INSERT INTO public.latest_prices (
    asset_id,
    symbol,
    asset_type,
    latest_price,
    previous_price,
    change_percent,
    change_percent_1w,
    change_percent_1m,
    change_percent_1y,
    volume,
    source,
    updated_at
  )
  VALUES (
    NEW.asset_id,
    asset_row.symbol,
    asset_row.asset_type,
    NEW.close_price,
    prev_price,
    pct,
    pct_1w,
    pct_1m,
    pct_1y,
    NEW.volume,
    NEW.source,
    NEW.timestamp
  )
  ON CONFLICT (asset_id) DO UPDATE SET
    symbol = EXCLUDED.symbol,
    asset_type = EXCLUDED.asset_type,
    latest_price = EXCLUDED.latest_price,
    previous_price = EXCLUDED.previous_price,
    change_percent = EXCLUDED.change_percent,
    change_percent_1w = EXCLUDED.change_percent_1w,
    change_percent_1m = EXCLUDED.change_percent_1m,
    change_percent_1y = EXCLUDED.change_percent_1y,
    volume = EXCLUDED.volume,
    source = EXCLUDED.source,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

-- Seed index assets in market_assets
INSERT INTO public.market_assets (symbol, asset_type, name, currency, exchange, data_source, provider_symbol)
VALUES
  ('VN30', 'equity', 'VN30 Index', 'VND', 'HOSE', 'yahoo', '^VN30'),
  ('VNINDEX', 'equity', 'VNINDEX Index', 'VND', 'HOSE', 'yahoo', '^VNINDEX'),
  ('NASDAQ', 'equity', 'NASDAQ Composite', 'USD', 'NASDAQ', 'yahoo', '^IXIC')
ON CONFLICT (symbol) DO UPDATE SET
  asset_type = EXCLUDED.asset_type,
  name = EXCLUDED.name,
  currency = EXCLUDED.currency,
  exchange = EXCLUDED.exchange,
  data_source = EXCLUDED.data_source,
  provider_symbol = EXCLUDED.provider_symbol,
  is_active = true,
  updated_at = now();
