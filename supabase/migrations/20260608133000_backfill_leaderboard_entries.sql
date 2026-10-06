INSERT INTO public.leaderboard_entries (
  user_id,
  period,
  rank,
  risk_adjusted_return,
  total_return,
  portfolio_value,
  trade_count,
  computed_at
)
SELECT
  latest.user_id,
  'monthly'::public.time_window,
  NULL,
  CASE
    WHEN COALESCE(latest.trade_count, 0) > 0
      THEN ROUND(((COALESCE(latest.portfolio_value, 0) - 10000000) / GREATEST(latest.trade_count, 1))::numeric, 4)
    ELSE 0
  END,
  COALESCE(latest.portfolio_value, 0) - 10000000,
  COALESCE(latest.portfolio_value, 0),
  COALESCE(latest.trade_count, 0),
  latest.created_at
FROM (
  SELECT DISTINCT ON (user_id)
    user_id,
    portfolio_value,
    trade_count,
    created_at
  FROM public.behavior_summaries
  ORDER BY user_id, created_at DESC
) AS latest
ON CONFLICT (user_id, period, computed_at) DO NOTHING;
