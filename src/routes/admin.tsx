import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader, PageBody } from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  demoteUserFromAdmin,
  listAllUserSummaries,
  promoteUserToAdmin,
} from "@/lib/admin.functions";
import { useAuth } from "@/hooks/use-auth";
import { ShieldAlert, Users, Activity, ShieldCheck, ShieldMinus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { formatVnd } from "@/lib/currency";

const ROOT_ADMIN_EMAIL = "admin@isbaweb.com";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin - FinSight" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { role, loading } = useAuth();
  const fetchAll = useServerFn(listAllUserSummaries);
  const promote = useServerFn(promoteUserToAdmin);
  const demote = useServerFn(demoteUserFromAdmin);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetchAll(),
    enabled: role === "admin",
  });

  const promoteMutation = useMutation({
    mutationFn: (userId: string) => promote({ data: { userId } }),
    onSuccess: () => {
      toast.success("Admin access granted");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not grant admin access"),
  });

  const demoteMutation = useMutation({
    mutationFn: (userId: string) => demote({ data: { userId } }),
    onSuccess: () => {
      toast.success("Admin access removed");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove admin access"),
  });

  if (loading)
    return (
      <PageBody>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </PageBody>
    );
  if (role !== "admin") {
    return (
      <PageBody>
        <Card className="p-8 text-center">
          <ShieldAlert className="h-8 w-8 mx-auto text-warning" />
          <h2 className="mt-3 font-serif text-lg font-semibold">Admin only</h2>
          <p className="text-sm text-muted-foreground">
            Your account does not have admin privileges.
          </p>
        </Card>
      </PageBody>
    );
  }

  const users = data?.users ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Admin - Oversight"
        title="User behavior dashboard"
        description="All registered users, portfolio value, trade activity, and the latest AI behavioral summary saved from Portfolio analysis."
      />
      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Stat icon={Users} label="Registered users" value={users.length} />
          <Stat
            icon={Activity}
            label="Total trades"
            value={users.reduce((a, u) => a + (u.orderCount ?? 0), 0)}
          />
          <Stat
            icon={Activity}
            label="Users with activity"
            value={users.filter((u) => u.latest || (u.orderCount ?? 0) > 0).length}
          />
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b bg-muted/30">
            <h3 className="font-serif text-base font-semibold">All users</h3>
          </div>
          {isLoading && <p className="p-5 text-sm text-muted-foreground">Loading users...</p>}
          {error && <p className="p-5 text-sm text-destructive">{(error as Error).message}</p>}
          <div className="divide-y">
            {users.map((u) => (
              <div key={u.id} className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <UserIdentity user={u} />
                  <UserAdminActions
                    user={u}
                    promotePending={promoteMutation.isPending}
                    demotePending={demoteMutation.isPending}
                    onPromote={() => promoteMutation.mutate(u.id)}
                    onDemote={() => demoteMutation.mutate(u.id)}
                  />
                  <GameSnapshot user={u} totalUsers={users.length} />
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                  <TradeOverview user={u} />
                  <RecentTrades orders={u.recentOrders ?? []} />
                  <SavedSummaries summaries={u.summaries ?? []} />
                </div>
              </div>
            ))}
            {!isLoading && users.length === 0 && (
              <p className="p-5 text-sm text-muted-foreground">No users yet.</p>
            )}
          </div>
        </Card>
      </PageBody>
    </>
  );
}

type AdminSummary = {
  id?: string;
  summary?: string | null;
  created_at: string;
  portfolio_value?: number | string | null;
  trade_count?: number | null;
  basket_size?: number | null;
};

type AdminOrder = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  fee: number;
  total: number;
  executed_at: string;
};

type AdminPosition = {
  symbol: string;
  qty: number;
  avg_cost: number;
};

type AdminUser = {
  id: string;
  display_name?: string | null;
  email?: string | null;
  created_at: string;
  roles?: string[];
  latest?: AdminSummary | null;
  summaries?: AdminSummary[];
  count?: number;
  orderCount?: number;
  cash?: number | string | null;
  recentOrders?: AdminOrder[];
  positions?: AdminPosition[];
  tradeStats?: {
    buyCount: number;
    sellCount: number;
    totalFees: number;
    notional: number;
    netCashFlow: number;
  };
  game?: {
    xp: number;
    level: number;
    score: number;
    rank: number;
  };
};

function UserIdentity({ user }: { user: AdminUser }) {
  return (
    <div>
      <div className="font-medium">{user.display_name ?? "-"}</div>
      <div className="text-xs text-muted-foreground">{user.email}</div>
      <div className="text-[0.65rem] small-caps text-muted-foreground mt-1">
        Joined {new Date(user.created_at).toLocaleDateString("en-US")}
      </div>
      <div className="flex gap-1.5 mt-2 flex-wrap">
        {(user.roles?.length ? user.roles : ["user"]).map((userRole) => (
          <Badge
            key={userRole}
            variant={userRole === "admin" ? "secondary" : "outline"}
            className="capitalize"
          >
            {userRole}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function UserAdminActions({
  user,
  promotePending,
  demotePending,
  onPromote,
  onDemote,
}: {
  user: AdminUser;
  promotePending: boolean;
  demotePending: boolean;
  onPromote: () => void;
  onDemote: () => void;
}) {
  return (
    <div className="text-sm">
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline">{user.count ?? 0} summaries</Badge>
        {user.latest?.portfolio_value != null && (
          <Badge variant="outline" className="font-mono">
            {formatCurrency(Number(user.latest.portfolio_value))}
          </Badge>
        )}
        <Badge variant="outline">{user.orderCount ?? 0} trades</Badge>
        {user.cash != null && (
          <Badge variant="outline" className="font-mono">
            Cash {formatCurrency(Number(user.cash))}
          </Badge>
        )}
      </div>
      {!user.roles?.includes("admin") ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-3 gap-1.5"
          disabled={promotePending}
          onClick={onPromote}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Make admin
        </Button>
      ) : (
        user.email?.toLowerCase() !== ROOT_ADMIN_EMAIL && (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 gap-1.5 text-destructive hover:text-destructive"
            disabled={demotePending}
            onClick={onDemote}
          >
            <ShieldMinus className="h-3.5 w-3.5" />
            Remove admin
          </Button>
        )
      )}
    </div>
  );
}

function GameSnapshot({ user, totalUsers }: { user: AdminUser; totalUsers: number }) {
  const latestValue =
    user.latest?.portfolio_value != null
      ? formatCurrency(Number(user.latest.portfolio_value))
      : "No analysis";
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm">
      <div className="font-medium">Game snapshot</div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="Rank" value={`#${user.game?.rank ?? totalUsers}`} />
        <Metric label="Level" value={user.game?.level ?? 1} />
        <Metric label="XP" value={(user.game?.xp ?? 0).toLocaleString("en-US")} />
      </div>
    </div>
  );
}

function TradeOverview({ user }: { user: AdminUser }) {
  const stats = user.tradeStats;
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm">
      <div className="font-medium">Trade overview</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Buys" value={stats?.buyCount ?? 0} />
        <Metric label="Sells" value={stats?.sellCount ?? 0} />
        <Metric label="Notional" value={formatCurrency(stats?.notional ?? 0)} />
        <Metric label="Fees" value={formatCurrency(stats?.totalFees ?? 0)} />
        <Metric label="Cash flow" value={formatCurrency(stats?.netCashFlow ?? 0)} />
        <Metric label="Open positions" value={user.positions?.length ?? 0} />
      </div>
      <div className="mt-4">
        <div className="text-xs font-medium text-muted-foreground">Positions</div>
        {user.positions?.length ? (
          <div className="mt-2 space-y-1.5">
            {user.positions.map((position) => (
              <div
                key={position.symbol}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="font-medium">{position.symbol}</span>
                <span className="text-muted-foreground">
                  {formatNumber(position.qty)} @ {formatCurrency(position.avg_cost)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground italic">No open positions.</p>
        )}
      </div>
    </div>
  );
}

function RecentTrades({ orders }: { orders: AdminOrder[] }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm">
      <div className="font-medium">Recent trades</div>
      {orders.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 text-left font-medium">Time</th>
                <th className="py-1.5 text-left font-medium">Order</th>
                <th className="py-1.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 text-muted-foreground">
                    {formatDateTime(order.executed_at)}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="font-medium">
                      <span className={order.side === "buy" ? "text-success" : "text-warning"}>
                        {order.side.toUpperCase()}
                      </span>{" "}
                      {formatNumber(order.qty)} {order.symbol}
                    </div>
                    <div className="text-muted-foreground">
                      @ {formatCurrency(order.price)} fee {formatCurrency(order.fee)}
                    </div>
                  </td>
                  <td className="py-2 text-right font-mono">{formatCurrency(order.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground italic">No trades yet.</p>
      )}
    </div>
  );
}

function SavedSummaries({ summaries }: { summaries: AdminSummary[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm">
      <div className="font-medium">Saved summaries</div>
      {summaries.length ? (
        <div className="mt-3 space-y-3">
          {summaries.map((summary) => {
            const key = summary.id ?? summary.created_at;
            const isExpanded = Boolean(expanded[key]);
            const hasLongSummary = (summary.summary?.length ?? 0) > 180;
            return (
              <div key={key} className="text-xs">
                <div className="flex gap-1.5 flex-wrap">
                  {summary.portfolio_value != null && (
                    <Badge variant="outline" className="font-mono">
                      {formatCurrency(Number(summary.portfolio_value))}
                    </Badge>
                  )}
                  <Badge variant="outline">{summary.trade_count ?? 0} trades</Badge>
                  <Badge variant="outline">Basket {summary.basket_size ?? 0}</Badge>
                </div>
                <p
                  className={
                    isExpanded
                      ? "mt-2 text-muted-foreground"
                      : "mt-2 text-muted-foreground line-clamp-3"
                  }
                >
                  {summary.summary}
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="text-[0.65rem] small-caps text-muted-foreground">
                    {formatDateTime(summary.created_at)}
                  </div>
                  {hasLongSummary && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setExpanded((current) => ({ ...current, [key]: !isExpanded }))}
                    >
                      {isExpanded ? "Show less" : "View more"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground italic">No saved summaries.</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border bg-background/60 px-2.5 py-2">
      <div className="text-[0.65rem] small-caps text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-xs">{value}</div>
    </div>
  );
}

function formatCurrency(value: number) {
  return formatVnd(value, Math.abs(value) >= 1000 ? 0 : 2);
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="small-caps text-[0.65rem] text-muted-foreground">{label}</div>
        <div className="font-serif text-xl font-semibold">{value}</div>
      </div>
    </Card>
  );
}
