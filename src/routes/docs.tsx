import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChartCandlestick,
  CircleCheckBig,
  Compass,
  LayoutDashboard,
  MousePointerClick,
  Search,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Trophy,
  WalletCards,
} from "lucide-react";
import { PageBody, PageHeader } from "@/components/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const TOUR_KEY = "finsight-docs-tour";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "User guide - FinSight" },
      {
        name: "description",
        content:
          "Interactive onboarding guide for first-time users to learn trading, asset details, and portfolio review.",
      },
    ],
  }),
  component: Docs,
});

type SlideId = "welcome" | "trading" | "buy-sell" | "asset-detail" | "portfolio" | "gamification";

const slides: Array<{
  id: SlideId;
  eyebrow: string;
  title: string;
  summary: string;
  accent: string;
  icon: typeof Compass;
  bullets: string[];
  actionLabel: string;
  actionTo: string;
  actionHint: string;
  previewTitle: string;
  previewBody: string;
  previewPills: string[];
}> = [
  {
    id: "welcome",
    eyebrow: "Step 1",
    title: "Welcome to FinSight",
    summary:
      "Day one starts here. This tour shows the main places to click, what each screen is for, and how to move from browsing to trading with confidence.",
    accent: "from-blue-50 to-white",
    icon: Compass,
    bullets: [
      "Overview shows your portfolio value, cash, market pulse, and behavioral score.",
      "Trading is where you search assets, compare sectors, and place simulated orders.",
      "Asset detail pages are where you inspect charts, fundamentals, news, and tabs.",
    ],
    actionLabel: "Open overview",
    actionTo: "/",
    actionHint: "See your live portfolio snapshot first.",
    previewTitle: "What you will learn",
    previewBody:
      "Start with the app overview, then move to Trading, and finally open any asset to inspect its details.",
    previewPills: ["Portfolio", "Trading", "Asset detail", "Behavioral"],
  },
  {
    id: "trading",
    eyebrow: "Step 2",
    title: "Find the right asset fast",
    summary:
      "The Trading page is built for scanning. Use sector tabs, search, and timeframe selector to narrow the board down to what you want.",
    accent: "from-sky-50 to-white",
    icon: Search,
    bullets: [
      "Sector tabs help you focus on Banking, Technology, Crypto, ETF, and more.",
      "Search supports symbol, company name, and sector keywords.",
      "The 1D / 1W / 1M / 1Y selector changes the change column and the comparison cards.",
    ],
    actionLabel: "Go to Trading",
    actionTo: "/trading",
    actionHint: "Open the live market board.",
    previewTitle: "Trading board",
    previewBody:
      "Use the search box and filters on top of the table. The right side shows gainers, losers, and the basket you are building.",
    previewPills: ["Sector tabs", "Search", "Timeframe", "Top movers"],
  },
  {
    id: "buy-sell",
    eyebrow: "Step 3",
    title: "Buy and sell in a few clicks",
    summary:
      "You do not need to memorize anything. Pick a row, choose Buy or Sell, send it to the basket, then review the basket before execution.",
    accent: "from-emerald-50 to-white",
    icon: ShoppingBasket,
    bullets: [
      "Click Buy or Sell in any row to add that asset to the basket immediately.",
      "Adjust quantity and order type in the Quick Order panel on the right.",
      "Review totals, fees, and net cash impact before hitting Execute.",
    ],
    actionLabel: "Try an order",
    actionTo: "/trading",
    actionHint: "Open the trading desk and add a line to the basket.",
    previewTitle: "Order flow",
    previewBody:
      "The basket is your staging area. Nothing is executed until you review quantity, type, and totals on the side panel.",
    previewPills: ["Buy", "Sell", "Qty", "Execute"],
  },
  {
    id: "asset-detail",
    eyebrow: "Step 4",
    title: "Open an asset for deeper detail",
    summary:
      "Every symbol is clickable. Once inside an asset page, you can inspect the price chart, fundamentals, news, and behavioral tabs for the selected company.",
    accent: "from-violet-50 to-white",
    icon: ChartCandlestick,
    bullets: [
      "Click any symbol from Trading or the overview watchlist to open the asset page.",
      "The chart shows the price trend and volume together for a clearer read.",
      "Tabs separate overview, fundamentals, news, and behavioral notes so the page stays readable.",
    ],
    actionLabel: "Open VCB detail",
    actionTo: "/asset/VCB",
    actionHint: "Jump straight into one asset page.",
    previewTitle: "Asset detail",
    previewBody:
      "This is where the chart, 52-week range, P/E, dividend, and news all live together.",
    previewPills: ["Chart", "Fundamentals", "News", "Behavioral"],
  },
  {
    id: "portfolio",
    eyebrow: "Step 5",
    title: "Track portfolio and learn from your trades",
    summary:
      "After trading, the app keeps the story. Portfolio, trade history, saved summaries, and behavioral analytics help you understand what happened and why.",
    accent: "from-amber-50 to-white",
    icon: WalletCards,
    bullets: [
      "Overview shows cash, holdings, realized activity, and market pulse at a glance.",
      "Behavioral analytics summarizes frequency, diversification, and risk signals.",
      "Admins can review user trade activity and summaries from the admin area.",
    ],
    actionLabel: "Back to overview",
    actionTo: "/",
    actionHint: "Return to your live dashboard.",
    previewTitle: "What comes next",
    previewBody:
      "Use the overview for quick status checks, the asset page for detail, and the behavioral page to read your trading habits.",
    previewPills: ["Portfolio", "Summaries", "Signals", "Admin"],
  },
  {
    id: "gamification",
    eyebrow: "Step 6",
    title: "Real-time Data & Gamification",
    summary:
      "The platform is now fully powered by real market data and real progression. Your actions map to real-world performance.",
    accent: "from-fuchsia-50 to-white",
    icon: Trophy,
    bullets: [
      "Asset prices and charts now sync with real-world APIs, providing accurate market movement.",
      "Clicking any asset name or symbol anywhere instantly jumps to its detailed chart page.",
      "Your trading activity grants you XP, unlocking achievements and leveling up your account automatically.",
    ],
    actionLabel: "View Gamification",
    actionTo: "/gamification",
    actionHint: "Check your current level and milestones.",
    previewTitle: "Live Data & Progression",
    previewBody:
      "Experience a live-market simulation where your insights, behavior, and XP are driven by true market behavior.",
    previewPills: ["Live Charts", "Achievements", "Clickable Symbols", "XP System"],
  },
];

function Docs() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeSlide = slides[activeIndex];

  useEffect(() => {
    const saved = window.localStorage.getItem(TOUR_KEY);
    if (!saved) return;
    const index = slides.findIndex((slide) => slide.id === saved);
    if (index >= 0) setActiveIndex(index);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(TOUR_KEY, activeSlide.id);
  }, [activeSlide.id]);

  const progress = useMemo(() => {
    return Math.round(((activeIndex + 1) / slides.length) * 100);
  }, [activeIndex]);

  const StepIcon = activeSlide.icon;

  function next() {
    setActiveIndex((current) => Math.min(slides.length - 1, current + 1));
  }

  function prev() {
    setActiveIndex((current) => Math.max(0, current - 1));
  }

  function restart() {
    setActiveIndex(0);
  }

  function startTour() {
    window.localStorage.setItem(TOUR_KEY, "welcome");
    setActiveIndex(0);
  }

  return (
    <>
      <PageHeader
        eyebrow="User guide"
        title="User guide"
        description="A short guided tour for first-time users. Move slide by slide to learn where to trade, where to open asset detail, and where to read your portfolio insights."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              Slide {activeIndex + 1}/{slides.length}
            </Badge>
            <Button variant="outline" className="gap-2" onClick={startTour}>
              <Sparkles className="h-4 w-4" />
              Replay slideshow
            </Button>
            <Button variant="outline" asChild className="gap-2">
              <Link to="/trading">
                <Sparkles className="h-4 w-4" /> Start trading
              </Link>
            </Button>
          </div>
        }
      />

      <PageBody>
        <section className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <aside className="space-y-3">
            <Card className="border-blue-100 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-950">
                <BookOpen className="h-4 w-4" />
                Guided tour
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                This flow is meant to be followed top to bottom. Use it once, then come back anytime
                you need a quick reminder.
              </p>
              <div className="mt-4 space-y-3">
                {slides.map((slide, index) => {
                  const active = index === activeIndex;
                  return (
                    <button
                      key={slide.id}
                      onClick={() => setActiveIndex(index)}
                      className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition ${
                        active
                          ? "border-blue-200 bg-blue-50"
                          : "border-transparent hover:border-blue-100 hover:bg-blue-50/60"
                      }`}
                    >
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                          active ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-blue-950">
                          {slide.eyebrow}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {slide.title}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card className="border-blue-100 p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Tour progress</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <Progress value={progress} className="mt-2 h-2" />
              <div className="mt-4 flex gap-2">
                <Button variant="outline" size="sm" onClick={restart} className="gap-2">
                  <CircleCheckBig className="h-4 w-4" />
                  Restart
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.localStorage.removeItem(TOUR_KEY)}
                >
                  Reset memory
                </Button>
              </div>
            </Card>
          </aside>

          <Card
            className={`overflow-hidden border-blue-100 bg-gradient-to-br ${activeSlide.accent}`}
          >
            <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="p-6 sm:p-8">
                <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
                  <StepIcon className="h-4 w-4" />
                  {activeSlide.eyebrow}
                </div>
                <h2 className="mt-3 font-serif text-3xl font-semibold text-blue-950">
                  {activeSlide.title}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-700">
                  {activeSlide.summary}
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {activeSlide.bullets.map((bullet, index) => (
                    <div key={bullet} className="rounded-md border border-blue-100 bg-white/90 p-3">
                      <div className="flex items-start gap-3">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                          {index + 1}
                        </span>
                        <span className="text-sm leading-6 text-slate-700">{bullet}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button
                    onClick={prev}
                    variant="outline"
                    disabled={activeIndex === 0}
                    className="gap-2"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    onClick={next}
                    disabled={activeIndex === slides.length - 1}
                    className="gap-2 bg-blue-600 hover:bg-blue-700"
                  >
                    Next
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" asChild className="gap-2 text-blue-800">
                    <Link to={activeSlide.actionTo}>{activeSlide.actionLabel}</Link>
                  </Button>
                </div>
                <p className="mt-3 text-xs text-slate-500">{activeSlide.actionHint}</p>
              </div>

              <div className="border-t border-blue-100 bg-white/75 p-6 sm:p-8 lg:border-l lg:border-t-0">
                <div className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="small-caps text-[0.65rem] text-blue-600">Preview</div>
                      <h3 className="mt-1 text-lg font-semibold text-blue-950">
                        {activeSlide.previewTitle}
                      </h3>
                    </div>
                    <Badge variant="secondary" className="font-mono">
                      {activeIndex + 1}/{slides.length}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {activeSlide.previewBody}
                  </p>

                  <div className="mt-5 space-y-3">
                    {activeSlide.previewPills.map((pill) => (
                      <div
                        key={pill}
                        className="flex items-center justify-between rounded-md bg-blue-50 px-3 py-2 text-sm"
                      >
                        <span className="font-medium text-blue-950">{pill}</span>
                        <MousePointerClick className="h-4 w-4 text-blue-500" />
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 rounded-md border border-dashed border-blue-200 bg-blue-50/50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-blue-950">
                      <ShieldCheck className="h-4 w-4 text-blue-600" />
                      First-time tip
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      If you only remember one thing, remember this: use Trading to find and
                      compare, open the asset page for detail, and use Portfolio or Behavioral to
                      understand what your trades are doing over time.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="border-blue-100 p-5">
            <div className="text-sm font-semibold text-blue-950">Trading</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Search, filter by sector, switch timeframe, then add Buy or Sell orders to your
              basket.
            </p>
          </Card>
          <Card className="border-blue-100 p-5">
            <div className="text-sm font-semibold text-blue-950">Asset detail</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Click any symbol to open its chart, fundamentals, news, and behavioral tabs.
            </p>
          </Card>
          <Card className="border-blue-100 p-5">
            <div className="text-sm font-semibold text-blue-950">Portfolio and summaries</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Review your holdings, recent trades, and saved summaries after you execute orders.
            </p>
          </Card>
          <Card className="border-blue-100 p-5">
            <div className="text-sm font-semibold text-blue-950">Real-time & Progression</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Trade with real market prices, track true XP, and earn achievements as you progress.
            </p>
          </Card>
        </section>
      </PageBody>
    </>
  );
}
