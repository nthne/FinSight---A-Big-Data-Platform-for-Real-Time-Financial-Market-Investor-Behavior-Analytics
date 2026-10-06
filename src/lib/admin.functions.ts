import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INITIAL_CASH } from "@/lib/simulation";

const ROOT_ADMIN_EMAIL = "admin@isbaweb.com";

type BehaviorSummary = {
  id?: string;
  user_id: string;
  summary?: string | null;
  created_at: string;
  portfolio_value?: number | null;
  trade_count?: number | null;
  basket_size?: number | null;
};

type LeaderboardSnapshot = {
  user_id: string;
  period?: string | null;
  rank?: number | null;
  risk_adjusted_return?: number | null;
  total_return?: number | null;
  portfolio_value?: number | null;
  trade_count?: number | null;
  computed_at: string;
};

type PublicLeaderboardProfile = {
  id: string;
  display_name: string | null;
  created_at: string;
};

type TradeOrder = {
  id: string;
  user_id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number | string;
  price: number | string;
  fee: number | string;
  total: number | string;
  source?: string | null;
  executed_at: string;
};

type OpenPosition = {
  user_id: string;
  symbol: string;
  qty: number | string;
  avg_cost: number | string;
  updated_at: string;
};

export const listAllUserSummaries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // admin check
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, email, created_at")
      .order("created_at", { ascending: false });

    const { data: allRoles } = await supabase.from("user_roles").select("user_id, role");

    const { data: summaries } = await supabase
      .from("behavior_summaries")
      .select("*")
      .order("created_at", { ascending: false });
    const { data: orders } = await supabase
      .from("orders")
      .select("id, user_id, symbol, side, qty, price, fee, total, source, executed_at")
      .order("executed_at", { ascending: false });
    const { data: positions } = await supabase
      .from("positions")
      .select("user_id, symbol, qty, avg_cost, updated_at")
      .order("symbol", { ascending: true });
    const { data: accounts } = await supabase.from("trading_accounts").select("user_id, cash");

    const byUser: Record<string, BehaviorSummary[]> = {};
    for (const s of summaries ?? []) {
      (byUser[s.user_id] ??= []).push(s);
    }
    const ordersByUser: Record<string, TradeOrder[]> = {};
    for (const order of orders ?? []) {
      (ordersByUser[order.user_id] ??= []).push(order);
    }
    const positionsByUser: Record<string, OpenPosition[]> = {};
    for (const position of positions ?? []) {
      (positionsByUser[position.user_id] ??= []).push(position);
    }
    const accountByUser = new Map((accounts ?? []).map((account) => [account.user_id, account]));

    const users = (profiles ?? []).map((p) => {
      const userOrders = ordersByUser[p.id] ?? [];
      const userPositions = positionsByUser[p.id] ?? [];
      const latest = byUser[p.id]?.[0] ?? null;
      const portfolioValue = Number(latest?.portfolio_value ?? 0);
      const orderCount = userOrders.length;
      const xp = orderCount * 50 + userPositions.length * 100;
      return {
        ...p,
        latest,
        summaries: byUser[p.id]?.slice(0, 3) ?? [],
        count: byUser[p.id]?.length ?? 0,
        orderCount,
        recentOrders: userOrders.slice(0, 6).map((order) => ({
          ...order,
          qty: Number(order.qty),
          price: Number(order.price),
          fee: Number(order.fee),
          total: Number(order.total),
        })),
        positions: userPositions.map((position) => ({
          ...position,
          qty: Number(position.qty),
          avg_cost: Number(position.avg_cost),
        })),
        tradeStats: summarizeTrades(userOrders),
        game: {
          xp,
          level: Math.floor(xp / 500) + 1,
          score: portfolioValue + orderCount * 25,
        },
        cash: accountByUser.get(p.id)?.cash ?? null,
        roles: (allRoles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role),
      };
    });

    const ranks = new Map(
      [...users]
        .sort((a, b) => b.game.score - a.game.score)
        .map((user, index) => [user.id, index + 1]),
    );

    return {
      users: users.map((user) => ({
        ...user,
        game: { ...user.game, rank: ranks.get(user.id) ?? users.length },
      })),
    };
  });

function summarizeTrades(orders: TradeOrder[]) {
  return orders.reduce(
    (stats, order) => {
      const qty = Number(order.qty);
      const price = Number(order.price);
      const fee = Number(order.fee);
      const total = Number(order.total);
      if (order.side === "buy") stats.buyCount += 1;
      else stats.sellCount += 1;
      stats.totalFees += fee;
      stats.notional += qty * price;
      stats.netCashFlow += total;
      return stats;
    },
    { buyCount: 0, sellCount: 0, totalFees: 0, notional: 0, netCashFlow: 0 },
  );
}

export const promoteUserToAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");

    const { error } = await supabase
      .from("user_roles")
      .upsert(
        { user_id: data.userId, role: "admin" },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const demoteUserFromAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden");
    if (data.userId === userId) throw new Error("You cannot remove your own admin access");

    const { data: targetProfile, error: profileError } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", data.userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (targetProfile?.email?.toLowerCase() === ROOT_ADMIN_EMAIL) {
      throw new Error("The primary admin account cannot be demoted");
    }

    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listLeaderboardEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: leaderboardSnapshots } = await supabase
      .from("leaderboard_entries")
      .select(
        "user_id, period, rank, risk_adjusted_return, total_return, portfolio_value, trade_count, computed_at",
      )
      .order("computed_at", { ascending: false })
      .order("rank", { ascending: true, nullsFirst: false });

    const { data: publicProfiles, error: profileError } = await supabase.rpc(
      "get_leaderboard_public_profiles",
    );

    const latestLeaderboardByUser = new Map<string, LeaderboardSnapshot>();
    for (const snapshot of leaderboardSnapshots ?? []) {
      if (!latestLeaderboardByUser.has(snapshot.user_id)) {
        latestLeaderboardByUser.set(snapshot.user_id, snapshot as LeaderboardSnapshot);
      }
    }

    const usingLeaderboardTable = latestLeaderboardByUser.size > 0;

    const { data: ownProfile } = usingLeaderboardTable
      ? { data: null as PublicLeaderboardProfile | null }
      : await supabase
          .from("profiles")
          .select("id, display_name, created_at")
          .eq("id", userId)
          .maybeSingle();

    const { data: summaries } = usingLeaderboardTable
      ? { data: [] as BehaviorSummary[] }
      : await supabase
          .from("behavior_summaries")
          .select("user_id, portfolio_value, trade_count, created_at")
          .order("created_at", { ascending: false });

    const latestByUser = new Map<string, BehaviorSummary>();
    for (const summary of summaries ?? []) {
      if (!latestByUser.has(summary.user_id)) latestByUser.set(summary.user_id, summary);
    }

    const publicProfileRows =
      profileError && isMissingRpcError(profileError)
        ? [...latestLeaderboardByUser.keys()].map((id) => ({
            id,
            display_name: id === userId ? "You" : `Investor ${id.slice(0, 4).toUpperCase()}`,
            created_at: latestLeaderboardByUser.get(id)?.computed_at ?? new Date(0).toISOString(),
          }))
        : ((publicProfiles ?? []) as PublicLeaderboardProfile[]);

    if (profileError && !isMissingRpcError(profileError)) {
      throw new Error(profileError.message);
    }

    const profiles = usingLeaderboardTable ? publicProfileRows : ownProfile ? [ownProfile] : [];

    const ranked = profiles
      .map((profile) => {
        const leaderboardRow = latestLeaderboardByUser.get(profile.id);
        const latest = latestByUser.get(profile.id);
        const portfolioValue = Number(
          usingLeaderboardTable
            ? (leaderboardRow?.portfolio_value ?? 0)
            : (latest?.portfolio_value ?? 0),
        );
        const tradeCount = Number(
          usingLeaderboardTable ? (leaderboardRow?.trade_count ?? 0) : (latest?.trade_count ?? 0),
        );
        const totalReturn = Number(
          usingLeaderboardTable
            ? (leaderboardRow?.total_return ?? portfolioValue - INITIAL_CASH)
            : latest
              ? portfolioValue - INITIAL_CASH
              : 0,
        );
        const riskAdjusted = Number(
          usingLeaderboardTable
            ? (leaderboardRow?.risk_adjusted_return ?? 0)
            : latest
              ? (portfolioValue - INITIAL_CASH) / Math.max(1, tradeCount)
              : 0,
        );
        return {
          id: profile.id,
          name: profile.display_name ?? "Unnamed user",
          portfolioValue,
          tradeCount,
          totalReturn,
          riskAdjusted,
          score: portfolioValue + tradeCount * 25,
          latestAt: usingLeaderboardTable
            ? (leaderboardRow?.computed_at ?? profile.created_at)
            : (latest?.created_at ?? profile.created_at),
          period: leaderboardRow?.period ?? "monthly",
          you: profile.id === userId,
          hasAnalysis: usingLeaderboardTable ? Boolean(leaderboardRow) : Boolean(latest),
          rowRank: leaderboardRow?.rank ?? null,
        };
      })
      .sort((a, b) => {
        if (a.rowRank != null && b.rowRank != null && a.rowRank !== b.rowRank) {
          return a.rowRank - b.rowRank;
        }
        if (a.rowRank != null && b.rowRank == null) return -1;
        if (a.rowRank == null && b.rowRank != null) return 1;
        return b.score - a.score;
      })
      .map((entry, index) => ({
        ...entry,
        rank: entry.rowRank ?? index + 1,
        ret: entry.hasAnalysis
          ? `${entry.totalReturn >= 0 ? "+" : ""}${entry.totalReturn.toFixed(1)}%`
          : "No analysis",
      }));

    return { users: ranked };
  });

function isMissingRpcError(error: { message?: string; code?: string }) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "PGRST202" ||
    message.includes("schema cache") ||
    message.includes("could not find the function")
  );
}

export const saveMySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { summary: string; portfolioValue: number; tradeCount: number; basketSize: number }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("behavior_summaries").insert({
      user_id: userId,
      summary: data.summary,
      portfolio_value: data.portfolioValue,
      trade_count: data.tradeCount,
      basket_size: data.basketSize,
    });
    if (error) throw new Error(error.message);

    const { error: leaderboardError } = await supabase.from("leaderboard_entries").insert({
      user_id: userId,
      period: "monthly",
      rank: null,
      risk_adjusted_return:
        data.tradeCount > 0
          ? (data.portfolioValue - INITIAL_CASH) / Math.max(1, data.tradeCount)
          : 0,
      total_return: data.portfolioValue - INITIAL_CASH,
      portfolio_value: data.portfolioValue,
      trade_count: data.tradeCount,
      computed_at: new Date().toISOString(),
    });
    if (leaderboardError) throw new Error(leaderboardError.message);
    return { ok: true };
  });

export const getMyLatestSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("behavior_summaries")
      .select("summary, created_at, portfolio_value, trade_count, basket_size")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return { summary: data ?? null };
  });
