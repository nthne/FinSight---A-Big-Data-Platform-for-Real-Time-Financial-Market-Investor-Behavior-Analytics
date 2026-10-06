DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'isba-market-refresh-quotes') THEN
    PERFORM cron.unschedule('isba-market-refresh-quotes');
  END IF;
END $$;

SELECT cron.schedule(
  'isba-market-refresh-quotes',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fyesuadfntuhwnmnyusc.functions.supabase.co/market-refresh?mode=quotes',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);;
