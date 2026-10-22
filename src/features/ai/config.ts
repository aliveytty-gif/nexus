import "server-only";

export type AiConfig = {
  enabled: boolean; ready: boolean; provider: "openrouter" | "ollama";
  apiKey: string; model: string; fallbackModel: string;
  userLimit: number; globalLimit: number; maxOutputTokens: number;
  ollamaUrl: string;
};
const integer = (value: string | undefined, fallback: number, max: number) =>
  value && /^\d+$/.test(value) ? Math.min(max, Math.max(1, Number(value))) : fallback;

export function getAiConfig(): AiConfig {
  const provider = process.env.AI_PROVIDER === "ollama" ? "ollama" : "openrouter";
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  let ollamaUrl = "";
  try {
    const url = new URL(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434");
    if (!process.env.VERCEL && process.env.NODE_ENV === "development" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      ["http:", "https:"].includes(url.protocol) && !url.username && !url.password)
      ollamaUrl = url.origin;
  } catch { /* An invalid local URL disables the adapter. */ }
  return {
    enabled: process.env.AI_ENABLED === "true",
    ready: provider === "ollama" ? Boolean(ollamaUrl && process.env.AI_MODEL) : Boolean(apiKey),
    provider, apiKey,
    model: process.env.AI_MODEL?.trim() || "deepseek/deepseek-v4-flash-0731:free",
    fallbackModel: process.env.AI_FALLBACK_MODEL?.trim() || "openrouter/free",
    userLimit: integer(process.env.AI_DAILY_USER_LIMIT, 5, 50),
    globalLimit: integer(process.env.AI_DAILY_GLOBAL_LIMIT, 40, 50),
    maxOutputTokens: integer(process.env.AI_MAX_OUTPUT_TOKENS, 400, 1200),
    ollamaUrl,
  };
}
