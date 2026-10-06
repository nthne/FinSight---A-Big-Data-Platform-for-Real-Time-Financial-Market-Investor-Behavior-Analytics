import { supabase } from "@/integrations/supabase/client";
import { INITIAL_CASH } from "@/lib/simulation";
import type { ExecutedOrder, Position } from "@/lib/store";

export interface TradingSnapshot {
  cash: number;
  feeRate: number;
  positions: Position[];
  history: ExecutedOrder[];
}

const DEFAULT_CASH = INITIAL_CASH;
const DEFAULT_FEE_RATE = 0.0005;

export async function loadTradingSnapshot(userId: string): Promise<TradingSnapshot> {
  let { data: account, error: accountError } = await supabase
    .from("trading_accounts")
    .select("cash, fee_rate")
    .eq("user_id", userId)
    .maybeSingle();

  if (accountError) throw new Error(accountError.message);

  if (!account) {
    const { data: created, error } = await supabase
      .from("trading_accounts")
      .insert({ user_id: userId, cash: DEFAULT_CASH, fee_rate: DEFAULT_FEE_RATE })
      .select("cash, fee_rate")
      .single();
    if (error) throw new Error(error.message);
    account = created;
  }

  const [{ data: positions, error: positionsError }, { data: orders, error: ordersError }] =
    await Promise.all([
      supabase
        .from("positions")
        .select("symbol, qty, avg_cost")
        .eq("user_id", userId)
        .order("symbol", { ascending: true }),
      supabase
        .from("orders")
        .select("id, symbol, side, qty, price, fee, total, executed_at")
        .eq("user_id", userId)
        .order("executed_at", { ascending: false }),
    ]);

  if (positionsError) throw new Error(positionsError.message);
  if (ordersError) throw new Error(ordersError.message);

  return {
    cash: Number(account.cash),
    feeRate: Number(account.fee_rate),
    positions: (positions ?? []).map((p) => ({
      symbol: p.symbol,
      qty: Number(p.qty),
      avgCost: Number(p.avg_cost),
    })),
    history: (orders ?? []).map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      qty: Number(o.qty),
      price: Number(o.price),
      fee: Number(o.fee),
      total: Number(o.total),
      ts: new Date(o.executed_at).getTime(),
    })),
  };
}

export async function saveTradingSnapshot(
  userId: string,
  snapshot: TradingSnapshot,
  newOrders: ExecutedOrder[],
) {
  const { error: accountError } = await supabase.from("trading_accounts").upsert(
    {
      user_id: userId,
      cash: snapshot.cash,
      fee_rate: snapshot.feeRate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (accountError) throw new Error(accountError.message);

  const currentSymbols = snapshot.positions.map((position) => position.symbol);
  if (currentSymbols.length) {
    const { error } = await supabase.from("positions").upsert(
      snapshot.positions.map((position) => ({
        user_id: userId,
        symbol: position.symbol,
        qty: position.qty,
        avg_cost: position.avgCost,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,symbol" },
    );
    if (error) throw new Error(error.message);
  }

  const deleteQuery = supabase.from("positions").delete().eq("user_id", userId);
  const { error: deleteError } = currentSymbols.length
    ? await deleteQuery.not("symbol", "in", `(${currentSymbols.map((s) => `"${s}"`).join(",")})`)
    : await deleteQuery;
  if (deleteError) throw new Error(deleteError.message);

  if (newOrders.length) {
    const orderRows = newOrders.map((order) => ({
      id: order.id,
      user_id: userId,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      price: order.price,
      fee: order.fee,
      total: order.total,
      source: "simulation",
      executed_at: new Date(order.ts).toISOString(),
    }));
    const { error } = await supabase.from("orders").insert(orderRows);
    if (error) throw new Error(error.message);

    // Mirror into transactions table for richer analytics
    const txRows = newOrders.map((order) => ({
      order_id: order.id,
      user_id: userId,
      symbol: order.symbol,
      side: order.side,
      quantity: order.qty,
      executed_price: order.price,
      total_amount: Math.abs(order.total),
      fee: order.fee,
      source: "simulation",
      created_at: new Date(order.ts).toISOString(),
    }));
    // Non-throwing: transactions is supplemental
    await supabase.from("transactions").insert(txRows);
  }
}
