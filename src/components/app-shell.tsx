import { AppSidebar } from "@/components/app-sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { getRealtimeAssets } from "@/lib/market";
import { loadLatestMarketData, subscribeToMarketData } from "@/lib/market-sync";
import { useTradingStore } from "@/lib/store";
import { loadTradingSnapshot } from "@/lib/trading-sync";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { Bell, Search, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const TOUR_DISMISSED_KEY = "finsight-tour-dismissed";
const TOUR_SLIDE_KEY = "finsight-docs-tour";

export function AppShell() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [showTourPrompt, setShowTourPrompt] = useState(false);
  const hydrateTradingState = useTradingStore((s) => s.hydrateTradingState);
  const resetTradingState = useTradingStore((s) => s.resetTradingState);
  const bumpMarketVersion = useTradingStore((s) => s.bumpMarketVersion);
  const marketVersion = useTradingStore((s) => s.marketVersion);
  const navigate = useNavigate();

  const searchResults = useMemo(() => {
    void marketVersion;
    const realtimeAssets = getRealtimeAssets();
    const needle = search.trim().toLowerCase();
    const list = needle
      ? realtimeAssets.filter(
          (asset) =>
            asset.symbol.toLowerCase().includes(needle) ||
            asset.name.toLowerCase().includes(needle) ||
            (asset.sector ?? asset.class).toLowerCase().includes(needle),
        )
      : realtimeAssets;
    return list.slice(0, 8);
  }, [search, marketVersion]);

  const alerts = useMemo(() => {
    void marketVersion;
    return [...getRealtimeAssets()]
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 8);
  }, [marketVersion]);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      resetTradingState();
      return;
    }
    loadTradingSnapshot(user.id)
      .then((snapshot) => {
        if (!cancelled) hydrateTradingState(snapshot);
      })
      .catch((error) => {
        console.error("[Trading sync] Could not load trading state", error);
        if (!cancelled) toast.error("Could not load saved trading state");
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, hydrateTradingState, resetTradingState]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    loadLatestMarketData()
      .then((snapshots) => {
        if (!cancelled && snapshots.length) bumpMarketVersion();
        return subscribeToMarketData(() => {
          if (!cancelled) bumpMarketVersion();
        });
      })
      .then((cleanup) => {
        if (cancelled) cleanup?.();
        else unsubscribe = cleanup;
      })
      .catch((error) => {
        console.error("[Market sync] Could not load latest market data", error);
        if (!cancelled) toast.error("Could not load latest market data");
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [bumpMarketVersion]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(TOUR_DISMISSED_KEY) === "true";
    if (!dismissed) {
      window.setTimeout(() => setShowTourPrompt(true), 700);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshMarketData = async () => {
      try {
        const [quotesResult, cryptoResult] = await Promise.all([
          supabase.functions.invoke("market-refresh", { body: { mode: "quotes" } }),
          supabase.functions.invoke("market-refresh", { body: { mode: "crypto" } }),
        ]);
        if (quotesResult.error) throw quotesResult.error;
        if (cryptoResult.error) throw cryptoResult.error;
      } catch (error) {
        if (!cancelled) {
          console.error("[Market refresh] Could not refresh market data", error);
        }
      }
    };

    void refreshMarketData();
    const intervalId = window.setInterval(
      () => {
        void refreshMarketData();
      },
      5 * 60 * 1000,
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-blue-100 bg-white/90 backdrop-blur px-3 sm:px-5 sticky top-0 z-30">
            <SidebarTrigger />
            <div className="hidden sm:flex items-center gap-2 small-caps text-[0.65rem] text-blue-600">
              <span>FinSight</span>
              <span className="opacity-40">/</span>
              <span>Market workspace</span>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <div className="flex-1 max-w-md ml-auto relative hidden md:block">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-blue-400" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search symbol, company, sector..."
                    className="pl-9 h-9 bg-blue-50/70 border-blue-100"
                  />
                </div>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[28rem] p-2">
                <div className="px-2 py-1.5 text-xs font-semibold text-blue-900">Market search</div>
                <div className="max-h-80 overflow-y-auto">
                  {searchResults.map((asset) => (
                    <Link
                      key={asset.symbol}
                      to="/asset/$symbol"
                      params={{ symbol: asset.symbol }}
                      className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-blue-50"
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-sm font-semibold">
                          {asset.symbol}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {asset.name}
                        </span>
                      </span>
                      <span
                        className={
                          asset.change >= 0
                            ? "font-mono text-xs text-emerald-600"
                            : "font-mono text-xs text-red-600"
                        }
                      >
                        {asset.change >= 0 ? "+" : ""}
                        {asset.change.toFixed(2)}%
                      </span>
                    </Link>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Sheet>
              <SheetTrigger asChild>
                <button className="ml-auto md:ml-0 h-9 w-9 relative grid place-items-center rounded-md border border-blue-100 hover:bg-blue-50 transition">
                  <Bell className="h-4 w-4" />
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
                </button>
              </SheetTrigger>
              <SheetContent className="w-full sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>Market notifications</SheetTitle>
                  <SheetDescription>
                    Current movers and trading reminders from the market board.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-5 space-y-2">
                  {alerts.map((asset) => {
                    const up = asset.change >= 0;
                    return (
                      <Link
                        key={asset.symbol}
                        to="/asset/$symbol"
                        params={{ symbol: asset.symbol }}
                        className="flex items-center gap-3 rounded-md border border-blue-100 p-3 hover:bg-blue-50"
                      >
                        {up ? (
                          <TrendingUp className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-red-600" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-sm font-semibold">
                            {asset.symbol}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {asset.sector ?? asset.class} - {asset.name}
                          </span>
                        </span>
                        <span
                          className={
                            up
                              ? "font-mono text-sm text-emerald-600"
                              : "font-mono text-sm text-red-600"
                          }
                        >
                          {up ? "+" : ""}
                          {asset.change.toFixed(2)}%
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </SheetContent>
            </Sheet>
          </header>
          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>

      <Dialog
        open={showTourPrompt}
        onOpenChange={(open) => {
          setShowTourPrompt(open);
          if (!open) {
            window.localStorage.setItem(TOUR_DISMISSED_KEY, "true");
          }
        }}
      >
        <DialogContent className="max-w-md border-blue-100 bg-white">
          <DialogHeader>
            <DialogTitle className="text-blue-950">Welcome to FinSight</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              This app has a short guided tour for first-time users. It shows where to trade, where
              to open asset detail, and how to review your portfolio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-md bg-blue-50 p-4 text-sm text-blue-950">
            <div className="font-semibold">What the tour covers</div>
            <ul className="space-y-1 text-muted-foreground">
              <li>- Trading board and filters</li>
              <li>- Buy / sell flow with basket review</li>
              <li>- Asset detail pages and chart tabs</li>
            </ul>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                window.localStorage.setItem(TOUR_DISMISSED_KEY, "true");
                setShowTourPrompt(false);
              }}
            >
              Skip for now
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                window.localStorage.setItem(TOUR_DISMISSED_KEY, "true");
                window.localStorage.setItem(TOUR_SLIDE_KEY, "welcome");
                setShowTourPrompt(false);
                navigate({ to: "/docs" });
              }}
            >
              Start tour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
