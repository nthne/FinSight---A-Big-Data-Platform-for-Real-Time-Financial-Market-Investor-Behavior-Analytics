import { createServerFn } from "@tanstack/react-start";

import {
  buildTradeEvent,
  type TradeRecord,
} from "../../ingestion/producers/app_event_producer";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { analyticsUserSalt, emitAnalyticsEvent } from "@/lib/analytics-events.server";

export const publishTradeEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderIds: string[] }) => ({
    orderIds: [...new Set(data.orderIds)].slice(0, 100),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const salt = analyticsUserSalt();
    if (!salt || data.orderIds.length === 0) {
      return { requested: data.orderIds.length, delivered: 0, skipped: true };
    }

    const { data: orders, error } = await supabase
      .from("orders")
      .select(
        "id, symbol, side, qty, price, fee, total, order_kind, status, executed_at",
      )
      .eq("user_id", userId)
      .in("id", data.orderIds);
    if (error) throw new Error(error.message);

    let delivered = 0;
    for (const order of orders ?? []) {
      const record: TradeRecord = {
        id: order.id,
        userId,
        symbol: order.symbol,
        side: order.side,
        quantity: Number(order.qty),
        price: Number(order.price),
        fee: Number(order.fee),
        total: Number(order.total),
        orderKind: order.order_kind,
        status: order.status,
        executedAt: order.executed_at,
      };
      if (await emitAnalyticsEvent(buildTradeEvent(record, salt))) delivered += 1;
    }

    return {
      requested: data.orderIds.length,
      delivered,
      skipped: false,
    };
  });
