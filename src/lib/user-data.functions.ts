import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

// ─── User Action Logs ───────────────────────────────────────────────────────

export const logUserAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { actionType: string; symbol?: string; metadata?: Record<string, unknown> }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("user_action_logs").insert({
      user_id: userId,
      action_type: data.actionType,
      symbol: data.symbol ?? null,
      metadata: (data.metadata ?? {}) as Json,
    });
    return { ok: true };
  });

export const getMyActionLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number; offset?: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const limit = data.limit ?? 30;
    const offset = data.offset ?? 0;
    const { data: logs, error, count } = await supabase
      .from("user_action_logs")
      .select("log_id, action_type, symbol, metadata, created_at", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return { logs: logs ?? [], total: count ?? 0 };
  });

// ─── Bias Detection Results ─────────────────────────────────────────────────

export const getMyBiasResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("bias_detection_results")
      .select("result_id, bias_type, score, severity, explanation, evidence, detected_at")
      .eq("user_id", userId)
      .order("detected_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return { results: data ?? [] };
  });

export const saveBiasResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      biasType: string;
      score: number;
      severity: "low" | "medium" | "high";
      explanation?: string;
      evidence?: Record<string, unknown>;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("bias_detection_results").insert({
      user_id: userId,
      bias_type: data.biasType,
      score: data.score,
      severity: data.severity,
      explanation: data.explanation ?? null,
      evidence: (data.evidence ?? {}) as Json,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Behavioral Metrics ─────────────────────────────────────────────────────

export const getMyBehavioralMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { timeWindow?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: metrics, error } = await supabase
      .from("behavioral_metrics")
      .select("metric_id, metric_name, metric_value, time_window, input_features, computed_at")
      .eq("user_id", userId)
      .order("computed_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { metrics: metrics ?? [] };
  });

export const saveBehavioralMetric = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      metricName: string;
      metricValue: number;
      timeWindow: "daily" | "weekly" | "monthly" | "session";
      inputFeatures?: Record<string, unknown>;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("behavioral_metrics").insert({
      user_id: userId,
      metric_name: data.metricName,
      metric_value: data.metricValue,
      time_window: data.timeWindow,
      input_features: (data.inputFeatures ?? {}) as Json,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── AI Recommendations ─────────────────────────────────────────────────────

export const getMyAiRecommendations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: recs, error } = await supabase
      .from("ai_recommendations")
      .select(
        "recommendation_id, recommendation_type, title, content, confidence_score, model_provider, model_name, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);

    // Fetch feedback for these recs
    const ids = (recs ?? []).map((r) => r.recommendation_id);
    const { data: feedbacks } = ids.length
      ? await supabase
          .from("recommendation_feedback")
          .select("recommendation_id, rating, is_helpful")
          .eq("user_id", userId)
          .in("recommendation_id", ids)
      : { data: [] };
    const feedbackMap = new Map(
      (feedbacks ?? []).map((f) => [f.recommendation_id, f]),
    );

    return {
      recommendations: (recs ?? []).map((r) => ({
        ...r,
        feedback: feedbackMap.get(r.recommendation_id) ?? null,
      })),
    };
  });

export const saveAiRecommendation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      type: string;
      title?: string;
      content: string;
      confidenceScore?: number;
      modelProvider?: string;
      modelName?: string;
      inputFeatures?: Record<string, unknown>;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rec, error } = await supabase
      .from("ai_recommendations")
      .insert({
        user_id: userId,
        recommendation_type: data.type as "strategy" | "warning" | "learning" | "portfolio" | "basket_review" | "market_overview",
        title: data.title ?? null,
        content: data.content,
        confidence_score: data.confidenceScore ?? null,
        model_provider: data.modelProvider ?? null,
        model_name: data.modelName ?? null,
        input_features: (data.inputFeatures ?? {}) as Json,
      })
      .select("recommendation_id")
      .single();
    if (error) throw new Error(error.message);
    return { recommendationId: rec.recommendation_id };
  });

export const submitRecommendationFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { recommendationId: string; rating?: number; isHelpful?: boolean; comment?: string }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("recommendation_feedback").upsert(
      {
        recommendation_id: data.recommendationId,
        user_id: userId,
        rating: data.rating ?? null,
        is_helpful: data.isHelpful ?? null,
        comment: data.comment ?? null,
      },
      { onConflict: "recommendation_id,user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Portfolio Snapshots ────────────────────────────────────────────────────

export const getMyPortfolioSnapshots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("portfolio_snapshots")
      .select(
        "snapshot_id, total_value, cash_balance, invested_value, pnl, risk_score, diversification_score, snapshot_source, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(60);
    if (error) throw new Error(error.message);
    return { snapshots: data ?? [] };
  });

export const savePortfolioSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      totalValue: number;
      cashBalance: number;
      investedValue: number;
      pnl: number;
      riskScore?: number;
      diversificationScore?: number;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Check if a snapshot was already taken today to avoid duplicates
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: existing } = await supabase
      .from("portfolio_snapshots")
      .select("snapshot_id")
      .eq("user_id", userId)
      .eq("snapshot_source", "user_visit")
      .gte("created_at", todayStart.toISOString())
      .maybeSingle();

    if (existing) return { ok: true, skipped: true };

    const { error } = await supabase.from("portfolio_snapshots").insert({
      user_id: userId,
      total_value: data.totalValue,
      cash_balance: data.cashBalance,
      invested_value: data.investedValue,
      pnl: data.pnl,
      risk_score: data.riskScore ?? null,
      diversification_score: data.diversificationScore ?? null,
      snapshot_source: "user_visit",
    });
    if (error) throw new Error(error.message);
    return { ok: true, skipped: false };
  });

// ─── User XP ─────────────────────────────────────────────────────────────────

export const getMyXp = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_xp")
      .select("total_xp, level, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { xp: data ?? null };
  });

export const upsertMyXp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { totalXp: number; level: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("user_xp").upsert(
      {
        user_id: userId,
        total_xp: data.totalXp,
        level: data.level,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Achievements ─────────────────────────────────────────────────────────────

export const getAchievementsWithStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: allAchievements, error: achError }, { data: earned, error: earnedError }] =
      await Promise.all([
        supabase
          .from("achievements")
          .select("achievement_id, code, name, description, xp_reward, condition_rule, is_active")
          .eq("is_active", true)
          .order("xp_reward", { ascending: false }),
        supabase
          .from("user_achievements")
          .select("achievement_id, achieved_at")
          .eq("user_id", userId),
      ]);
    if (achError) throw new Error(achError.message);
    if (earnedError) throw new Error(earnedError.message);
    const earnedSet = new Map((earned ?? []).map((e) => [e.achievement_id, e.achieved_at]));
    return {
      achievements: (allAchievements ?? []).map((a) => ({
        ...a,
        earned: earnedSet.has(a.achievement_id),
        achievedAt: earnedSet.get(a.achievement_id) ?? null,
      })),
    };
  });

export const unlockAchievement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { achievementId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_achievements")
      .insert({ user_id: userId, achievement_id: data.achievementId })
      .select()
      .maybeSingle();
    // Ignore duplicate error (unique constraint)
    if (error && !error.message.includes("duplicate") && !error.message.includes("unique")) {
      throw new Error(error.message);
    }
    return { ok: true };
  });

// ─── Challenges ───────────────────────────────────────────────────────────────

export const getChallengesWithStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: challenges, error: chalError }, { data: userChallenges, error: ucError }] =
      await Promise.all([
        supabase
          .from("challenges")
          .select(
            "challenge_id, code, title, description, challenge_type, start_at, end_at, reward_xp, rules, is_active",
          )
          .eq("is_active", true)
          .order("reward_xp", { ascending: false }),
        supabase
          .from("user_challenges")
          .select("challenge_id, status, score, progress, joined_at, completed_at")
          .eq("user_id", userId),
      ]);
    if (chalError) throw new Error(chalError.message);
    if (ucError) throw new Error(ucError.message);
    const ucMap = new Map((userChallenges ?? []).map((uc) => [uc.challenge_id, uc]));
    return {
      challenges: (challenges ?? []).map((c) => ({
        ...c,
        userChallenge: ucMap.get(c.challenge_id) ?? null,
      })),
    };
  });

export const joinChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { challengeId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("user_challenges").insert({
      user_id: userId,
      challenge_id: data.challengeId,
      status: "joined",
      score: 0,
      progress: {} as Json,
    });
    if (error && !error.message.includes("duplicate") && !error.message.includes("unique")) {
      throw new Error(error.message);
    }
    return { ok: true };
  });

// ─── Technical Indicators ────────────────────────────────────────────────────

export const getTechnicalIndicators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { symbol: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Find asset_id by symbol
    const { data: asset } = await supabase
      .from("market_assets")
      .select("asset_id")
      .ilike("symbol", data.symbol)
      .maybeSingle();
    if (!asset) return { indicators: [] };

    const { data: indicators, error } = await supabase
      .from("technical_indicators")
      .select("indicator_id, indicator_name, indicator_value, period, source, timestamp")
      .eq("asset_id", asset.asset_id)
      .order("timestamp", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return { indicators: indicators ?? [] };
  });
