DO $$
DECLARE
  usd_vnd NUMERIC := 26000;
BEGIN
  WITH usd_assets AS (
    SELECT asset_id
    FROM public.market_assets
    WHERE data_source <> 'simulated_index'
      AND COALESCE(provider_symbol, '') !~ '^\^'
      AND COALESCE(provider_symbol, '') !~ '\.VN$'
      AND COALESCE(exchange, '') NOT IN ('HOSE', 'HNX', 'UPCOM')
      AND asset_type IN ('equity', 'crypto', 'commodity', 'etf')
  )
  UPDATE public.market_prices prices
  SET open_price = CASE WHEN prices.open_price IS NULL THEN NULL ELSE ROUND(prices.open_price * usd_vnd, 4) END,
      high_price = CASE WHEN prices.high_price IS NULL THEN NULL ELSE ROUND(prices.high_price * usd_vnd, 4) END,
      low_price = CASE WHEN prices.low_price IS NULL THEN NULL ELSE ROUND(prices.low_price * usd_vnd, 4) END,
      close_price = ROUND(prices.close_price * usd_vnd, 4)
  FROM usd_assets
  WHERE prices.asset_id = usd_assets.asset_id
    AND prices.source IN ('yahoo', 'stooq', 'alpha_vantage', 'coingecko');

  WITH usd_assets AS (
    SELECT asset_id
    FROM public.market_assets
    WHERE data_source <> 'simulated_index'
      AND COALESCE(provider_symbol, '') !~ '^\^'
      AND COALESCE(provider_symbol, '') !~ '\.VN$'
      AND COALESCE(exchange, '') NOT IN ('HOSE', 'HNX', 'UPCOM')
      AND asset_type IN ('equity', 'crypto', 'commodity', 'etf')
  )
  UPDATE public.latest_prices latest
  SET latest_price = ROUND(latest.latest_price * usd_vnd, 4),
      previous_price = CASE WHEN latest.previous_price IS NULL THEN NULL ELSE ROUND(latest.previous_price * usd_vnd, 4) END,
      high_52w = CASE WHEN latest.high_52w IS NULL THEN NULL ELSE ROUND(latest.high_52w * usd_vnd, 4) END,
      low_52w = CASE WHEN latest.low_52w IS NULL THEN NULL ELSE ROUND(latest.low_52w * usd_vnd, 4) END
  FROM usd_assets
  WHERE latest.asset_id = usd_assets.asset_id
    AND latest.source IN ('yahoo', 'stooq', 'alpha_vantage', 'coingecko');

  UPDATE public.market_assets
  SET currency = 'VND',
      updated_at = now()
  WHERE currency IS DISTINCT FROM 'VND';
END $$;
