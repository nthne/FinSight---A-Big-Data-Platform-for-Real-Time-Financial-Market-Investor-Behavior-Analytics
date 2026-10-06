import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageBody } from "@/components/section-heading";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Compass,
  Crown,
  Shield,
  Trophy,
  Zap,
  Target,
  CheckCircle2,
  Clock,
  Star,
  Lock,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listLeaderboardEntries } from "@/lib/admin.functions";
import {
  getMyXp,
  getAchievementsWithStatus,
  getChallengesWithStatus,
  joinChallenge,
  unlockAchievement,
  upsertMyXp,
} from "@/lib/user-data.functions";
import { useEffect } from "react";
import { useTradingStore } from "@/lib/store";
import { formatVnd } from "@/lib/currency";
import { toast } from "sonner";

export const Route = createFileRoute("/gamification")({
  head: () => ({
    meta: [
      { title: "Gamification - FinSight" },
      {
        name: "description",
        content: "XP, levels, achievements, scenario challenges and leaderboard.",
      },
    ],
  }),
  component: Gamification,
});

const ACHIEVEMENT_ICON_MAP: Record<string, React.ElementType> = {
  first_trade: Zap,
  portfolio_review: Crown,
  diversified: Compass,
};

const CHALLENGE_STATUS_COLOR: Record<string, string> = {
  joined: "text-blue-600 bg-blue-50 border-blue-200",
  completed: "text-green-600 bg-green-50 border-green-200",
  failed: "text-red-600 bg-red-50 border-red-200",
  abandoned: "text-gray-500 bg-gray-50 border-gray-200",
};

function Gamification() {
  const fetchLeaderboard = useServerFn(listLeaderboardEntries);
  const fetchXp = useServerFn(getMyXp);
  const fetchAchievements = useServerFn(getAchievementsWithStatus);
  const fetchChallenges = useServerFn(getChallengesWithStatus);
  const doJoinChallenge = useServerFn(joinChallenge);
  const queryClient = useQueryClient();

  const { data: leaderboardData, isLoading: lbLoading, error: lbError } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => fetchLeaderboard(),
  });
  const { data: xpData } = useQuery({
    queryKey: ["my-xp"],
    queryFn: () => fetchXp(),
  });
  const { data: achievementsData, isLoading: achLoading } = useQuery({
    queryKey: ["my-achievements"],
    queryFn: () => fetchAchievements(),
  });
  const { data: challengesData, isLoading: chalLoading } = useQuery({
    queryKey: ["my-challenges"],
    queryFn: () => fetchChallenges(),
  });

  const board = leaderboardData?.users ?? [];
  const positions = useTradingStore((s) => s.positions);
  const history = useTradingStore((s) => s.history);

  const achievements = achievementsData?.achievements ?? [];
  const dbChallenges = challengesData?.challenges ?? [];

  // Re-calculate XP from actually earned achievements so it doesn't drop to 0
  const earnedXp = achievements
    .filter((a) => a.earned)
    .reduce((sum, a) => sum + (a.xp_reward || 0), 0);

  // XP: strictly use DB value but fallback to minimum earnedXP
  const dbXp = xpData?.xp;
  const dbTotal = dbXp ? dbXp.total_xp : 0;
  const totalXp = Math.max(dbTotal, earnedXp);
  const dbLevel = dbXp?.level ?? null;
  const level = dbLevel ? parseInt(dbLevel.replace(/\D/g, "") || "1") : Math.floor(totalXp / 500) + 1;
  const currentLevelXp = totalXp % 500;
  const progress = (currentLevelXp / 500) * 100;
  const today = new Date().toISOString().slice(0, 10);
  const todayTrades = history.filter(
    (order) => new Date(order.ts).toISOString().slice(0, 10) === today,
  ).length;

  const doUnlockAchievement = useServerFn(unlockAchievement);
  const doUpsertXp = useServerFn(upsertMyXp);

  // Auto-sync XP if db is lagging behind earned XP
  useEffect(() => {
    if (earnedXp > dbTotal && totalXp > 0) {
      const calculatedLevel = Math.floor(totalXp / 500) + 1;
      doUpsertXp({ data: { totalXp: totalXp, level: `Level ${calculatedLevel}` } })
        .then(() => queryClient.invalidateQueries({ queryKey: ["my-xp"] }))
        .catch(() => {});
    }
  }, [earnedXp, dbTotal, totalXp, doUpsertXp, queryClient]);

  // Auto-unlock achievements if conditions are met
  useEffect(() => {
    if (achievements.length === 0) return;
    
    for (const ach of achievements) {
      if (ach.earned) continue;
      
      let conditionMet = false;
      if (ach.code === "first_trade") conditionMet = history.length > 0;
      else if (ach.code === "risk_manager") conditionMet = history.length > 0 && todayTrades <= 5;
      else if (ach.code === "diversified") conditionMet = positions.length >= 3;
      else if (ach.code === "portfolio_review") conditionMet = board.some((p) => p.you && p.tradeCount > 0);
      
      if (conditionMet) {
        doUnlockAchievement({ data: { achievementId: ach.achievement_id } })
          .then(() => {
             toast.success(`Achievement Unlocked: ${ach.name}!`);
             queryClient.invalidateQueries({ queryKey: ["my-achievements"] });
          })
          .catch(() => {});
      }
    }
  }, [achievements, history.length, todayTrades, positions.length, board, doUnlockAchievement, queryClient]);

  async function handleJoin(challengeId: string) {
    try {
      await doJoinChallenge({ data: { challengeId } });
      await queryClient.invalidateQueries({ queryKey: ["my-challenges"] });
      toast.success("Joined challenge!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to join");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="System Feature 4.3 - Gamification"
        title="Progress & play"
        description="XP, level progression, achievements, and leaderboard are derived from real simulation activity."
      />
      <PageBody>
        {/* ── XP CARD ── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-6 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
            <div className="flex items-start justify-between">
              <div>
                <div className="small-caps text-[0.65rem] opacity-80">
                  Level {level} - Simulation Investor
                </div>
                <h2 className="font-serif text-3xl font-semibold mt-1">
                  {totalXp.toLocaleString("en-US")} XP
                </h2>
                <p className="text-sm opacity-80 mt-1">
                  {500 - currentLevelXp} XP to Level {level + 1}
                </p>
              </div>
              <Trophy className="h-10 w-10 opacity-80" />
            </div>
            <div className="mt-5 h-2 rounded-full bg-primary-foreground/20 overflow-hidden">
              <div className="h-full bg-primary-foreground transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-4 mt-6 text-sm">
              <div>
                <div className="opacity-70 text-xs">Today</div>
                <div className="font-mono num text-lg">+{todayTrades * 50} XP</div>
              </div>
              <div>
                <div className="opacity-70 text-xs">Trades</div>
                <div className="font-mono num text-lg">{history.length}</div>
              </div>
              <div>
                <div className="opacity-70 text-xs">Positions</div>
                <div className="font-mono num text-lg">{positions.length}</div>
              </div>
            </div>
            {dbXp && (
              <div className="mt-3 pt-3 border-t border-primary-foreground/20 text-xs opacity-70">
                Synced from database · Last updated {new Date(dbXp.updated_at).toLocaleDateString()}
              </div>
            )}
          </Card>

          {/* ── CHALLENGES CARD (next challenge) ── */}
          <Card className="p-5">
            <div className="small-caps text-[0.65rem] text-muted-foreground">
              {dbChallenges.length > 0 ? "Active challenges" : "Next challenge"}
            </div>
            {chalLoading ? (
              <p className="text-sm text-muted-foreground mt-3">Loading...</p>
            ) : dbChallenges.length === 0 ? (
              <>
                <h3 className="font-serif text-xl font-semibold mt-1">
                  {positions.length >= 3 ? "Behavior Review" : "Build Diversification"}
                </h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  {positions.length >= 3
                    ? "Run Portfolio analysis and save the AI behavioral summary."
                    : "Hold positions in at least 3 different instruments to unlock the diversified achievement."}
                </p>
                <div className="flex items-center gap-2 mt-3 text-xs">
                  <Badge variant="secondary">{positions.length}/3 positions</Badge>
                  <Badge variant="secondary">+150 XP</Badge>
                </div>
              </>
            ) : (
              <div className="space-y-3 mt-3">
                {dbChallenges.slice(0, 2).map((c) => {
                  const uc = c.userChallenge;
                  return (
                    <div key={c.challenge_id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm">{c.title}</div>
                        {uc ? (
                          <Badge
                            variant="outline"
                            className={`text-[0.6rem] capitalize shrink-0 ${CHALLENGE_STATUS_COLOR[uc.status] ?? ""}`}
                          >
                            {uc.status}
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            className="h-7 text-xs shrink-0"
                            onClick={() => handleJoin(c.challenge_id)}
                          >
                            Join
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{c.description}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="secondary" className="text-[0.6rem]">
                          <Star className="h-2.5 w-2.5 mr-1" />+{c.reward_xp} XP
                        </Badge>
                        <Badge variant="outline" className="text-[0.6rem] capitalize">{c.challenge_type}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </section>

        {/* ── ACHIEVEMENTS ── */}
        <section>
          <h3 className="font-serif text-xl font-semibold mb-4">Achievements</h3>
          {achLoading ? (
            <p className="text-sm text-muted-foreground">Loading achievements...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {achievements.map((a) => {
                const IconComp = ACHIEVEMENT_ICON_MAP[a.code] ?? Shield;
                return (
                  <Card key={a.achievement_id} className={`p-5 ${a.earned ? "" : "opacity-55"}`}>
                    <div className={`h-10 w-10 rounded-lg grid place-items-center ${a.earned ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
                      {a.earned ? <IconComp className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                    </div>
                    <div className="font-serif text-lg font-semibold mt-3">{a.name}</div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{a.description}</p>
                    <div className="flex items-center justify-between mt-3">
                      <div className="small-caps text-[0.6rem] text-muted-foreground">
                        {a.earned ? (
                          <span className="text-accent-foreground flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Unlocked
                          </span>
                        ) : (
                          "Locked"
                        )}
                      </div>
                      <Badge variant="secondary" className="text-[0.6rem]">
                        +{a.xp_reward} XP
                      </Badge>
                    </div>
                    {a.achievedAt && (
                      <div className="text-[0.6rem] text-muted-foreground mt-1 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {new Date(a.achievedAt).toLocaleDateString()}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ── FULL CHALLENGES LIST ── */}
        {dbChallenges.length > 2 && (
          <section>
            <h3 className="font-serif text-xl font-semibold mb-4">All challenges</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {dbChallenges.map((c) => {
                const uc = c.userChallenge;
                return (
                  <Card key={c.challenge_id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Target className="h-4 w-4 text-primary shrink-0" />
                          <h4 className="font-semibold">{c.title}</h4>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{c.description}</p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <Badge variant="secondary" className="text-[0.6rem]">
                            <Star className="h-2.5 w-2.5 mr-1" />+{c.reward_xp} XP
                          </Badge>
                          <Badge variant="outline" className="text-[0.6rem] capitalize">{c.challenge_type}</Badge>
                          {c.end_at && (
                            <Badge variant="outline" className="text-[0.6rem]">
                              <Clock className="h-2.5 w-2.5 mr-1" />
                              Ends {new Date(c.end_at).toLocaleDateString()}
                            </Badge>
                          )}
                        </div>
                        {uc && (
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-muted-foreground">Score</span>
                              <span className="font-mono">{Number(uc.score).toFixed(0)}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${Math.min(100, Number(uc.score))}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        {uc ? (
                          <Badge
                            variant="outline"
                            className={`capitalize ${CHALLENGE_STATUS_COLOR[uc.status] ?? ""}`}
                          >
                            {uc.status}
                          </Badge>
                        ) : (
                          <Button size="sm" onClick={() => handleJoin(c.challenge_id)}>
                            Join
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* ── LEADERBOARD ── */}
        <Card className="p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="font-serif text-xl font-semibold">Leaderboard</h3>
            <span className="text-xs text-muted-foreground">
              Ranked by database leaderboard snapshots
            </span>
          </div>
          <div className="divide-y">
            {lbLoading && <p className="py-4 text-sm text-muted-foreground">Loading users...</p>}
            {lbError && <p className="py-4 text-sm text-destructive">{(lbError as Error).message}</p>}
            {board.map((p) => (
              <div
                key={p.rank}
                className={`flex items-center gap-4 py-3 ${p.you ? "bg-accent/40 -mx-5 px-5 rounded" : ""}`}
              >
                <div className="font-serif text-2xl font-semibold w-10 text-center text-muted-foreground">
                  {p.rank}
                </div>
                <div className="h-9 w-9 rounded-full bg-muted grid place-items-center text-xs font-semibold">
                  {p.name.split(" ").map((s) => s[0]).join("").slice(0, 2)}
                </div>
                <div className="flex-1">
                  <div className="font-medium">
                    {p.name}{" "}
                    {p.you && (
                      <Badge variant="secondary" className="ml-2 text-[0.6rem]">You</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono num">
                    {formatVnd(p.portfolioValue, 0)} - {p.tradeCount} trades
                  </div>
                </div>
                <div className="font-mono num text-success font-semibold">{p.ret}</div>
              </div>
            ))}
            {!lbLoading && board.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">No users yet.</p>
            )}
          </div>
        </Card>
      </PageBody>
    </>
  );
}
