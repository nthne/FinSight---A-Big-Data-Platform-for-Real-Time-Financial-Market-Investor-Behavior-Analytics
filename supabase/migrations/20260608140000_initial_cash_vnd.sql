ALTER TABLE public.trading_accounts
  ALTER COLUMN cash SET DEFAULT 10000000;

UPDATE public.trading_accounts account
SET cash = 10000000,
    updated_at = now()
WHERE cash = 100000
  AND NOT EXISTS (
    SELECT 1
    FROM public.orders orders
    WHERE orders.user_id = account.user_id
  );

UPDATE public.leaderboard_entries
SET total_return = portfolio_value - 10000000,
    risk_adjusted_return = CASE
      WHEN trade_count > 0
        THEN ROUND(((portfolio_value - 10000000) / GREATEST(trade_count, 1))::numeric, 4)
      ELSE 0
    END
WHERE computed_at IS NOT NULL;
