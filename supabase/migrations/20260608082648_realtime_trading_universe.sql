INSERT INTO public.market_assets (symbol, asset_type, name, currency, exchange, data_source, provider_symbol)
VALUES
  ('NVDA', 'equity', 'NVIDIA Corp.', 'USD', 'NASDAQ', 'yahoo', 'NVDA'),
  ('GOOGL', 'equity', 'Alphabet Inc.', 'USD', 'NASDAQ', 'yahoo', 'GOOGL'),
  ('AMZN', 'equity', 'Amazon.com Inc.', 'USD', 'NASDAQ', 'yahoo', 'AMZN'),
  ('VCB', 'equity', 'Vietcombank', 'VND', 'HOSE', 'yahoo', 'VCB.VN'),
  ('BID', 'equity', 'BIDV', 'VND', 'HOSE', 'yahoo', 'BID.VN'),
  ('CTG', 'equity', 'VietinBank', 'VND', 'HOSE', 'yahoo', 'CTG.VN'),
  ('ACB', 'equity', 'Asia Commercial Bank', 'VND', 'HOSE', 'yahoo', 'ACB.VN'),
  ('HPG', 'equity', 'Hoa Phat Group', 'VND', 'HOSE', 'yahoo', 'HPG.VN'),
  ('FPT', 'equity', 'FPT Corporation', 'VND', 'HOSE', 'yahoo', 'FPT.VN'),
  ('MWG', 'equity', 'Mobile World', 'VND', 'HOSE', 'yahoo', 'MWG.VN'),
  ('VHM', 'equity', 'Vinhomes', 'VND', 'HOSE', 'yahoo', 'VHM.VN'),
  ('GAS', 'equity', 'PV GAS', 'VND', 'HOSE', 'yahoo', 'GAS.VN')
ON CONFLICT (symbol) DO UPDATE SET
  asset_type = EXCLUDED.asset_type,
  name = EXCLUDED.name,
  currency = EXCLUDED.currency,
  exchange = EXCLUDED.exchange,
  data_source = EXCLUDED.data_source,
  provider_symbol = EXCLUDED.provider_symbol,
  is_active = true,
  updated_at = now();;
