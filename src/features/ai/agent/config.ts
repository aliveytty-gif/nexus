export type AgentConfig = ReturnType<typeof readAgentConfig>;
const number = (s: string | undefined, fallback: number, min: number, max: number) =>
  s?.trim() && Number.isFinite(Number(s)) ? Math.max(min, Math.min(max, Number(s))) : fallback;
const integer = (s: string | undefined, fallback: number, min: number, max: number) => Math.floor(number(s, fallback, min, max));

// No environment reads in client-shareable modules. Call only on the server with process.env.
export function readAgentConfig(env: Record<string, string | undefined>) {
  const provider = env.AI_PROVIDER?.trim() || "openrouter";
  const endpoints: Record<string, string> = {
    openrouter: "https://openrouter.ai/api/v1", openai: "https://api.openai.com/v1",
    deepseek: "https://api.deepseek.com/v1", gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    groq: "https://api.groq.com/openai/v1",
  };
  let baseUrl = env.AI_API_BASE_URL?.trim() || endpoints[provider] || "";
  const local = provider === "ollama" && env.NODE_ENV === "development" && !env.VERCEL;
  if (local) baseUrl = `${(env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "")}/v1`;
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash ||
      (local ? !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) : url.protocol !== "https:")) baseUrl = "";
    if (provider === "ollama" && !local) baseUrl = "";
    // OpenRouter free routing is only meaningful at the official API.
    if (provider === "openrouter" && url.origin !== "https://openrouter.ai") baseUrl = "";
    if (provider === "groq" && url.href.replace(/\/$/, "") !== endpoints.groq) baseUrl = "";
  } catch { baseUrl = ""; }
  const key = env.AI_API_KEY?.trim() || (provider === "openrouter" ? env.OPENROUTER_API_KEY?.trim() : "") || "";
  const paid = env.AI_ALLOW_PAID === "true";
  const defaultModel = provider === "openrouter" ? "openrouter/free" : provider === "groq" ? "openai/gpt-oss-20b" : "";
  const model = env.AI_MODEL?.trim() || defaultModel;
  const maxCost = number(env.AI_MAX_REQUEST_COST, 0, 0, 0.25);
  const inputPrice = number(env.AI_INPUT_PRICE_PER_MILLION, -1, -1, 100);
  const outputPrice = number(env.AI_OUTPUT_PRICE_PER_MILLION, -1, -1, 500);
  const priced = inputPrice >= 0 && outputPrice >= 0;
  const freeOnly = !paid;
  // Set only after verifying the Groq organization is on Free without billing enabled.
  const groqFreeConfirmed = env.AI_GROQ_FREE_CONFIRMED === "true";
  const providerReady = provider === "groq"
    ? freeOnly && groqFreeConfirmed
    : local || (freeOnly ? provider === "openrouter" : priced && maxCost > 0);
  const searchProvider = env.WEB_SEARCH_PROVIDER === "firecrawl" ? "firecrawl"
    : env.WEB_SEARCH_PROVIDER === "brave" ? "brave" : null;
  return {
    enabled: env.AI_ENABLED === "true", provider, apiKey: key, baseUrl, model,
    fallbackModel: env.AI_FALLBACK_MODEL?.trim() || (provider === "openrouter" ? "openrouter/free" : ""),
    ready: Boolean(baseUrl && model && (key || local) && providerReady),
    groqFreeConfirmed,
    freeOnly, maxCost, inputPrice: freeOnly ? 0 : inputPrice, outputPrice: freeOnly ? 0 : outputPrice,
    userLimit: integer(env.AI_DAILY_USER_LIMIT, 5, 0, 1000), globalLimit: integer(env.AI_DAILY_GLOBAL_LIMIT, 40, 0, 1000),
    maxSteps: integer(env.AI_MAX_TOOL_STEPS, 6, 1, 7), maxToolCalls: integer(env.AI_MAX_TOOL_CALLS, 8, 0, 10),
    maxOutputTokens: integer(env.AI_MAX_OUTPUT_TOKENS, 1600, 128, 3000),
    maxInputBytes: integer(env.AI_MAX_INPUT_BYTES, 28000, 8000, 40000),
    timeoutMs: integer(env.AI_REQUEST_TIMEOUT, 65000, 5000, 70000),
    reasoning: ["low", "medium", "high"].includes(env.AI_REASONING_EFFORT || "") ? env.AI_REASONING_EFFORT : undefined,
    reasoningSupported: env.AI_REASONING_SUPPORTED === "true",
    searchProvider,
    searchEnabled: searchProvider !== null && Boolean(env.WEB_SEARCH_API_KEY?.trim()),
    searchKey: env.WEB_SEARCH_API_KEY?.trim() || "",
    searchPrice: number(env.WEB_SEARCH_COST_PER_REQUEST, searchProvider === "firecrawl" ? 0 : 0.005, 0, 1),
    maxSearchCalls: integer(env.AI_MAX_SEARCH_CALLS, 3, 0, 5),
    maxSearchCost: number(env.AI_MAX_SEARCH_COST, 0.015, 0, 0.05),
    disabledTools: new Set((env.AI_DISABLED_TOOLS || "").split(",").map((v) => v.trim()).filter(Boolean)),
  };
}
