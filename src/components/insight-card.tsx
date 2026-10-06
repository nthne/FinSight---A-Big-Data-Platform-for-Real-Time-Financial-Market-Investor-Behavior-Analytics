import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface Props {
  kind: "market-today" | "behavior-overview" | "basket-review";
  context: string;
  title: string;
  eyebrow: string;
  className?: string;
  cta?: string;
  autoLoad?: boolean;
  initialText?: string | null;
  onComplete?: (text: string) => void;
}

export function InsightCard({ kind, context, title, eyebrow, className, cta = "Generate insight", autoLoad = false, initialText = null, onComplete }: Props) {
  const cacheKey = getInsightCacheKey(kind, title, context);
  const [text, setText] = useState<string>(initialText ?? "");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(Boolean(initialText));
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const cachedText = initialText ?? readCachedInsight(cacheKey) ?? "";
    setText(cachedText);
    setLoaded(Boolean(cachedText));
    setExpanded(false);
  }, [cacheKey, initialText]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/insight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, context }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as { text: string };
      setText(j.text);
      setLoaded(true);
      setExpanded(false);
      writeCachedInsight(cacheKey, j.text);
      onComplete?.(j.text);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not generate insight");
    } finally {
      setLoading(false);
    }
  }

  // autoLoad would cause hydration mismatch; trigger on mount via effect
  // (kept manual to save tokens unless asked)
  void autoLoad;
  const canCollapse = text.length > 520;

  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="small-caps text-[0.58rem] text-muted-foreground truncate">{eyebrow}</div>
          <h3 className="font-serif text-lg sm:text-xl font-semibold leading-tight">{title}</h3>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm" className="gap-1.5 shrink-0 h-8 px-2.5 text-xs">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : loaded ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          {loaded ? "Update" : cta}
        </Button>
      </div>
      {err && <div className="text-xs text-destructive">{err}</div>}
      {!loaded && !loading && !err && (
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
          Click "{cta}" to let FinSight Coach analyze the current data with AI.
        </p>
      )}
      {loading && !text && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Coach is analyzing...
        </div>
      )}
      {text && (
        <div className="mt-2">
          <div className={cn(
            "relative overflow-hidden transition-[max-height] duration-300",
            canCollapse && !expanded ? "max-h-44" : "max-h-[none]",
          )}>
            <div className="prose prose-xs sm:prose-sm max-w-none text-[0.78rem] sm:text-[0.84rem] leading-[1.45] prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-strong:font-semibold prose-headings:font-serif prose-headings:my-1.5">
              <ReactMarkdown>{text}</ReactMarkdown>
            </div>
            {canCollapse && !expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
            )}
          </div>
          {canCollapse && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 h-7 px-2 text-xs gap-1.5 text-muted-foreground"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {expanded ? "Show less" : "Show more"}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function getInsightCacheKey(kind: Props["kind"], title: string, context: string) {
  return `finsight.insight.${kind}.${hashText(`${title}\n${context}`)}`;
}

function hashText(value: string) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function readCachedInsight(key: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeCachedInsight(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota or privacy-mode failures; the live insight still renders.
  }
}
