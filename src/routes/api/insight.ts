import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { getAiModel } from "@/lib/ai-gateway";

type InsightKind = "market-today" | "behavior-overview" | "basket-review";

interface InsightBody {
  kind: InsightKind;
  context: string;
}

const PROMPTS: Record<InsightKind, string> = {
  "market-today":
    "Write a concise portfolio and market overview for the user in this investment simulation. Use 3-5 bullets, mention cash and holdings when available, and give 2-3 concrete simulation ideas by ticker or asset.",
  "behavior-overview":
    "Analyze the user's investment behavior from the real context: trading frequency, diversification, risk taking, and biases such as loss aversion, overconfidence, herding, recency, and disposition effect. End with 2 discipline-improvement suggestions.",
  "basket-review":
    "Evaluate the draft order basket. Comment on risk, sizing, diversification, and likely biases behind each order. Suggest quantity adjustments, alternative assets, or orders that should be removed. Keep it under 180 words.",
};

export const Route = createFileRoute("/api/insight")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json()) as InsightBody;
        if (!body?.kind || !PROMPTS[body.kind]) {
          return new Response("Invalid kind", { status: 400 });
        }

        try {
          const { model } = getAiModel();
          const { text } = await generateText({
            model,
            system:
              "You are FinSight Coach, an AI advisor inside a financial investment simulation system. Always answer in English. Be concise and structured. Use the real context provided; if data is missing, say which data is missing instead of inventing numbers.",
            prompt: `${PROMPTS[body.kind]}\n\n=== User context ===\n${body.context}`,
          });
          return Response.json({ text });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "AI gateway error";
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
