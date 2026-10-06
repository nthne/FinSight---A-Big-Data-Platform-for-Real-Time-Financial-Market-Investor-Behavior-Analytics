import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";

const GEMINI_MODEL = "gemini-2.5-flash";
const OPENAI_FALLBACK_MODEL = "gpt-4o-mini";

export function getAiModel() {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (geminiKey) {
    const google = createGoogleGenerativeAI({ apiKey: geminiKey });
    return {
      model: google(GEMINI_MODEL),
      provider: "Gemini",
      modelName: GEMINI_MODEL,
    };
  }

  const openAiKey = process.env.OPENAI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY;
  if (openAiKey) {
    const openai = createOpenAI({ apiKey: openAiKey });
    return {
      model: openai(OPENAI_FALLBACK_MODEL),
      provider: "OpenAI",
      modelName: OPENAI_FALLBACK_MODEL,
    };
  }

  throw new Error("Missing GEMINI_API_KEY. Add it to the server environment.");
}
