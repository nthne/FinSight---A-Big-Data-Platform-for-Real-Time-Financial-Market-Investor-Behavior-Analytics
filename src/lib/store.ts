import { create } from "zustand";
import { ASSETS, getAsset } from "./market";
import { formatVnd } from "./currency";
import { INITIAL_CASH } from "./simulation";

export type Side = "buy" | "sell";
export type OrderType = "Market" | "Limit" | "Stop";

export interface BasketLine {
  symbol: string;
  side: Side;
  qty: number;
  type: OrderType;
  limitPrice?: number;
}

export interface Position {
  symbol: string;
  qty: number; // signed; negative = short
  avgCost: number;
}

export interface ExecutedOrder {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  fee: number;
  total: number; // signed cash flow (negative = cash out)
  ts: number;
}

interface State {
  cash: number;
  feeRate: number; // 0.0005 = 0.05%
  basket: BasketLine[];
  positions: Position[];
  history: ExecutedOrder[];
  hydrated: boolean;
  marketVersion: number;
  addToBasket: (line: BasketLine) => void;
  updateBasket: (i: number, patch: Partial<BasketLine>) => void;
  removeFromBasket: (i: number) => void;
  clearBasket: () => void;
  executeBasket: () => { ok: boolean; reason?: string; orders?: ExecutedOrder[] };
  hydrateTradingState: (snapshot: {
    cash: number;
    feeRate: number;
    positions: Position[];
    history: ExecutedOrder[];
  }) => void;
  resetTradingState: () => void;
  bumpMarketVersion: () => void;
}

export const useTradingStore = create<State>((set, get) => ({
  cash: INITIAL_CASH,
  feeRate: 0.0005,
  basket: [],
  positions: [],
  history: [],
  hydrated: false,
  marketVersion: 0,
  addToBasket: (line) =>
    set((s) => {
      const idx = s.basket.findIndex((b) => b.symbol === line.symbol && b.side === line.side);
      if (idx >= 0) {
        const next = [...s.basket];
        next[idx] = { ...next[idx], qty: next[idx].qty + line.qty };
        return { basket: next };
      }
      return { basket: [...s.basket, line] };
    }),
  updateBasket: (i, patch) =>
    set((s) => {
      const next = [...s.basket];
      next[i] = { ...next[i], ...patch };
      return { basket: next };
    }),
  removeFromBasket: (i) => set((s) => ({ basket: s.basket.filter((_, idx) => idx !== i) })),
  clearBasket: () => set({ basket: [] }),
  executeBasket: () => {
    const s = get();
    if (s.basket.length === 0) return { ok: false, reason: "Basket is empty" };
    let cash = s.cash;
    const positions = [...s.positions];
    const orders: ExecutedOrder[] = [];
    for (const line of s.basket) {
      const a = getAsset(line.symbol);
      if (!a) continue;
      const px = line.type === "Limit" && line.limitPrice ? line.limitPrice : a.price;
      const notional = px * line.qty;
      const fee = +(notional * s.feeRate).toFixed(2);
      if (line.side === "buy") {
        const totalCost = notional + fee;
        if (totalCost > cash) {
          return {
            ok: false,
            reason: `Insufficient cash for ${line.symbol} (need ${formatVnd(totalCost, 2)})`,
          };
        }
        cash -= totalCost;
        const idx = positions.findIndex((p) => p.symbol === line.symbol);
        if (idx >= 0) {
          const p = positions[idx];
          const newQty = p.qty + line.qty;
          const newAvg = (p.avgCost * p.qty + px * line.qty) / newQty;
          positions[idx] = { ...p, qty: newQty, avgCost: +newAvg.toFixed(2) };
        } else {
          positions.push({ symbol: line.symbol, qty: line.qty, avgCost: px });
        }
        orders.push({
          id: crypto.randomUUID(),
          symbol: line.symbol,
          side: "buy",
          qty: line.qty,
          price: px,
          fee,
          total: -totalCost,
          ts: Date.now(),
        });
      } else {
        const idx = positions.findIndex((p) => p.symbol === line.symbol);
        if (idx < 0 || positions[idx].qty < line.qty) {
          return { ok: false, reason: `Not enough ${line.symbol} to sell` };
        }
        const proceeds = notional - fee;
        cash += proceeds;
        const p = positions[idx];
        const remaining = p.qty - line.qty;
        if (remaining === 0) positions.splice(idx, 1);
        else positions[idx] = { ...p, qty: remaining };
        orders.push({
          id: crypto.randomUUID(),
          symbol: line.symbol,
          side: "sell",
          qty: line.qty,
          price: px,
          fee,
          total: proceeds,
          ts: Date.now(),
        });
      }
    }
    set({ cash: +cash.toFixed(2), positions, basket: [], history: [...orders, ...s.history] });
    return { ok: true, orders };
  },
  hydrateTradingState: (snapshot) =>
    set({
      cash: snapshot.cash,
      feeRate: snapshot.feeRate,
      positions: snapshot.positions,
      history: snapshot.history,
      basket: [],
      hydrated: true,
    }),
  resetTradingState: () =>
    set({
      cash: INITIAL_CASH,
      feeRate: 0.0005,
      basket: [],
      positions: [],
      history: [],
      hydrated: false,
    }),
  bumpMarketVersion: () => set((s) => ({ marketVersion: s.marketVersion + 1 })),
}));

export function portfolioValue(positions: Position[], cash: number) {
  let equity = cash;
  for (const p of positions) {
    const a = ASSETS.find((x) => x.symbol === p.symbol);
    if (a) equity += a.price * p.qty;
  }
  return equity;
}
