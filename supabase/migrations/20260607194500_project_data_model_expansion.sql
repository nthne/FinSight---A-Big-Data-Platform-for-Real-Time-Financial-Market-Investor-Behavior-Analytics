-- Data model expansion for ISBA-Web.
-- Supabase Auth remains the source of truth for users/sessions; public.profiles
-- and public.user_roles hold app-facing identity and authorization metadata.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE public.order_status AS ENUM ('pending', 'executed', 'cancelled', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_kind') THEN
    CREATE TYPE public.order_kind AS ENUM ('market', 'limit', 'stop');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_window') THEN
    CREATE TYPE public.time_window AS ENUM ('daily', 'weekly', 'monthly', 'session');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bias_severity') THEN
    CREATE TYPE public.bias_severity AS ENUM ('low', 'medium', 'high');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recommendation_type') THEN
    CREATE TYPE public.recommendation_type AS ENUM ('strategy', 'warning', 'learning', 'portfolio', 'basket_review', 'market_overview');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'challenge_status') THEN
    CREATE TYPE public.challenge_status AS ENUM ('joined', 'completed', 'failed', 'abandoned');
  END IF;
END $$;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES public.market_assets(asset_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_kind public.order_kind NOT NULL DEFAULT 'market',
  ADD COLUMN IF NOT EXISTS status public.order_status NOT NULL DEFAULT 'executed',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
UPDATE public.orders o
SET asset_id = a.asset_id
FROM public.market_assets a
WHERE o.asset_id IS NULL
  AND upper(o.symbol) = upper(a.symbol);
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES public.market_assets(asset_id) ON DELETE SET NULL;
UPDATE public.positions p
SET asset_id = a.asset_id
FROM public.market_assets a
WHERE p.asset_id IS NULL
  AND upper(p.symbol) = upper(a.symbol);
CREATE TABLE IF NOT EXISTS public.technical_indicators (
  indicator_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.market_assets(asset_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  indicator_name TEXT NOT NULL,
  indicator_value NUMERIC NOT NULL,
  period INTEGER,
  source TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_id, timestamp, indicator_name, period, source)
);
CREATE TABLE IF NOT EXISTS public.transactions (
  transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES public.market_assets(asset_id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  side public.order_side NOT NULL,
  quantity NUMERIC NOT NULL,
  executed_price NUMERIC NOT NULL,
  total_amount NUMERIC NOT NULL,
  fee NUMERIC NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'simulation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_value NUMERIC NOT NULL,
  cash_balance NUMERIC NOT NULL,
  invested_value NUMERIC NOT NULL DEFAULT 0,
  pnl NUMERIC NOT NULL DEFAULT 0,
  risk_score NUMERIC,
  diversification_score NUMERIC,
  snapshot_source TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_action_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  asset_id UUID REFERENCES public.market_assets(asset_id) ON DELETE SET NULL,
  symbol TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.behavioral_metrics (
  metric_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  time_window public.time_window NOT NULL DEFAULT 'session',
  input_features JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, metric_name, time_window, computed_at)
);
CREATE TABLE IF NOT EXISTS public.bias_detection_results (
  result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bias_type TEXT NOT NULL,
  score NUMERIC NOT NULL CHECK (score >= 0),
  severity public.bias_severity NOT NULL,
  explanation TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ai_recommendations (
  recommendation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recommendation_type public.recommendation_type NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  input_features JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score NUMERIC CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  model_provider TEXT,
  model_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.recommendation_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES public.ai_recommendations(recommendation_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  is_helpful BOOLEAN,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(recommendation_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.user_xp (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_xp INTEGER NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  level TEXT NOT NULL DEFAULT 'Beginner',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.achievements (
  achievement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  xp_reward INTEGER NOT NULL DEFAULT 0 CHECK (xp_reward >= 0),
  condition_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_achievements (
  user_achievement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES public.achievements(achievement_id) ON DELETE CASCADE,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, achievement_id)
);
CREATE TABLE IF NOT EXISTS public.challenges (
  challenge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  challenge_type TEXT NOT NULL,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  reward_xp INTEGER NOT NULL DEFAULT 0 CHECK (reward_xp >= 0),
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_challenges (
  user_challenge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES public.challenges(challenge_id) ON DELETE CASCADE,
  status public.challenge_status NOT NULL DEFAULT 'joined',
  score NUMERIC NOT NULL DEFAULT 0,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, challenge_id)
);
CREATE TABLE IF NOT EXISTS public.leaderboard_entries (
  leaderboard_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period public.time_window NOT NULL,
  rank INTEGER,
  risk_adjusted_return NUMERIC NOT NULL DEFAULT 0,
  total_return NUMERIC NOT NULL DEFAULT 0,
  portfolio_value NUMERIC NOT NULL DEFAULT 0,
  trade_count INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, period, computed_at)
);
CREATE INDEX IF NOT EXISTS orders_asset_idx ON public.orders(asset_id);
CREATE INDEX IF NOT EXISTS positions_asset_idx ON public.positions(asset_id);
CREATE INDEX IF NOT EXISTS technical_indicators_asset_time_idx ON public.technical_indicators(asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS transactions_user_time_idx ON public.transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_asset_time_idx ON public.transactions(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portfolio_snapshots_user_time_idx ON public.portfolio_snapshots(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_action_logs_user_time_idx ON public.user_action_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_action_logs_asset_time_idx ON public.user_action_logs(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS behavioral_metrics_user_time_idx ON public.behavioral_metrics(user_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS bias_detection_user_time_idx ON public.bias_detection_results(user_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS ai_recommendations_user_time_idx ON public.ai_recommendations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recommendation_feedback_user_idx ON public.recommendation_feedback(user_id);
CREATE INDEX IF NOT EXISTS user_achievements_user_idx ON public.user_achievements(user_id);
CREATE INDEX IF NOT EXISTS user_challenges_user_idx ON public.user_challenges(user_id);
CREATE INDEX IF NOT EXISTS leaderboard_period_rank_idx ON public.leaderboard_entries(period, rank NULLS LAST, computed_at DESC);
GRANT SELECT ON public.technical_indicators TO authenticated;
GRANT SELECT, INSERT ON public.transactions TO authenticated;
GRANT SELECT, INSERT ON public.portfolio_snapshots TO authenticated;
GRANT SELECT, INSERT ON public.user_action_logs TO authenticated;
GRANT SELECT, INSERT ON public.behavioral_metrics TO authenticated;
GRANT SELECT, INSERT ON public.bias_detection_results TO authenticated;
GRANT SELECT, INSERT ON public.ai_recommendations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.recommendation_feedback TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_xp TO authenticated;
GRANT SELECT ON public.achievements TO authenticated;
GRANT SELECT, INSERT ON public.user_achievements TO authenticated;
GRANT SELECT ON public.challenges TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_challenges TO authenticated;
GRANT SELECT ON public.leaderboard_entries TO authenticated;
GRANT ALL ON public.technical_indicators TO service_role;
GRANT ALL ON public.transactions TO service_role;
GRANT ALL ON public.portfolio_snapshots TO service_role;
GRANT ALL ON public.user_action_logs TO service_role;
GRANT ALL ON public.behavioral_metrics TO service_role;
GRANT ALL ON public.bias_detection_results TO service_role;
GRANT ALL ON public.ai_recommendations TO service_role;
GRANT ALL ON public.recommendation_feedback TO service_role;
GRANT ALL ON public.user_xp TO service_role;
GRANT ALL ON public.achievements TO service_role;
GRANT ALL ON public.user_achievements TO service_role;
GRANT ALL ON public.challenges TO service_role;
GRANT ALL ON public.user_challenges TO service_role;
GRANT ALL ON public.leaderboard_entries TO service_role;
ALTER TABLE public.technical_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_action_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.behavioral_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bias_detection_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_xp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "technical indicators read" ON public.technical_indicators;
CREATE POLICY "technical indicators read" ON public.technical_indicators FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "own transactions read" ON public.transactions;
CREATE POLICY "own transactions read" ON public.transactions FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own transactions insert" ON public.transactions;
CREATE POLICY "own transactions insert" ON public.transactions FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "own portfolio snapshots read" ON public.portfolio_snapshots;
CREATE POLICY "own portfolio snapshots read" ON public.portfolio_snapshots FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own portfolio snapshots insert" ON public.portfolio_snapshots;
CREATE POLICY "own portfolio snapshots insert" ON public.portfolio_snapshots FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "own action logs read" ON public.user_action_logs;
CREATE POLICY "own action logs read" ON public.user_action_logs FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own action logs insert" ON public.user_action_logs;
CREATE POLICY "own action logs insert" ON public.user_action_logs FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "own behavioral metrics read" ON public.behavioral_metrics;
CREATE POLICY "own behavioral metrics read" ON public.behavioral_metrics FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own behavioral metrics insert" ON public.behavioral_metrics;
CREATE POLICY "own behavioral metrics insert" ON public.behavioral_metrics FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "own bias results read" ON public.bias_detection_results;
CREATE POLICY "own bias results read" ON public.bias_detection_results FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own bias results insert" ON public.bias_detection_results;
CREATE POLICY "own bias results insert" ON public.bias_detection_results FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "own recommendations read" ON public.ai_recommendations;
CREATE POLICY "own recommendations read" ON public.ai_recommendations FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own recommendations insert" ON public.ai_recommendations;
CREATE POLICY "own recommendations insert" ON public.ai_recommendations FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "own recommendation feedback read" ON public.recommendation_feedback;
CREATE POLICY "own recommendation feedback read" ON public.recommendation_feedback FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own recommendation feedback insert" ON public.recommendation_feedback;
CREATE POLICY "own recommendation feedback insert" ON public.recommendation_feedback FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "own recommendation feedback update" ON public.recommendation_feedback;
CREATE POLICY "own recommendation feedback update" ON public.recommendation_feedback FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "own xp read" ON public.user_xp;
CREATE POLICY "own xp read" ON public.user_xp FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own xp insert" ON public.user_xp;
CREATE POLICY "own xp insert" ON public.user_xp FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "own xp update" ON public.user_xp;
CREATE POLICY "own xp update" ON public.user_xp FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "achievements read" ON public.achievements;
CREATE POLICY "achievements read" ON public.achievements FOR SELECT TO authenticated USING (is_active OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own achievements read" ON public.user_achievements;
CREATE POLICY "own achievements read" ON public.user_achievements FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own achievements insert" ON public.user_achievements;
CREATE POLICY "own achievements insert" ON public.user_achievements FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "challenges read" ON public.challenges;
CREATE POLICY "challenges read" ON public.challenges FOR SELECT TO authenticated USING (is_active OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own challenges read" ON public.user_challenges;
CREATE POLICY "own challenges read" ON public.user_challenges FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id OR public.has_role((select auth.uid()), 'admin'));
DROP POLICY IF EXISTS "own challenges insert" ON public.user_challenges;
CREATE POLICY "own challenges insert" ON public.user_challenges FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "own challenges update" ON public.user_challenges;
CREATE POLICY "own challenges update" ON public.user_challenges FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "leaderboard read" ON public.leaderboard_entries;
CREATE POLICY "leaderboard read" ON public.leaderboard_entries FOR SELECT TO authenticated USING (true);
INSERT INTO public.achievements (code, name, description, xp_reward, condition_rule)
VALUES
  ('first_trade', 'First Trade', 'Execute your first simulated order.', 50, '{"event":"order_executed","count":1}'::jsonb),
  ('portfolio_review', 'Portfolio Reviewer', 'Generate and save an AI behavior summary.', 75, '{"event":"behavior_summary_saved","count":1}'::jsonb),
  ('diversified', 'Diversified Investor', 'Hold at least three different asset classes.', 120, '{"asset_classes":3}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  xp_reward = EXCLUDED.xp_reward,
  condition_rule = EXCLUDED.condition_rule;
INSERT INTO public.challenges (code, title, description, challenge_type, reward_xp, rules)
VALUES
  ('risk_budget_week', 'Risk Budget Week', 'Keep position concentration under the challenge limit for one week.', 'risk_control', 150, '{"max_position_weight":0.5,"days":7}'::jsonb),
  ('market_crash_drill', 'Market Crash Drill', 'Practice portfolio decisions under simulated volatility.', 'volatility', 200, '{"scenario":"drawdown","target_drawdown":-0.1}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  challenge_type = EXCLUDED.challenge_type,
  reward_xp = EXCLUDED.reward_xp,
  rules = EXCLUDED.rules;
