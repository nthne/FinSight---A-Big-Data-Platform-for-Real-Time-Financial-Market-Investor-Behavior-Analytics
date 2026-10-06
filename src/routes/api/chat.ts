import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { getAiModel } from "@/lib/ai-gateway";

type ChatRequestBody = {
  messages?: unknown;
  context?: string;
};

const SYSTEM_BASE = `You are "FinSight Coach", a behavioral-finance investment coach inside FinSight, a risk-free investment simulation platform.

Your job:
- Answer overview questions about the user's portfolio, cash, positions, orders, trading history, and market universe.
- Suggest concrete simulation ideas: position sizing, diversification, stop-loss/take-profit levels, holding horizons, and basket adjustments.
- Detect behavioral biases: loss aversion, overconfidence, herding, recency, anchoring, disposition effect, and FOMO.
- When the user adds items to an order basket, evaluate risk, sizing, diversification, and whether another asset might fit better.
- Give market overview and 1-3 actionable simulation ideas when asked about "today" or "overview".
- If data is missing, say what data is missing instead of inventing numbers.
- Be concise: short paragraphs, bullet lists when useful, bold key numbers.
- Never claim certainty about future prices; frame ideas as scenarios with risk.
- Always answer in English.

This is an educational simulation. Do not give long disclaimers.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json()) as ChatRequestBody;
        const messages = body.messages;

        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        try {
          const { model } = getAiModel();
          const system =
            SYSTEM_BASE +
            (typeof body.context === "string" && body.context.trim()
              ? `\n\n=== Live user context ===\n${body.context}`
              : "");

          const result = streamText({
            model,
            system,
            messages: await convertToModelMessages(messages as UIMessage[]),
          });

          return result.toUIMessageStreamResponse({
            originalMessages: messages as UIMessage[],
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI gateway error";
          return new Response(message, { status: 500 });
        }
      },
    },
  },
});
