-- Near-real-time market data cache and Realtime publication.
-- market_prices remains the historical table; latest_prices is the fast cache
-- that frontend clients subscribe to through Supabase Realtime.

CREATE TABLE IF NOT EXISTS public.latest_prices (
  asset_id UUID PRIMARY KEY REFERENCES public.market_assets(asset_id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  asset_type public.asset_type NOT NULL,
  latest_price NUMERIC NOT NULL,
  previous_price NUMERIC,
  change_percent NUMERIC NOT NULL DEFAULT 0,
  volume NUMERIC,
  source TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS latest_prices_symbol_idx ON public.latest_prices(symbol);
CREATE INDEX IF NOT EXISTS latest_prices_updated_idx ON public.latest_prices(updated_at DESC);
GRANT SELECT ON public.latest_prices TO authenticated;
GRANT ALL ON public.latest_prices TO service_role;
ALTER TABLE public.latest_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "latest prices read" ON public.latest_prices;
CREATE POLICY "latest prices read" ON public.latest_prices
  FOR SELECT TO authenticated
  USING (true);
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

  INSERT INTO public.latest_prices (
    asset_id,
    symbol,
    asset_type,
    latest_price,
    previous_price,
    change_percent,
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
    volume = EXCLUDED.volume,
    source = EXCLUDED.source,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_latest_price_from_market_price() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_latest_price_from_market_price() FROM anon;
REVOKE ALL ON FUNCTION public.sync_latest_price_from_market_price() FROM authenticated;
DROP TRIGGER IF EXISTS market_prices_sync_latest ON public.market_prices;
CREATE TRIGGER market_prices_sync_latest
AFTER INSERT ON public.market_prices
FOR EACH ROW
EXECUTE FUNCTION public.sync_latest_price_from_market_price();
INSERT INTO public.latest_prices (
  asset_id,
  symbol,
  asset_type,
  latest_price,
  previous_price,
  change_percent,
  volume,
  source,
  updated_at
)
SELECT DISTINCT ON (mp.asset_id)
  mp.asset_id,
  ma.symbol,
  ma.asset_type,
  mp.close_price,
  lag_price.close_price AS previous_price,
  CASE
    WHEN lag_price.close_price IS NULL OR lag_price.close_price = 0 THEN 0
    ELSE ROUND(((mp.close_price - lag_price.close_price) / lag_price.close_price) * 100, 4)
  END AS change_percent,
  mp.volume,
  mp.source,
  mp.timestamp
FROM public.market_prices mp
JOIN public.market_assets ma ON ma.asset_id = mp.asset_id
LEFT JOIN LATERAL (
  SELECT mp2.close_price
  FROM public.market_prices mp2
  WHERE mp2.asset_id = mp.asset_id
    AND mp2.timestamp < mp.timestamp
  ORDER BY mp2.timestamp DESC
  LIMIT 1
) lag_price ON true
ORDER BY mp.asset_id, mp.timestamp DESC
ON CONFLICT (asset_id) DO UPDATE SET
  symbol = EXCLUDED.symbol,
  asset_type = EXCLUDED.asset_type,
  latest_price = EXCLUDED.latest_price,
  previous_price = EXCLUDED.previous_price,
  change_percent = EXCLUDED.change_percent,
  volume = EXCLUDED.volume,
  source = EXCLUDED.source,
  updated_at = EXCLUDED.updated_at;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'latest_prices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.latest_prices;
  END IF;
END $$;
