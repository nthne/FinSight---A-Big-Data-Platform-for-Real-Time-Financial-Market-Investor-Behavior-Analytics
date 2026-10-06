import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import { MessageCircle, X, Send, Sparkles, Loader2, Bot, User } from "lucide-react";
import { useTradingStore, portfolioValue } from "@/lib/store";
import { getAsset } from "@/lib/market";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatVnd } from "@/lib/currency";

function buildContext() {
  const s = useTradingStore.getState();
  const equity = portfolioValue(s.positions, s.cash);
  const positions = s.positions
    .map((p) => {
      const a = getAsset(p.symbol);
      if (!a) return null;
      const pl = ((a.price - p.avgCost) / p.avgCost) * 100;
      return `  - ${p.symbol} (${a.class}) qty=${p.qty} avgCost=${formatVnd(p.avgCost, 2)} last=${formatVnd(a.price, 2)} P/L=${pl.toFixed(2)}%`;
    })
    .filter(Boolean)
    .join("\n");
  const basket = s.basket.length
    ? s.basket
        .map((b) => {
          const a = getAsset(b.symbol);
          const px = b.type === "Limit" && b.limitPrice ? b.limitPrice : (a?.price ?? 0);
          return `  - ${b.side.toUpperCase()} ${b.qty} ${b.symbol} ${b.type}${b.limitPrice ? ` @${formatVnd(b.limitPrice, 2)}` : ""} (~${formatVnd(px * b.qty, 2)})`;
        })
        .join("\n")
    : "  (empty)";
  const recent =
    s.history
      .slice(0, 5)
      .map(
        (o) =>
          `  - ${o.side.toUpperCase()} ${o.qty} ${o.symbol} @${formatVnd(o.price, 2)} fee=${formatVnd(o.fee, 2)}`,
      )
      .join("\n") || "  (none)";
  return `Cash: ${formatVnd(s.cash, 2)}\nPortfolio value: ${formatVnd(equity, 2)}\nFee rate: ${(s.feeRate * 100).toFixed(3)}%\nPositions:\n${positions || "  (none)"}\nCurrent order basket:\n${basket}\nRecent executions:\n${recent}`;
}

export function AICoach() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const ctxRef = useRef<string>("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { ...body, messages, context: ctxRef.current },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({
    transport,
    messages: [
      {
        id: "welcome",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Hello! I am **FinSight Coach**. I can help you evaluate investment behavior, suggest strategy ideas, and review basket orders before you place them. Try adding an asset to the basket, or ask me anything about your portfolio.",
          },
        ],
      } satisfies UIMessage,
    ],
  });

  const lastBasketLen = useRef(0);
  const lastHistoryLen = useRef(0);
  useEffect(() => {
    const unsub = useTradingStore.subscribe((s, prev) => {
      if (s.basket.length > lastBasketLen.current) {
        const newLine = s.basket[s.basket.length - 1];
        if (newLine) {
          const a = getAsset(newLine.symbol);
          ctxRef.current = buildContext();
          setOpen(true);
          sendMessage({
            text: `I added this draft order to my basket: ${newLine.side.toUpperCase()} ${newLine.qty} ${newLine.symbol} (${newLine.type})${a ? ` ~ ${formatVnd(a.price * newLine.qty, 2)}` : ""}. Please review the order, sizing, and risk, and suggest any useful adjustments or related assets.`,
          });
        }
      }

      if (s.history.length > lastHistoryLen.current) {
        const justExecuted = s.history.length - lastHistoryLen.current;
        const recent = s.history.slice(0, justExecuted);
        const actionText = recent
          .map((o) => {
            const verb = o.side === "buy" ? "bought" : "sold";
            return `${verb} ${o.qty} ${o.symbol} at ${formatVnd(o.price, 2)}`;
          })
          .join(", ");
        ctxRef.current = buildContext();
        setOpen(true);
        sendMessage({
          text: `I just executed ${justExecuted} investment trade${justExecuted > 1 ? "s" : ""}: ${actionText}. Please analyze my behavior in these trades, including loss aversion, overtrading, position sizing, diversification, and a short discipline tip.`,
        });
      }
      lastBasketLen.current = s.basket.length;
      lastHistoryLen.current = s.history.length;
      void prev;
    });

    const s0 = useTradingStore.getState();
    lastBasketLen.current = s0.basket.length;
    lastHistoryLen.current = s0.history.length;
    return unsub;
  }, [sendMessage]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    ctxRef.current = buildContext();
    sendMessage({ text });
    setInput("");
  }

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 grid place-items-center hover:scale-105 transition-transform"
          aria-label="Open FinSight Coach"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col w-[min(94vw,400px)] h-[min(80vh,620px)] rounded-xl border bg-card shadow-2xl overflow-hidden">
          <header className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-primary/8 to-accent/40">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground grid place-items-center">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <div className="font-serif font-semibold text-sm leading-none">FinSight Coach</div>
                <div className="text-[0.65rem] text-muted-foreground mt-0.5">
                  Behavioral coach - live context
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.map((m) => (
              <Bubble key={m.id} message={m} />
            ))}
            {status === "submitted" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Coach is thinking...
              </div>
            )}
            {error && (
              <Badge variant="destructive" className="text-xs">
                {error.message}
              </Badge>
            )}
          </div>

          <form onSubmit={onSubmit} className="border-t p-2.5 flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about orders, strategy, or markets..."
              className="h-9 text-sm"
              disabled={isLoading}
            />
            <Button
              type="submit"
              size="sm"
              disabled={isLoading || !input.trim()}
              className="h-9 px-3"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}

function Bubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "h-6 w-6 rounded-full grid place-items-center shrink-0 mt-0.5",
          isUser ? "bg-muted text-foreground" : "bg-primary/10 text-primary",
        )}
      >
        {isUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
      </div>
      <div
        className={cn(
          "rounded-lg px-3 py-2 text-sm max-w-[82%] leading-relaxed",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted/60 text-foreground",
        )}
      >
        <div
          className={cn(
            "prose prose-sm max-w-none",
            isUser ? "prose-invert" : "",
            "prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-1.5 prose-strong:font-semibold",
          )}
        >
          <ReactMarkdown>{text || "..."}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
