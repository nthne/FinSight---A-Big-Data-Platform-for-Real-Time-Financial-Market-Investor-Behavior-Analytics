-- Supabase Cron + pg_net scheduler for automated market ingestion.
-- Official Supabase pattern: pg_cron invokes an Edge Function through pg_net.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'isba-market-refresh-crypto') THEN
    PERFORM cron.unschedule('isba-market-refresh-crypto');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'isba-market-refresh-full') THEN
    PERFORM cron.unschedule('isba-market-refresh-full');
  END IF;
END $$;
SELECT cron.schedule(
  'isba-market-refresh-crypto',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fyesuadfntuhwnmnyusc.functions.supabase.co/market-refresh?mode=crypto',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
SELECT cron.schedule(
  'isba-market-refresh-full',
  '0 */4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://fyesuadfntuhwnmnyusc.functions.supabase.co/market-refresh?mode=all',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
